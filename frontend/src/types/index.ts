export type EngineType = 'manual' | 'langgraph' | 'swarm';

export interface SubTaskSpec {
  id: number;
  role: 'sql_specialist' | 'calc_specialist' | 'chart_specialist' | 'general_analyst' | string;
  title: string;
  instruction: string;
  expected_output: string;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | string;
  result_summary?: string | null;
  duration_ms?: number;
}

export interface ExecutionPlan {
  goal: string;
  complexity_level?: string;
  reasoning?: string;
  tasks: SubTaskSpec[];
}

export interface TableData {
  columns: string[];
  rows: (string | number | null)[][];
  row_count?: number;
  sql_query?: string | null;
}

export interface ChartSpec {
  chart_type: string;
  title: string;
  x_axis: string;
  y_axis: string;
  data: Record<string, any>[];
  sql_query?: string | null;
}

export interface Citation {
  sql_query: string;
  metric_definition?: string;
  source_tables?: string[];
}

export interface MetricSummary {
  total_requests: number;
  successful_requests?: number;
  failed_requests?: number;
  error_count?: number;
  error_rate?: number;
  success_rate_percentage: number;
  avg_latency_ms?: number;
  avg_total_latency_ms?: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  avg_ttft_ms?: number;
  avg_db_execution_ms?: number;
  total_tokens_consumed: number;
  total_prompt_tokens?: number;
  total_completion_tokens?: number;
  total_cached_tokens?: number;
  total_estimated_cost_usd?: number;
  tool_failure_rate_percentage?: number;
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

export interface LongTermMemoryItem {
  id?: number;
  memory_type: string;
  question_text: string;
  sql_query?: string | null;
  explanation?: string | null;
  tables_used?: string[];
  similarity?: number;
  success_count?: number;
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
    cached_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  follow_up_suggestions?: string[];
  audit_result?: AuditVerdict;
  memories_recalled?: LongTermMemoryItem[];
  working_memory?: Record<string, string>;
  execution_plan?: ExecutionPlan;
  created_at?: string;
}

export interface ChatSessionDetail {
  session_id: string;
  title: string;
  total_turns: number;
  compacted_summary?: string | null;
  compacted_turn_count?: number;
  active_provider?: string;
  active_model?: string;
  turns: ChatTurn[];
}

export interface ApprovalPayload {
  approval_id: string;
  task_id: string;
  user_query?: string;
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

export type ActiveTab = 'chat' | 'dashboard' | 'batch' | 'design-system';

export interface BatchQueryItem {
  query_id: string;
  query: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  answer_text?: string | null;
  sql_queries?: string[];
  tables?: Array<{ columns: string[]; rows: (string | number | null)[][]; row_count?: number }>;
  row_count?: number;
  error?: string | null;
  duration_ms?: number;
}

export interface BatchJobRecord {
  batch_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total_queries: number;
  completed_queries: number;
  failed_queries: number;
  engine: string;
  model?: string;
  provider?: string;
  items: BatchQueryItem[];
  created_at: number;
  completed_at?: number | null;
  total_duration_sec?: number;
}

export interface WorkerHeartbeat {
  worker_id: string;
  status: string;
  concurrency: number;
  active_jobs: number;
  jobs_completed: number;
  jobs_failed: number;
  started_at: number;
  last_heartbeat_at: number;
}

export interface QueueStats {
  backend: string;
  total_jobs: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  retrying: number;
  dead_letter: number;
  active_workers: number;
  workers: WorkerHeartbeat[];
}

export interface QueueJob {
  job_id: string;
  job_type: string;
  payload: Record<string, any>;
  priority: number;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'RETRYING' | 'DEAD_LETTER';
  attempts: number;
  max_retries: number;
  last_error?: string | null;
  result?: Record<string, any> | null;
  worker_id?: string | null;
  created_at: number;
  started_at?: number | null;
  completed_at?: number | null;
  duration_ms?: number;
}

export type WidgetType = 'chart' | 'table' | 'kpi';
export type LayoutSpan = 'half' | 'full' | 'third' | (string & {});
export type LayoutHeight = 'compact' | 'normal' | 'tall' | (string & {});

export interface DashboardWidget {
  widget_id: string;
  session_id: string;
  widget_type: WidgetType;
  title: string;
  sql_query?: string | null;
  chart_spec?: ChartSpec | null;
  table_data?: TableData | null;
  metric_summary?: string | null;
  layout_position?: number;
  layout_span?: LayoutSpan;
  layout_height?: LayoutHeight;
  created_at: string;
  updated_at?: string;
}

export interface WidgetLayoutItem {
  widget_id: string;
  position: number;
  span: LayoutSpan;
  height?: LayoutHeight;
}

export interface UpdateDashboardLayoutPayload {
  layout: WidgetLayoutItem[];
}

export interface PinWidgetPayload {
  session_id: string;
  widget_type: WidgetType;
  title: string;
  sql_query?: string | null;
  chart_spec?: ChartSpec | null;
  table_data?: TableData | null;
  metric_summary?: string | null;
  layout_position?: number;
  layout_span?: LayoutSpan;
  layout_height?: LayoutHeight;
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

export interface ColumnHealthSummary {
  column_name: string;
  data_type: string;
  total_count: number;
  null_count: number;
  null_rate_pct: number;
  distinct_count: number;
  is_unique: boolean;
  is_primary_key_candidate: boolean;
  min_value?: any;
  max_value?: any;
  mean_value?: number | null;
  median_value?: number | null;
  stddev_value?: number | null;
  q1?: number | null;
  q3?: number | null;
  iqr?: number | null;
  outlier_count: number;
  outlier_rate_pct: number;
  suspicious_negatives: number;
  suspicious_zeros: number;
  top_categories?: { value: string; count: number; pct: number }[];
}

export interface DataAnomalyItem {
  anomaly_id: string;
  column_name?: string | null;
  category: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  affected_rows: number;
  affected_rate_pct: number;
}

export interface QuickActionPrompt {
  id: string;
  title: string;
  prompt: string;
  category: string;
}

export interface TableHealthProfile {
  table_name: string;
  qualified_name: string;
  session_id?: string | null;
  original_filename?: string | null;
  sheet_name?: string | null;
  total_rows: number;
  total_columns: number;
  total_cells: number;
  duplicate_rows: number;
  duplicate_rate_pct: number;
  overall_completeness_pct: number;
  health_score: number;
  health_grade: 'Prima' | 'Perhatian' | 'Kritis';
  health_badge_color: 'emerald' | 'amber' | 'rose';
  column_profiles: ColumnHealthSummary[];
  anomalies: DataAnomalyItem[];
  quick_prompts: QuickActionPrompt[];
  scanned_at: string;
}

export interface WatchdogRule {
  id: number;
  rule_name: string;
  description?: string | null;
  sql_query: string;
  target_column: string;
  operator: string;
  threshold_value: number;
  cron_interval_minutes: number;
  enabled: boolean;
  severity: 'info' | 'warning' | 'critical';
  webhook_url?: string | null;
  channel_type: string;
  ai_diagnosis_enabled: boolean;
  last_run_at?: string | null;
  last_status: 'pending' | 'healthy' | 'triggered' | 'error';
  last_metric_value?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface WatchdogLog {
  id: number;
  rule_id: number;
  rule_name?: string | null;
  metric_value?: number | null;
  threshold_value?: number | null;
  operator?: string | null;
  is_triggered: boolean;
  status: string;
  ai_diagnosis_summary?: string | null;
  webhook_sent: boolean;
  webhook_response_code?: number | null;
  error_message?: string | null;
  created_at?: string | null;
}


