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
  APIKeysResponse,
  APIKeyInfo,
  UpdateAPIKeysPayload,
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
  onEvent: (event: string, data: any) => void
) {
  const res = await fetch('/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
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
  onEvent: (event: string, data: any) => void
) {
  const res = await fetch(`/v1/tasks/${taskId}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Resume failed' }));
    throw new Error(err.detail || `Server returned ${res.status}`);
  }
  await readSSEStream(res, onEvent);
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

