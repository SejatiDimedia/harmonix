import {
  HealthStatus,
  MetricSummary,
  ModelCatalogResponse,
  ChatSessionSummary,
  ChatSessionDetail,
  EngineType,
  DashboardListResponse,
  DashboardWidget,
  PinWidgetPayload,
  WidgetLayoutItem,
  APIKeysResponse,
  APIKeyInfo,
  UpdateAPIKeysPayload,
  FileUploadResponse,
  UploadSessionTablesResponse,
  TableHealthProfile,
  WatchdogRule,
  WatchdogLog,
  GoogleAuthStatus,
  GoogleSheetMetadata,
  GoogleSheetLink,
  CustomContext,
  SessionContextResponse,
} from '../types';

export async function getHealth(): Promise<HealthStatus> {
  const res = await fetch('/health');
  if (!res.ok) throw new Error('Health check failed');
  return res.json();
}

export async function getMetrics(): Promise<MetricSummary> {
  const res = await fetch('/v1/metrics');
  if (!res.ok) throw new Error('Failed to fetch metrics');
  return res.json();
}

export async function getModelCatalog(): Promise<ModelCatalogResponse> {
  const res = await fetch('/v1/models');
  if (!res.ok) throw new Error('Failed to fetch model catalog');
  return res.json();
}

export async function setActiveModels(payload: {
  analyst_provider: string;
  analyst_model: string;
  auditor_provider: string;
  auditor_model?: string | null;
}) {
  const res = await fetch('/v1/models/active', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to update active model' }));
    throw new Error(err.detail || 'Failed to update active model');
  }
  return res.json();
}

export async function getAPIKeys(): Promise<APIKeysResponse> {
  const res = await fetch('/v1/models/keys');
  if (!res.ok) throw new Error('Failed to fetch API keys status');
  return res.json();
}

export async function updateAPIKeys(payload: UpdateAPIKeysPayload): Promise<{
  status: string;
  message: string;
  keys: Record<string, APIKeyInfo>;
  catalog: ModelCatalogResponse;
}> {
  const res = await fetch('/v1/models/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to update API keys' }));
    throw new Error(err.detail || 'Failed to update API keys');
  }
  return res.json();
}

export async function getSessions(limit = 50): Promise<{ sessions: ChatSessionSummary[] }> {
  const res = await fetch(`/v1/sessions?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to load chat sessions');
  return res.json();
}

export async function getSessionDetails(sessionId: string): Promise<ChatSessionDetail> {
  const res = await fetch(`/v1/sessions/${sessionId}`);
  if (!res.ok) throw new Error('Failed to load session details');
  return res.json();
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const res = await fetch(`/v1/sessions/${sessionId}`, { method: 'DELETE' });
  return res.ok;
}

export async function renameSession(
  sessionId: string,
  title: string
): Promise<{ status: string; session_id: string; title: string }> {
  const res = await fetch(`/v1/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to rename session' }));
    throw new Error(err.detail || 'Failed to rename session');
  }
  return res.json();
}

export async function submitApproval(approvalId: string, decision: 'approved' | 'rejected', reason?: string) {
  const res = await fetch(`/v1/approvals/${approvalId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, reason }),
  });
  if (!res.ok) throw new Error('Approval submission failed');
  return res.json();
}

export interface ChatStreamParams {
  query: string;
  engine: EngineType;
  session_id: string;
  task_id?: string;
  provider?: string;
  model?: string;
  auditor_provider?: string;
  auditor_model?: string;
}

export async function readSSEStream(
  response: Response,
  onEvent: (event: string, data: any) => void
) {
  if (!response.body) throw new Error('No readable stream in response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = 'message';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.replace('event: ', '').trim();
      } else if (line.startsWith('data: ')) {
        const dataStr = line.replace('data: ', '').trim();
        try {
          const parsed = JSON.parse(dataStr);
          onEvent(currentEvent, parsed);
        } catch {
          onEvent(currentEvent, dataStr);
        }
      }
    }
  }
}

export async function sendChatMessage(
  params: ChatStreamParams,
  onEvent: (event: string, data: any) => void,
  signal?: AbortSignal
) {
  const res = await fetch('/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(err.detail || `Server returned ${res.status}`);
  }
  await readSSEStream(res, onEvent);
}

export async function resumeTask(
  taskId: string,
  feedback: string,
  onEvent: (event: string, data: any) => void,
  signal?: AbortSignal
) {
  const res = await fetch(`/v1/tasks/${taskId}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Resume failed' }));
    throw new Error(err.detail || `Server returned ${res.status}`);
  }
  await readSSEStream(res, onEvent);
}

