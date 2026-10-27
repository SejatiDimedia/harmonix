export type EngineType = 'manual' | 'langgraph';

export interface TableData {
  columns: string[];
  rows: (string | number | null)[][];
  row_count?: number;
}

export interface ChartSpec {
  chart_type: string;
  title: string;
  x_axis: string;
  y_axis: string;
  data: Record<string, any>[];
}

export interface Citation {
  sql_query: string;
  metric_definition?: string;
  source_tables?: string[];
}

export interface MetricSummary {
  total_requests: number;
  success_rate_percentage: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  total_tokens_consumed: number;
  drift_detected: boolean;
  drift_reasons?: string[];
}

export interface AuditIssue {
  severity: string;
  category: string;
  description: string;
  suggested_fix?: string;
}

export interface AuditVerdict {
  status: 'passed' | 'warning' | 'flagged' | 'auditing';
  confidence_score?: number;
  badge?: string;
  critique?: string;
  issues?: AuditIssue[];
}

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
  is_free: boolean;
  context_length: number;
  description: string;
}

export interface ProviderCatalog {
  provider: string;
  display_name: string;
  category: 'local' | 'cloud_free' | 'openrouter' | 'gateway';
  is_ready: boolean;
  status_message: string;
  active_model: string;
  available_models: ModelOption[];
}

export interface ModelCatalogResponse {
  active_config: {
    analyst_provider: string;
    analyst_model: string;
    auditor_provider: string;
    auditor_model: string;
  };
  providers: ProviderCatalog[];
}

export interface APIKeyInfo {
  provider: string;
  display_name: string;
  is_set: boolean;
  masked_key: string | null;
  env_var: string;
  docs_url: string;
}

export interface APIKeysResponse {
  keys: Record<string, APIKeyInfo>;
}

export interface UpdateAPIKeysPayload {
  groq_api_key?: string | null;
  gemini_api_key?: string | null;
  openrouter_api_key?: string | null;
}

export interface ChatSessionSummary {
  session_id: string;
  title: string;
  total_turns: number;
  active_provider?: string;
  active_model?: string;
  created_at?: string;
  last_activity?: string;
}

export interface ChatTurn {
  task_id: string;
  status: string;
  user_query: string;
  answer_text?: string;
  sql_queries?: string[];
  tables?: TableData[];
  charts?: ChartSpec[];
  metrics?: {
    total_latency_ms?: number;
    ttft_ms?: number;
    total_tokens?: number;
  };
  follow_up_suggestions?: string[];
  audit_result?: AuditVerdict;
  created_at?: string;
}

export interface ChatSessionDetail {
  session_id: string;
  title: string;
  total_turns: number;
  active_provider?: string;
  active_model?: string;
  turns: ChatTurn[];
}

export interface ApprovalPayload {
  approval_id: string;
  task_id: string;
  sanitized_query?: string;
  risk_reasons: string[];
  sensitive_columns?: string[];
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'offline';
  database_connected: boolean;
  llm_provider: string;
  active_model: string;
  environment?: string;
}

export type ActiveTab = 'chat' | 'dashboard';

export type WidgetType = 'chart' | 'table' | 'kpi';

export interface DashboardWidget {
  widget_id: string;
  session_id: string;
  widget_type: WidgetType;
  title: string;
  sql_query?: string | null;
  chart_spec?: ChartSpec | null;
  table_data?: TableData | null;
  metric_summary?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface PinWidgetPayload {
  session_id: string;
  widget_type: WidgetType;
  title: string;
  sql_query?: string | null;
  chart_spec?: ChartSpec | null;
  table_data?: TableData | null;
  metric_summary?: string | null;
}

export interface DashboardListResponse {
  session_id: string;
  widgets: DashboardWidget[];
  total: number;
}

export interface UploadedColumnMeta {
  name: string;
  data_type: string;
  sample_values?: any[];
}

export interface UploadedTableSummary {
  table_name: string;
  original_filename: string;
  sheet_name: string;
  row_count: number;
  columns: UploadedColumnMeta[];
}

export interface UploadSessionTablesResponse {
  session_id: string;
  total_tables: number;
  tables: UploadedTableSummary[];
}

export interface FileUploadResponse {
  status: string;
  session_id: string;
  total_files: number;
  total_tables_created: number;
  tables: UploadedTableSummary[];
  warnings?: string[] | null;
}


