import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  Link2,
  RefreshCw,
  Trash2,
  AlertCircle,
  Layers,
  Database,
  Unlink,
  CheckSquare,
  Square,
  ShieldCheck,
} from 'lucide-react';
import {
  useGoogleAuthStatusQuery,
  useSessionGoogleSheetsQuery,
  useImportGoogleSheetsMutation,
  useResyncGoogleSheetMutation,
  useRemoveGoogleSheetMutation,
  useDisconnectGoogleMutation,
} from '../hooks/useQueries';
import { getGoogleAuthUrl, getGoogleSheetsMetadata } from '../services/api';
import { GoogleSheetMetadata } from '../types';
import { Modal, Button, Badge, Input, Card } from './ui';

interface GoogleSheetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
  onEnsureSession?: () => string;
  showToast?: (msg: string) => void;
}

export const GoogleSheetsModal: React.FC<GoogleSheetsModalProps> = ({
  isOpen,
  onClose,
  sessionId,
  onEnsureSession,
  showToast,
}) => {
  const [spreadsheetUrl, setSpreadsheetUrl] = useState('');
  const [isInspecting, setIsInspecting] = useState(false);
  const [metadata, setMetadata] = useState<GoogleSheetMetadata | null>(null);
  const [selectedTabs, setSelectedTabs] = useState<string[]>([]);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Automatically guarantee that an active session exists when modal is opened
  useEffect(() => {
    if (isOpen && !sessionId && onEnsureSession) {
      onEnsureSession();
    }
  }, [isOpen, sessionId, onEnsureSession]);

  // Queries
  const { data: authStatus, refetch: refetchAuth } = useGoogleAuthStatusQuery(sessionId);
  const { data: sheetsData, refetch: refetchSheets, isLoading: isSheetsLoading } = useSessionGoogleSheetsQuery(sessionId);

  // Mutations
  const importMutation = useImportGoogleSheetsMutation(sessionId);
  const resyncMutation = useResyncGoogleSheetMutation(sessionId);
  const removeMutation = useRemoveGoogleSheetMutation(sessionId);
  const disconnectMutation = useDisconnectGoogleMutation(sessionId);

  // Listen to Google OAuth popup callback message
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'GOOGLE_AUTH_SUCCESS') {
        refetchAuth();
        if (showToast) {
          showToast(`Google account (${e.data.google_email}) connected successfully.`);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refetchAuth, showToast]);

  const handleConnectGoogle = async () => {
    const activeSessionId = sessionId || (onEnsureSession ? onEnsureSession() : null);
    if (!activeSessionId) {
      if (showToast) showToast('Invalid session. Please start a conversation first.');
      return;
    }
    try {
      const res = await getGoogleAuthUrl(activeSessionId);
      if (res.auth_url) {
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        window.open(
          res.auth_url,
          'google_oauth_popup',
          `width=${width},height=${height},top=${top},left=${left},status=no,resizable=yes`
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (showToast) showToast(`Failed to initiate Google authorization: ${msg}`);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectMutation.mutateAsync();
      setMetadata(null);
      if (showToast) showToast('Google account disconnected successfully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (showToast) showToast(`Failed to disconnect account: ${msg}`);
    }
  };

  const handleInspect = async () => {
    const activeSessionId = sessionId || (onEnsureSession ? onEnsureSession() : null);
    if (!activeSessionId || !spreadsheetUrl.trim()) return;
    setIsInspecting(true);
    setInspectError(null);
    setMetadata(null);
    try {
      const meta = await getGoogleSheetsMetadata(activeSessionId, spreadsheetUrl.trim());
      setMetadata(meta);
      // Default to selecting all discovered tabs
      setSelectedTabs(meta.tabs.map((t) => t.sheet_title));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve spreadsheet metadata';
      setInspectError(msg);
    } finally {
      setIsInspecting(false);
    }
  };

  const toggleTabSelection = (title: string) => {
    if (selectedTabs.includes(title)) {
      setSelectedTabs(selectedTabs.filter((t) => t !== title));
    } else {
      setSelectedTabs([...selectedTabs, title]);
    }
  };

  const handleSelectAllTabs = () => {
    if (metadata) {
      setSelectedTabs(metadata.tabs.map((t) => t.sheet_title));
    }
  };

  const handleClearTabSelection = () => {
    setSelectedTabs([]);
  };

  const handleImport = async () => {
    const activeSessionId = sessionId || (onEnsureSession ? onEnsureSession() : null);
    if (!activeSessionId || !spreadsheetUrl.trim() || selectedTabs.length === 0) return;
    try {
      const result = await importMutation.mutateAsync({
        url: spreadsheetUrl.trim(),
        selectedSheets: selectedTabs,
      });
      if (showToast) {
        showToast(
          `Successfully imported ${result.total_tables_created} tables (${result.total_rows_imported.toLocaleString()} rows) into PostgreSQL.`
        );
      }
      setSpreadsheetUrl('');
      setMetadata(null);
      setSelectedTabs([]);
      refetchSheets();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to import spreadsheet';
      if (showToast) showToast(`Import failed: ${msg}`);
    }
  };

  const handleResync = async (linkId: string, title: string) => {
    setSyncingId(linkId);
    try {
      const res = await resyncMutation.mutateAsync(linkId);
      if (showToast) {
        showToast(`Spreadsheet "${title}" re-synced successfully (${res.total_rows.toLocaleString()} rows updated).`);
      }
      refetchSheets();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to re-sync';
      if (showToast) showToast(`Re-sync failed: ${msg}`);
    } finally {
      setSyncingId(null);
    }
  };

  const handleRemove = async (linkId: string, title: string) => {
    setRemovingId(linkId);
    try {
      await removeMutation.mutateAsync(linkId);
      if (showToast) {
        showToast(`Removed spreadsheet "${title}" and associated SQL tables.`);
      }
      refetchSheets();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove';
      if (showToast) showToast(`Remove failed: ${msg}`);
    } finally {
      setRemovingId(null);
    }
  };

  const isConnected = Boolean(authStatus?.is_connected);
  const sheets = sheetsData?.sheets || [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      icon={<FileSpreadsheet className="w-5 h-5 text-emerald-400" />}
      title="Google Sheets Ingestion Engine"
      subtitle="Connect your Google account to ingest live spreadsheets into SQL analytics tables for cross-join analysis"
    >
      <div className="space-y-5">
        {/* Section 1: Google Account Authentication Card */}
        <Card variant="surface" className="p-4 border-white/[0.08]">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {isConnected && authStatus?.google_picture_url ? (
                <img
                  src={authStatus.google_picture_url}
                  alt={authStatus.google_name || 'Google User'}
                  className="w-10 h-10 rounded-full border border-emerald-500/30 object-cover shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400 shrink-0">
                  <Database className="w-5 h-5 text-slate-400" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white truncate">
                    {isConnected ? authStatus?.google_name || 'Google Account' : 'No Google Account Connected'}
                  </span>
                  <Badge variant={isConnected ? 'success' : 'neutral'} size="xs" dot={isConnected}>
                    {isConnected ? 'Connected' : 'Offline'}
                  </Badge>
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {isConnected
                    ? authStatus?.google_email
                    : 'Sign in with Google to access private and shared spreadsheets directly.'}
                </p>
              </div>
            </div>

            <div className="shrink-0">
              {isConnected ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnect}
                  isLoading={disconnectMutation.isPending}
                  leftIcon={<Unlink className="w-3.5 h-3.5 text-rose-400" />}
                  className="text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 border-rose-500/20"
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleConnectGoogle}
                  leftIcon={<Link2 className="w-3.5 h-3.5" />}
                >
                  Connect Google Account
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Section 2: Input URL & Ingest Spreadsheet */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <Layers className="w-4 h-4 text-sky-400" />
              <span>Import Spreadsheet</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Read-Only Access</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 min-w-0">
                <Input
                  placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5n.../edit or spreadsheet ID"
                  value={spreadsheetUrl}
                  onChange={(e) => setSpreadsheetUrl(e.target.value)}
                  disabled={!isConnected || isInspecting || importMutation.isPending}
                  monospace
                  leftIcon={<Link2 className="w-3.5 h-3.5" />}
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleInspect}
                disabled={!isConnected || !spreadsheetUrl.trim() || isInspecting || importMutation.isPending}
                isLoading={isInspecting}
                leftIcon={<Layers className="w-3.5 h-3.5 text-sky-400" />}
                className="shrink-0"
              >
                Inspect Sheets
              </Button>
            </div>

            {inspectError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{inspectError}</span>
              </div>
            )}

            {/* Inspected Metadata Preview & Sheet Selector */}
            {metadata && (
              <Card variant="dark" className="p-4 border-white/[0.08] space-y-3.5">
                <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] flex-wrap gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-sm font-semibold text-white truncate">
                      {metadata.spreadsheet_title}
                    </span>
                  </div>
                  <Badge variant="info" size="xs">
                    {metadata.tabs.length} Sheets Discovered
                  </Badge>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-300">
                      Select sheets to convert into PostgreSQL tables:
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSelectAllTabs}
                        className="text-[11px] text-sky-400 hover:text-sky-300 transition cursor-pointer"
                      >
                        Select All
                      </button>
                      <span className="text-slate-600">|</span>
                      <button
                        type="button"
                        onClick={handleClearTabSelection}
                        className="text-[11px] text-slate-400 hover:text-slate-300 transition cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {metadata.tabs.map((tab) => {
                      const isSelected = selectedTabs.includes(tab.sheet_title);
                      return (
                        <button
                          key={tab.sheet_id}
                          type="button"
                          onClick={() => toggleTabSelection(tab.sheet_title)}
                          className={`flex items-center justify-between p-2.5 rounded-xl border text-left transition cursor-pointer select-none ${isSelected
                              ? 'bg-sky-500/10 border-sky-500/40 text-white shadow-sm'
                              : 'bg-[#0b1322] border-white/[0.06] text-slate-400 hover:border-white/[0.12] hover:text-slate-200'
                            }`}
                        >
                          <div className="flex items-center gap-2 truncate pr-2">
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-sky-400 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-500 shrink-0" />
                            )}
                            <span className="text-xs font-medium truncate">{tab.sheet_title}</span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-500 shrink-0">
                            {tab.row_count.toLocaleString()} rows
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between border-t border-white/[0.06] flex-wrap gap-2">
                  <span className="text-xs text-slate-400">
                    {selectedTabs.length} of {metadata.tabs.length} sheets selected
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleImport}
                    disabled={selectedTabs.length === 0 || importMutation.isPending}
                    isLoading={importMutation.isPending}
                    leftIcon={<Database className="w-3.5 h-3.5" />}
                  >
                    Import to Database
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* Section 3: Linked Google Sheets in Current Session */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <Database className="w-4 h-4 text-slate-400" />
              <span>Linked Spreadsheets ({sheets.length})</span>
            </div>
            {sheets.length > 0 && (
              <span className="text-[11px] text-slate-500">Live for Text-to-SQL &amp; Cross-Join</span>
            )}
          </div>

          {isSheetsLoading ? (
            <div className="p-6 text-center text-xs text-slate-500 bg-[#0b1322] rounded-xl border border-white/[0.06]">
              Loading linked spreadsheets...
            </div>
          ) : sheets.length === 0 ? (
            <div className="p-8 text-center text-xs border border-dashed border-white/[0.08] rounded-xl bg-[#0b1322]/40 space-y-1.5">
              <FileSpreadsheet className="w-6 h-6 text-slate-500 mx-auto mb-1 opacity-70" />
              <p className="font-medium text-slate-300">No spreadsheets linked in this session</p>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                Connect your Google account and paste a spreadsheet link above to ingest live data for analytical queries.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {sheets.map((sheet) => {
                const isSyncing = syncingId === sheet.sheet_link_id || resyncMutation.isPending;
                const isRemoving = removingId === sheet.sheet_link_id || removeMutation.isPending;

                return (
                  <Card
                    key={sheet.sheet_link_id}
                    variant="dark"
                    className="p-3.5 border-white/[0.06] bg-[#0b1322] space-y-2.5 hover:border-white/[0.1] transition"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-white truncate">
                            {sheet.spreadsheet_title}
                          </span>
                          <Badge variant="success" size="xs">
                            {sheet.row_count_total.toLocaleString()} Rows
                          </Badge>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                          Last synced: {new Date(sheet.last_synced_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => handleResync(sheet.sheet_link_id, sheet.spreadsheet_title)}
                          disabled={isSyncing || isRemoving}
                          title="Re-fetch latest rows from Google Sheets"
                          leftIcon={
                            <RefreshCw className={`w-3 h-3 text-sky-400 ${isSyncing ? 'animate-spin' : ''}`} />
                          }
                        >
                          Sync
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleRemove(sheet.sheet_link_id, sheet.spreadsheet_title)}
                          disabled={isSyncing || isRemoving}
                          title="Remove spreadsheet link and drop PostgreSQL tables"
                          leftIcon={<Trash2 className="w-3 h-3 text-rose-400" />}
                          className="hover:bg-rose-500/10 text-rose-300"
                        />
                      </div>
                    </div>

                    {/* Sheet Tabs / PostgreSQL Tables Badge List */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {sheet.sheet_tabs.map((tab) => (
                        <div
                          key={tab.sheet_id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#14223b]/60 border border-white/[0.06] text-[11px] font-mono text-slate-300"
                          title={`PostgreSQL Table: ${tab.table_name || 'auto-generated'}`}
                        >
                          <span className="font-sans font-medium text-emerald-400">{tab.sheet_title}</span>
                          <span className="text-slate-500 text-[10px]">({tab.row_count.toLocaleString()} rows)</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