export async function cancelTask(taskId: string): Promise<{ status: string; message: string }> {
  const res = await fetch(`/v1/tasks/${taskId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to cancel task' }));
    throw new Error(err.detail || 'Failed to cancel task');
  }
  return res.json();
}

export async function getDashboardWidgets(sessionId: string): Promise<DashboardListResponse> {
  const res = await fetch(`/v1/dashboard/${sessionId}`);
  if (!res.ok) {
    if (res.status === 404) return { session_id: sessionId, widgets: [], total: 0 };
    throw new Error('Failed to fetch dashboard widgets');
  }
  return res.json();
}

export async function pinDashboardWidget(payload: PinWidgetPayload): Promise<DashboardWidget> {
  const res = await fetch('/v1/dashboard/pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to pin widget' }));
    throw new Error(err.detail || 'Failed to pin widget');
  }
  return res.json();
}

export async function deleteDashboardWidget(widgetId: string): Promise<{ success: boolean }> {
  const res = await fetch(`/v1/dashboard/${widgetId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete widget');
  return res.json();
}

export async function refreshDashboardWidgets(sessionId: string): Promise<DashboardListResponse> {
  const res = await fetch(`/v1/dashboard/refresh/${sessionId}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to refresh dashboard widgets');
  return res.json();
}

export async function updateDashboardLayout(
  sessionId: string,
  layout: WidgetLayoutItem[]
): Promise<{ status: string; session_id: string; updated_count: number }> {
  const res = await fetch(`/v1/dashboard/layout/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout }),
  });
  if (!res.ok) throw new Error('Failed to update dashboard layout');
  return res.json();
}

export async function uploadSessionFiles(
  sessionId: string,
  files: File[]
): Promise<FileUploadResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  const res = await fetch(`/v1/sessions/${sessionId}/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to upload files' }));
    throw new Error(err.detail || 'Failed to upload files');
  }
  return res.json();
}

export async function getSessionUploadedTables(
  sessionId: string
): Promise<UploadSessionTablesResponse> {
  const res = await fetch(`/v1/sessions/${sessionId}/tables`);
  if (!res.ok) {
    throw new Error('Failed to load session data tables');
  }
  return res.json();
}

export async function getTableHealth(
  sessionId: string,
  tableName: string
): Promise<TableHealthProfile> {
  const res = await fetch(`/v1/sessions/${sessionId}/tables/${tableName}/health`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to load data health profile' }));
    throw new Error(err.detail || 'Failed to load data health profile');
  }
  return res.json();
}

export async function deleteUploadedTable(
  sessionId: string,
  tableName: string
): Promise<boolean> {
  const res = await fetch(`/v1/sessions/${sessionId}/tables/${tableName}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to delete data table' }));
    throw new Error(err.detail || 'Failed to delete data table');
  }
  return true;
}

// =============================================================================
// Batch Processing API (FR-42, Pilar 6.4)
// =============================================================================

export async function submitBatchJob(payload: {
  queries: string[];
  engine?: string;
  concurrency_limit?: number;
  provider?: string;
  model?: string;
  session_id?: string;
}): Promise<any> {
  const res = await fetch('/v1/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to submit batch job' }));
    throw new Error(err.detail || 'Failed to submit batch job');
  }
  return res.json();
}

export async function getBatchJob(batchId: string): Promise<any> {
  const res = await fetch(`/v1/batch/${batchId}`);
  if (!res.ok) throw new Error(`Batch '${batchId}' not found`);
  return res.json();
}

export async function listBatchJobs(): Promise<{ total: number; batches: any[] }> {
  const res = await fetch('/v1/batch');
  if (!res.ok) throw new Error('Failed to load batch job history');
  return res.json();
}

// =============================================================================
// Distributed Task Queue API (FR-43, Pilar 6.3)
// =============================================================================

export async function getQueueStatus(): Promise<any> {
  const res = await fetch('/v1/queue/status');
  if (!res.ok) throw new Error('Failed to load task queue status');
  return res.json();
}

export async function listQueueJobs(status?: string, limit = 50): Promise<{ total: number; jobs: any[] }> {
  const url = status ? `/v1/queue/jobs?status=${status}&limit=${limit}` : `/v1/queue/jobs?limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load task queue list');
  return res.json();
}

export async function retryQueueJob(jobId: string): Promise<any> {
  const res = await fetch(`/v1/queue/jobs/${jobId}/retry`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to retry task' }));
    throw new Error(err.detail || 'Failed to retry task');
  }
  return res.json();
}

// =============================================================================
// Watchdog & Metric Alerting API (FR-49)
// =============================================================================

export async function fetchWatchdogRules(sessionId?: string | null, scope?: string | null): Promise<{ total: number; rules: WatchdogRule[] }> {
  const params = new URLSearchParams();
  if (sessionId) params.append('session_id', sessionId);
  if (scope) params.append('scope', scope);
  const q = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/v1/watchdog/rules${q}`);
  if (!res.ok) throw new Error('Failed to load watchdog rules');
  return res.json();
}

export async function createWatchdogRule(rule: Partial<WatchdogRule>): Promise<{ status: string; message: string; rule: WatchdogRule }> {
  const res = await fetch('/v1/watchdog/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to create watchdog rule' }));
    throw new Error(err.detail || 'Failed to create watchdog rule');
  }
  return res.json();
}

