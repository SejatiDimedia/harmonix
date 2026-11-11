import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getHealth,
  getMetrics,
  getModelCatalog,
  getAPIKeys,
  updateAPIKeys,
  getSessions,
  getSessionDetails,
  deleteSession,
  renameSession,
  getDashboardWidgets,
  pinDashboardWidget,
  deleteDashboardWidget,
  refreshDashboardWidgets,
  uploadSessionFiles,
  getSessionUploadedTables,
  getTableHealth,
  deleteUploadedTable,
  fetchWatchdogRules,
  createWatchdogRule,
  updateWatchdogRule,
  deleteWatchdogRule,
  runWatchdogRule,
  fetchWatchdogLogs,
  getGoogleAuthStatus,
  disconnectGoogleAccount,
  listSessionGoogleSheets,
  importGoogleSheets,
  resyncGoogleSheet,
  removeGoogleSheet,
} from '../services/api';
import { PinWidgetPayload, UpdateAPIKeysPayload, WatchdogRule } from '../types';

export const useHealthQuery = () => {
  return useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 30000,
  });
};

export const useCatalogQuery = () => {
  return useQuery({
    queryKey: ['models'],
    queryFn: getModelCatalog,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useApiKeysQuery = () => {
  return useQuery({
    queryKey: ['api-keys'],
    queryFn: getAPIKeys,
  });
};

export const useUpdateApiKeysMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateAPIKeysPayload) => updateAPIKeys(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(['models'], data.catalog);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      queryClient.invalidateQueries({ queryKey: ['models'] });
    },
  });
};

export const useSessionsQuery = () => {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => getSessions(50),
  });
};

export const useSessionDetailsQuery = (sessionId: string | null) => {
  return useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => getSessionDetails(sessionId!),
    enabled: !!sessionId,
  });
};

export const useMetricsQuery = () => {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: getMetrics,
  });
};

export const useDashboardQuery = (sessionId: string | null) => {
  return useQuery({
    queryKey: ['dashboard', sessionId],
    queryFn: () => getDashboardWidgets(sessionId!),
    enabled: !!sessionId,
  });
};

export const useDeleteSessionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
};

export const useRenameSessionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      renameSession(sessionId, title),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['session', variables.sessionId] });
    },
  });
};

export const usePinWidgetMutation = (sessionId?: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PinWidgetPayload) => pinDashboardWidget(payload),
    onSuccess: (_data, variables) => {
      const targetSession = variables.session_id || sessionId;
      if (targetSession) {
        queryClient.invalidateQueries({ queryKey: ['dashboard', targetSession] });
      }
    },
  });
};

export const useDeleteWidgetMutation = (sessionId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (widgetId: string) => deleteDashboardWidget(widgetId),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['dashboard', sessionId] });
      }
    },
  });
};

export const useRefreshDashboardMutation = (sessionId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refreshDashboardWidgets(sessionId!),
    onSuccess: (data) => {
      if (sessionId) {
        queryClient.setQueryData(['dashboard', sessionId], data);
      }
    },
  });
};

export const useSessionUploadedTablesQuery = (sessionId: string | null) => {
  return useQuery({
    queryKey: ['session-uploaded-tables', sessionId],
    queryFn: () => getSessionUploadedTables(sessionId!),
    enabled: !!sessionId,
  });
};

export const useUploadSessionFilesMutation = (sessionId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => uploadSessionFiles(sessionId!, files),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['session-uploaded-tables', sessionId] });
      }
    },
  });
};

export const useTableHealthQuery = (sessionId: string | null, tableName: string | null) => {
  return useQuery({
    queryKey: ['table-health', sessionId, tableName],
    queryFn: () => getTableHealth(sessionId || 'default', tableName!),
    enabled: !!tableName,
    staleTime: 1000 * 60 * 5,
  });
};

export const useDeleteUploadedTableMutation = (sessionId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tableName: string) => deleteUploadedTable(sessionId || 'default', tableName),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['session-uploaded-tables', sessionId] });
      }
    },
  });
};

// =============================================================================
// Watchdog Query & Mutation Hooks
// =============================================================================

export const useWatchdogRulesQuery = (sessionId?: string | null, scope?: string | null) => {
  return useQuery({
    queryKey: ['watchdog-rules', sessionId || 'all', scope || 'all'],
    queryFn: () => fetchWatchdogRules(sessionId, scope),
    refetchInterval: 30000,
  });
};

export const useWatchdogLogsQuery = (limit = 50, ruleId?: number, sessionId?: string | null) => {
  return useQuery({
    queryKey: ['watchdog-logs', limit, ruleId || 'all', sessionId || 'all'],
    queryFn: () => fetchWatchdogLogs(limit, ruleId, sessionId),
    refetchInterval: 15000,
  });
};

export const useCreateWatchdogRuleMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rule: Partial<WatchdogRule>) => createWatchdogRule(rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchdog-rules'] });
    },
  });
};

export const useUpdateWatchdogRuleMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, rule }: { ruleId: number; rule: Partial<WatchdogRule> }) =>
      updateWatchdogRule(ruleId, rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchdog-rules'] });
    },
  });
};

export const useDeleteWatchdogRuleMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: number) => deleteWatchdogRule(ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchdog-rules'] });
      queryClient.invalidateQueries({ queryKey: ['watchdog-logs'] });
    },
  });
};

export const useRunWatchdogRuleMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: number) => runWatchdogRule(ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchdog-rules'] });
      queryClient.invalidateQueries({ queryKey: ['watchdog-logs'] });
    },
  });
};

// Google Account OAuth & Sheets Hooks (FR-50)

export const useGoogleAuthStatusQuery = (sessionId: string | null) => {
  return useQuery({
    queryKey: ['google-auth-status', sessionId],
    queryFn: () => getGoogleAuthStatus(sessionId!),
    enabled: !!sessionId,
    staleTime: 1000 * 30,
  });
};

export const useSessionGoogleSheetsQuery = (sessionId: string | null) => {
  return useQuery({
    queryKey: ['session-google-sheets', sessionId],
    queryFn: () => listSessionGoogleSheets(sessionId!),
    enabled: !!sessionId,
  });
};

export const useImportGoogleSheetsMutation = (sessionId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ url, selectedSheets }: { url: string; selectedSheets?: string[] }) =>
      importGoogleSheets(sessionId!, url, selectedSheets),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['session-uploaded-tables', sessionId] });
        queryClient.invalidateQueries({ queryKey: ['session-google-sheets', sessionId] });
      }
    },
  });
};

export const useResyncGoogleSheetMutation = (sessionId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sheetLinkId: string) => resyncGoogleSheet(sheetLinkId),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['session-uploaded-tables', sessionId] });
        queryClient.invalidateQueries({ queryKey: ['session-google-sheets', sessionId] });
        queryClient.invalidateQueries({ queryKey: ['dashboard', sessionId] });
      }
    },
  });
};

export const useRemoveGoogleSheetMutation = (sessionId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sheetLinkId: string) => removeGoogleSheet(sheetLinkId),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['session-uploaded-tables', sessionId] });
        queryClient.invalidateQueries({ queryKey: ['session-google-sheets', sessionId] });
      }
    },
  });
};

export const useDisconnectGoogleMutation = (sessionId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectGoogleAccount(sessionId!),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['google-auth-status', sessionId] });
      }
    },
  });
};

