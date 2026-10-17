"""System metrics aggregation, dashboard statistics, and drift detection (OB-02, OB-03, OB-04)."""

import logging
from sqlalchemy import text

from src.db.connection import get_db_session
from src.observability.models import SystemMetricsSummary
from src.observability.tracer import init_traces_table

logger = logging.getLogger(__name__)


async def get_system_metrics_summary() -> SystemMetricsSummary:
    """Aggregate trace data from PostgreSQL to compute system-wide performance and drift alerts."""
    await init_traces_table()

    async with get_db_session() as session:
        # Aggregation query
        query = text("""
            SELECT 
                COUNT(*) as total_count,
                COUNT(*) FILTER (WHERE status = 'COMPLETED') as success_count,
                COUNT(*) FILTER (WHERE status = 'FAILED') as failed_count,
                COALESCE(AVG(total_latency_ms), 0) as avg_latency,
                COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_latency_ms), 0) as p50_latency,
                COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_latency_ms), 0) as p95_latency,
                COALESCE(AVG(ttft_ms), 0) as avg_ttft,
                COALESCE(SUM(total_tokens), 0) as total_tokens,
                COALESCE(SUM(tool_calls_count), 0) as total_tools,
                COALESCE(SUM(tool_errors_count), 0) as total_tool_errors
            FROM analytics.agent_traces;
        """)

        res = await session.execute(query)
        row = res.fetchone()

        if not row or row[0] == 0:
            return SystemMetricsSummary()

        total_requests = int(row[0])
        success_count = int(row[1])
        failed_count = int(row[2])
        avg_latency = round(float(row[3]), 2)
        p50_latency = round(float(row[4]), 2)
        p95_latency = round(float(row[5]), 2)
        avg_ttft = round(float(row[6]), 2)
        total_tokens = int(row[7])
        total_tools = int(row[8])
        total_tool_errors = int(row[9])

        success_rate = round((success_count / total_requests) * 100, 2) if total_requests > 0 else 0.0
        tool_failure_rate = (
            round((total_tool_errors / total_tools) * 100, 2) if total_tools > 0 else 0.0
        )

        # Drift & Anomaly Detection (OB-04)
        drift_reasons = []
        if p95_latency > 30000:
            drift_reasons.append(f"High p95 latency detected ({p95_latency}ms > 30,000ms threshold)")
        if tool_failure_rate > 10.0:
            drift_reasons.append(f"Elevated tool failure rate ({tool_failure_rate}% > 10% threshold)")
        if total_requests >= 5 and success_rate < 80.0:
            drift_reasons.append(f"Task success rate below baseline ({success_rate}% < 80% threshold)")

        return SystemMetricsSummary(
            total_requests=total_requests,
            successful_requests=success_count,
            failed_requests=failed_count,
            success_rate_percentage=success_rate,
            avg_latency_ms=avg_latency,
            p50_latency_ms=p50_latency,
            p95_latency_ms=p95_latency,
            avg_ttft_ms=avg_ttft,
            total_tokens_consumed=total_tokens,
            total_estimated_cost_usd=0.00,  # 100% Zero-Cost Baseline
            tool_failure_rate_percentage=tool_failure_rate,
            drift_detected=len(drift_reasons) > 0,
            drift_reasons=drift_reasons,
        )