export async function updateWatchdogRule(ruleId: number, rule: Partial<WatchdogRule>): Promise<{ status: string; message: string; rule: WatchdogRule }> {
  const res = await fetch(`/v1/watchdog/rules/${ruleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to update watchdog rule' }));
    throw new Error(err.detail || 'Failed to update watchdog rule');
  }
  return res.json();
}

export async function deleteWatchdogRule(ruleId: number): Promise<{ status: string; message: string }> {
  const res = await fetch(`/v1/watchdog/rules/${ruleId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to delete watchdog rule' }));
    throw new Error(err.detail || 'Failed to delete watchdog rule');
  }
  return res.json();
}

export async function runWatchdogRule(ruleId: number): Promise<{ status: string; message: string; result: WatchdogLog }> {
  const res = await fetch(`/v1/watchdog/rules/${ruleId}/run`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to run watchdog evaluation' }));
    throw new Error(err.detail || 'Failed to run watchdog evaluation');
  }
  return res.json();
}

export async function fetchWatchdogLogs(limit = 50, ruleId?: number, sessionId?: string | null): Promise<{ total: number; logs: WatchdogLog[] }> {
  const params = new URLSearchParams();
  params.append('limit', limit.toString());
  if (ruleId) params.append('rule_id', ruleId.toString());
  if (sessionId) params.append('session_id', sessionId);
  const res = await fetch(`/v1/watchdog/logs?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load watchdog logs');
  return res.json();
}

// Google Account OAuth & Sheets Integration (FR-50)

export async function getGoogleAuthUrl(sessionId: string): Promise<{ status: string; auth_url: string }> {
  const res = await fetch(`/v1/auth/google/login?session_id=${encodeURIComponent(sessionId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to generate Google auth URL' }));
    throw new Error(err.detail || 'Failed to generate Google auth URL');
  }
  return res.json();
}

export async function getGoogleAuthStatus(sessionId: string): Promise<GoogleAuthStatus> {
  const res = await fetch(`/v1/auth/google/status?session_id=${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error('Failed to fetch Google auth status');
  return res.json();
}

export async function disconnectGoogleAccount(sessionId: string): Promise<{ status: string }> {
  const res = await fetch(`/v1/auth/google/disconnect?session_id=${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to disconnect Google account');
  return res.json();
}

export async function getGoogleSheetsMetadata(sessionId: string, spreadsheetUrl: string): Promise<GoogleSheetMetadata> {
  const res = await fetch('/v1/google-sheets/metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, spreadsheet_url: spreadsheetUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to inspect Google Sheets metadata' }));
    throw new Error(err.detail || 'Failed to inspect Google Sheets metadata');
  }
  const data = await res.json();
  return data.metadata;
}

export async function importGoogleSheets(
  sessionId: string,
  spreadsheetUrl: string,
  selectedSheets?: string[]
): Promise<any> {
  const res = await fetch('/v1/google-sheets/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      spreadsheet_url: spreadsheetUrl,
      selected_sheets: selectedSheets,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to import Google Sheets' }));
    throw new Error(err.detail || 'Failed to import Google Sheets');
  }
  return res.json();
}

export async function resyncGoogleSheet(sheetLinkId: string): Promise<any> {
  const res = await fetch(`/v1/google-sheets/resync/${encodeURIComponent(sheetLinkId)}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to re-sync Google Sheet' }));
    throw new Error(err.detail || 'Failed to re-sync Google Sheet');
  }
  return res.json();
}

export async function listSessionGoogleSheets(sessionId: string): Promise<{ sheets: GoogleSheetLink[]; total: number }> {
  const res = await fetch(`/v1/google-sheets/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error('Failed to fetch linked Google Sheets');
  return res.json();
}

export async function removeGoogleSheet(sheetLinkId: string): Promise<{ status: string }> {
  const res = await fetch(`/v1/google-sheets/${encodeURIComponent(sheetLinkId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to remove Google Sheet link');
  return res.json();
}

export async function fetchSessionContext(sessionId: string): Promise<SessionContextResponse> {
  const res = await fetch(`/v1/sessions/${encodeURIComponent(sessionId)}/context`);
  if (!res.ok) throw new Error('Failed to fetch session context');
  return res.json();
}

export async function updateSessionContext(sessionId: string, context: CustomContext): Promise<SessionContextResponse> {
  const res = await fetch(`/v1/sessions/${encodeURIComponent(sessionId)}/context`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ custom_context: context }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to update session context' }));
    throw new Error(err.detail || 'Failed to update session context');
  }
  return res.json();
}

export async function promoteContextToGlossary(
  sessionId: string,
  payload: { metric_name: string; sql_formula?: string; description: string; domain?: string; relevant_tables?: string[] }
): Promise<any> {
  const res = await fetch(`/v1/sessions/${encodeURIComponent(sessionId)}/context/promote-glossary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to promote metric to glossary' }));
    throw new Error(err.detail || 'Failed to promote metric to glossary');
  }
  return res.json();
}

export async function clarifyTask(
  taskId: string,
  payload: { choice: string; context_key?: string; category?: string }
): Promise<any> {
  const res = await fetch(`/v1/tasks/${encodeURIComponent(taskId)}/clarify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to submit clarification' }));
    throw new Error(err.detail || 'Failed to submit clarification');
  }
  return res.json();
}




