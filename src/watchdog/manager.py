"""Scheduled Query & Threshold Alerting Watchdog Engine (FR-49).

Monitors warehouse health and business metrics autonomously, detects anomalies,
executes automated root-cause diagnosis via zero-cost LLM, and dispatches rich webhooks.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Literal
import httpx
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.db.connection import get_db_session
from src.tools.database import RunSQLTool

logger = logging.getLogger("harmonix.watchdog")

RuleSeverity = Literal["info", "warning", "critical"]
RuleStatus = Literal["pending", "healthy", "triggered", "error"]


class WatchdogRuleCreate(BaseModel):
    rule_name: str = Field(..., max_length=150)
    description: str | None = None
    sql_query: str
    target_column: str
    operator: str = ">"
    threshold_value: float
    cron_interval_minutes: int = 60
    enabled: bool = True
    severity: RuleSeverity = "warning"
    webhook_url: str | None = None
    channel_type: str = "slack"
    ai_diagnosis_enabled: bool = True


class WatchdogRuleUpdate(BaseModel):
    rule_name: str | None = None
    description: str | None = None
    sql_query: str | None = None
    target_column: str | None = None
    operator: str | None = None
    threshold_value: float | None = None
    cron_interval_minutes: int | None = None
    enabled: bool | None = None
    severity: RuleSeverity | None = None
    webhook_url: str | None = None
    channel_type: str | None = None
    ai_diagnosis_enabled: bool | None = None


class WatchdogRuleModel(BaseModel):
    id: int
    rule_name: str
    description: str | None = None
    sql_query: str
    target_column: str
    operator: str
    threshold_value: float
    cron_interval_minutes: int
    enabled: bool
    severity: RuleSeverity
    webhook_url: str | None = None
    channel_type: str
    ai_diagnosis_enabled: bool
    last_run_at: datetime | None = None
    last_status: RuleStatus = "pending"
    last_metric_value: float | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class WatchdogLogModel(BaseModel):
    id: int
    rule_id: int
    rule_name: str | None = None
    metric_value: float | None = None
    threshold_value: float | None = None
    operator: str | None = None
    is_triggered: bool
    status: str
    ai_diagnosis_summary: str | None = None
    webhook_sent: bool = False
    webhook_response_code: int | None = None
    error_message: str | None = None
    created_at: datetime | None = None


# Module-level scheduler background task reference
_scheduler_running = False
_scheduler_task: asyncio.Task | None = None


async def init_watchdog_tables() -> None:
    """Initialize analytics.watchdog_rules and analytics.watchdog_logs tables."""
    async with get_db_session() as session:
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS analytics.watchdog_rules (
                id SERIAL PRIMARY KEY,
                rule_name VARCHAR(150) NOT NULL,
                description TEXT,
                sql_query TEXT NOT NULL,
                target_column VARCHAR(100) NOT NULL,
                operator VARCHAR(10) NOT NULL DEFAULT '>',
                threshold_value NUMERIC NOT NULL,
                cron_interval_minutes INT NOT NULL DEFAULT 60,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                severity VARCHAR(20) NOT NULL DEFAULT 'warning',
                webhook_url TEXT,
                channel_type VARCHAR(20) DEFAULT 'slack',
                ai_diagnosis_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                last_run_at TIMESTAMP WITH TIME ZONE,
                last_status VARCHAR(20) DEFAULT 'pending',
                last_metric_value NUMERIC,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """))

        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS analytics.watchdog_logs (
                id SERIAL PRIMARY KEY,
                rule_id INTEGER REFERENCES analytics.watchdog_rules(id) ON DELETE CASCADE,
                rule_name VARCHAR(150),
                metric_value NUMERIC,
                threshold_value NUMERIC,
                operator VARCHAR(10),
                is_triggered BOOLEAN NOT NULL,
                status VARCHAR(20) NOT NULL,
                ai_diagnosis_summary TEXT,
                webhook_sent BOOLEAN DEFAULT FALSE,
                webhook_response_code INT,
                error_message TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """))

        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_watchdog_logs_rule
            ON analytics.watchdog_logs(rule_id, created_at DESC);
        """))

        # Seed default watchdog rules if table is empty
        res = await session.execute(text("SELECT COUNT(*) FROM analytics.watchdog_rules;"))
        count = res.scalar() or 0
        if count == 0:
            await session.execute(text("""
                INSERT INTO analytics.watchdog_rules (
                    rule_name, description, sql_query, target_column, operator,
                    threshold_value, cron_interval_minutes, enabled, severity,
                    ai_diagnosis_enabled, channel_type
                ) VALUES
                (
                    'Tingkat Pembatalan Pesanan',
                    'Mendeteksi lonjakan persentase pesanan yang dibatalkan atau tidak tersedia oleh seller',
                    'SELECT ROUND((COUNT(*) FILTER (WHERE order_status IN (''canceled'', ''unavailable''))::NUMERIC / NULLIF(COUNT(*), 0)) * 100, 2) AS canceled_pct FROM analytics.orders;',
                    'canceled_pct',
                    '>',
                    3.5,
                    60,
                    TRUE,
                    'warning',
                    TRUE,
                    'slack'
                ),
                (
                    'Kepuasan Pelanggan Kritis',
                    'Peringatan otomatis saat rata-rata review kepuasan konsumen turun di bawah ambang batas',
                    'SELECT ROUND(AVG(review_score)::NUMERIC, 2) AS avg_score FROM analytics.reviews;',
                    'avg_score',
                    '<',
                    4.0,
                    120,
                    TRUE,
                    'critical',
                    TRUE,
                    'slack'
                ),
                (
                    'Lonjakan Ongkos Kirim Logistik',
                    'Memonitor kenaikan biaya pengiriman rata-rata pesanan di atas batas toleransi',
                    'SELECT ROUND(AVG(freight_value)::NUMERIC, 2) AS avg_freight FROM analytics.order_items;',
                    'avg_freight',
                    '>',
                    30000.0,
                    180,
                    TRUE,
                    'info',
                    TRUE,
                    'slack'
                );
            """))
            logger.info("Seeded initial watchdog rules for delivery and customer satisfaction monitoring.")

        await session.commit()
    logger.info("Watchdog schema initialized.")


def evaluate_condition(actual: float, operator: str, threshold: float) -> bool:
    """Compare metric value against threshold using standard mathematical operators."""
    op = operator.strip()
    if op == ">":
        return actual > threshold
    if op == ">=":
        return actual >= threshold
    if op == "<":
        return actual < threshold
    if op == "<=":
        return actual <= threshold
    if op in ("==", "="):
        return actual == threshold
    if op in ("!=", "<>"):
        return actual != threshold
    return False


async def run_ai_root_cause_diagnosis(
    rule_name: str,
    target_column: str,
    metric_value: float,
    operator: str,
    threshold: float,
    sql_query: str,
    query_result: dict[str, Any],
) -> str:
    """Generate concise 1-turn root cause diagnosis and recommendations using configured LLM."""
    try:
        from src.llm.provider import get_llm_provider
        provider = get_llm_provider()

        rows_preview = query_result.get("rows", [])[:5]
        columns = query_result.get("columns", [])

        prompt = (
            f"Anda adalah Agen Watchdog Analitik Harmonix. Sebuah anomali metrik baru saja terpicu:\n\n"
            f"- Aturan: {rule_name}\n"
            f"- Metrik: {target_column} bernilai {metric_value} (Ambang batas: {operator} {threshold})\n"
            f"- Query SQL: {sql_query}\n"
            f"- Sampel Data Baris ({len(rows_preview)} baris pertama):\n"
            f"  Kolom: {columns}\n"
            f"  Baris: {rows_preview}\n\n"
            f"Tulis ringkasan singkat dalam 2-3 kalimat formal Indonesia:\n"
            f"1. Analisis akar penyebab kemungkinan (root-cause insight).\n"
            f"2. Rekomendasi tindakan korektif cepat bagi tim operasional/bisnis.\n"
            f"Jangan gunakan format Markdown yang terlalu panjang, langsung ke intinya."
        )

        response = await provider.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        return (response.content or "Anomali terdeteksi melebihi ambang batas aman.").strip()
    except Exception as e:
        logger.warning("AI root cause diagnosis error: %s", e)
        return f"Anomali metrik terpicu ({target_column} = {metric_value}). Diagnosis AI tidak dapat dijalankan: {e}"


async def dispatch_webhook(
    webhook_url: str,
    channel_type: str,
    rule_name: str,
    severity: str,
    target_column: str,
    metric_value: float,
    operator: str,
    threshold: float,
    diagnosis: str | None,
) -> tuple[bool, int | None]:
    """Send alert notification payload to Slack, Discord, or generic webhook."""
    if not webhook_url:
        return False, None

    severity_label = severity.upper()
    title = f"[{severity_label}] Watchdog Alert: {rule_name}"
    message_text = (
        f"Metrik `{target_column}` saat ini: *{metric_value}* (Kondisi: {operator} {threshold})\n"
        f"Status: *Terpicu*\n"
    )
    if diagnosis:
        message_text += f"\n*Diagnosis AI Harmonix:*\n{diagnosis}"

    payload: dict[str, Any] = {}
    if channel_type.lower() == "discord":
        color = 0xEF4444 if severity == "critical" else (0xF59E0B if severity == "warning" else 0x3B82F6)
        payload = {
            "content": f"**Harmonix Watchdog Alert**",
            "embeds": [
                {
                    "title": title,
                    "description": message_text,
                    "color": color,
                    "footer": {"text": "Harmonix AI Data Platform • Automated Watchdog"},
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            ],
        }
    elif channel_type.lower() == "slack":
        payload = {
            "text": title,
            "blocks": [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": title, "emoji": False},
                },
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": message_text},
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": f"Harmonix Watchdog • {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
                        }
                    ],
                },
            ],
        }
    else:
        payload = {
            "source": "harmonix_watchdog",
            "rule_name": rule_name,
            "severity": severity,
            "metric": target_column,
            "current_value": metric_value,
            "operator": operator,
            "threshold": threshold,
            "diagnosis": diagnosis,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(webhook_url, json=payload)
            is_ok = 200 <= resp.status_code < 300
            return is_ok, resp.status_code
    except Exception as e:
        logger.warning("Webhook dispatch failed to %s: %s", webhook_url, e)
        return False, None


async def evaluate_rule(rule_id: int) -> WatchdogLogModel:
    """Execute SQL query, evaluate threshold, diagnose if triggered, dispatch webhook, and record log."""
    async with get_db_session() as session:
        rule_res = await session.execute(
            text("SELECT * FROM analytics.watchdog_rules WHERE id = :id;"),
            {"id": rule_id},
        )
        row = rule_res.mappings().fetchone()
        if not row:
            raise ValueError(f"Watchdog rule with id {rule_id} not found.")

    rule_name = row["rule_name"]
    sql_query = row["sql_query"]
    target_column = row["target_column"]
    operator = row["operator"]
    threshold_value = float(row["threshold_value"])
    severity = row["severity"]
    webhook_url = row["webhook_url"]
    channel_type = row["channel_type"] or "slack"
    ai_diagnosis_enabled = bool(row["ai_diagnosis_enabled"])

    tool = RunSQLTool()
    exec_res = await tool.execute(query=sql_query, is_approved=True)

    now = datetime.now(timezone.utc)
    metric_value: float | None = None
    is_triggered = False
    status_label: RuleStatus = "healthy"
    error_message: str | None = None
    diagnosis_summary: str | None = None
    webhook_sent = False
    webhook_code: int | None = None

    if exec_res.get("status") == "error":
        status_label = "error"
        error_message = exec_res.get("message", "Gagal mengeksekusi SQL Watchdog.")
    else:
        cols = [c.lower() for c in exec_res.get("columns", [])]
        rows = exec_res.get("rows", [])
        clean_target = target_column.lower().strip()

        col_idx = -1
        if clean_target in cols:
            col_idx = cols.index(clean_target)
        elif len(cols) == 1:
            col_idx = 0

        if col_idx == -1:
            status_label = "error"
            error_message = f"Kolom target '{target_column}' tidak ditemukan dalam hasil query: {cols}"
        elif not rows:
            status_label = "error"
            error_message = "Query tidak mengembalikan baris data apa pun."
        else:
            raw_val = rows[0][col_idx]
            try:
                metric_value = float(raw_val)
                is_triggered = evaluate_condition(metric_value, operator, threshold_value)
                status_label = "triggered" if is_triggered else "healthy"
            except (ValueError, TypeError) as e:
                status_label = "error"
                error_message = f"Nilai metrik tidak dapat dikonversi ke numerik: {raw_val} ({e})"

    if is_triggered and metric_value is not None:
        if ai_diagnosis_enabled:
            diagnosis_summary = await run_ai_root_cause_diagnosis(
                rule_name=rule_name,
                target_column=target_column,
                metric_value=metric_value,
                operator=operator,
                threshold=threshold_value,
                sql_query=sql_query,
                query_result=exec_res,
            )
        if webhook_url:
            webhook_sent, webhook_code = await dispatch_webhook(
                webhook_url=webhook_url,
                channel_type=channel_type,
                rule_name=rule_name,
                severity=severity,
                target_column=target_column,
                metric_value=metric_value,
                operator=operator,
                threshold=threshold_value,
                diagnosis=diagnosis_summary,
            )

    async with get_db_session() as session:
        log_res = await session.execute(
            text("""
                INSERT INTO analytics.watchdog_logs (
                    rule_id, rule_name, metric_value, threshold_value, operator,
                    is_triggered, status, ai_diagnosis_summary, webhook_sent,
                    webhook_response_code, error_message, created_at
                ) VALUES (
                    :rule_id, :rule_name, :metric_value, :threshold_value, :operator,
                    :is_triggered, :status, :ai_diagnosis_summary, :webhook_sent,
                    :webhook_response_code, :error_message, :created_at
                )
                RETURNING id;
            """),
            {
                "rule_id": rule_id,
                "rule_name": rule_name,
                "metric_value": metric_value,
                "threshold_value": threshold_value,
                "operator": operator,
                "is_triggered": is_triggered,
                "status": status_label,
                "ai_diagnosis_summary": diagnosis_summary,
                "webhook_sent": webhook_sent,
                "webhook_response_code": webhook_code,
                "error_message": error_message,
                "created_at": now,
            },
        )
        new_log_id = log_res.scalar()

        await session.execute(
            text("""
                UPDATE analytics.watchdog_rules
                SET last_run_at = :last_run_at,
                    last_status = :last_status,
                    last_metric_value = :last_metric_value,
                    updated_at = :updated_at
                WHERE id = :id;
            """),
            {
                "id": rule_id,
                "last_run_at": now,
                "last_status": status_label,
                "last_metric_value": metric_value,
                "updated_at": now,
            },
        )
        await session.commit()

    return WatchdogLogModel(
        id=new_log_id or 0,
        rule_id=rule_id,
        rule_name=rule_name,
        metric_value=metric_value,
        threshold_value=threshold_value,
        operator=operator,
        is_triggered=is_triggered,
        status=status_label,
        ai_diagnosis_summary=diagnosis_summary,
        webhook_sent=webhook_sent,
        webhook_response_code=webhook_code,
        error_message=error_message,
        created_at=now,
    )


async def list_rules() -> list[WatchdogRuleModel]:
    """List all watchdog rules ordered by id."""
    async with get_db_session() as session:
        res = await session.execute(text("SELECT * FROM analytics.watchdog_rules ORDER BY id ASC;"))
        rows = res.mappings().fetchall()
        return [WatchdogRuleModel(**dict(r)) for r in rows]


async def create_rule(input_data: WatchdogRuleCreate) -> WatchdogRuleModel:
    """Create a new watchdog monitoring rule."""
    async with get_db_session() as session:
        res = await session.execute(
            text("""
                INSERT INTO analytics.watchdog_rules (
                    rule_name, description, sql_query, target_column, operator,
                    threshold_value, cron_interval_minutes, enabled, severity,
                    webhook_url, channel_type, ai_diagnosis_enabled
                ) VALUES (
                    :rule_name, :description, :sql_query, :target_column, :operator,
                    :threshold_value, :cron_interval_minutes, :enabled, :severity,
                    :webhook_url, :channel_type, :ai_diagnosis_enabled
                )
                RETURNING *;
            """),
            input_data.model_dump(),
        )
        row = res.mappings().fetchone()
        await session.commit()
        return WatchdogRuleModel(**dict(row))


async def update_rule(rule_id: int, input_data: WatchdogRuleUpdate) -> WatchdogRuleModel:
    """Update fields of an existing watchdog rule."""
    updates = {k: v for k, v in input_data.model_dump().items() if v is not None}
    if not updates:
        rules = await list_rules()
        for r in rules:
            if r.id == rule_id:
                return r
        raise ValueError(f"Rule {rule_id} not found.")

    updates["updated_at"] = datetime.now(timezone.utc)
    set_clauses = [f"{k} = :{k}" for k in updates.keys()]

    async with get_db_session() as session:
        updates["id"] = rule_id
        res = await session.execute(
            text(f"UPDATE analytics.watchdog_rules SET {', '.join(set_clauses)} WHERE id = :id RETURNING *;"),
            updates,
        )
        row = res.mappings().fetchone()
        if not row:
            raise ValueError(f"Rule {rule_id} not found.")
        await session.commit()
        return WatchdogRuleModel(**dict(row))


async def delete_rule(rule_id: int) -> bool:
    """Delete a watchdog rule and its cascade logs."""
    async with get_db_session() as session:
        res = await session.execute(
            text("DELETE FROM analytics.watchdog_rules WHERE id = :id RETURNING id;"),
            {"id": rule_id},
        )
        deleted = res.scalar()
        await session.commit()
        return deleted is not None


async def get_logs(limit: int = 50, rule_id: int | None = None) -> list[WatchdogLogModel]:
    """Retrieve recent watchdog execution logs."""
    async with get_db_session() as session:
        if rule_id:
            res = await session.execute(
                text("SELECT * FROM analytics.watchdog_logs WHERE rule_id = :rule_id ORDER BY created_at DESC LIMIT :limit;"),
                {"rule_id": rule_id, "limit": limit},
            )
        else:
            res = await session.execute(
                text("SELECT * FROM analytics.watchdog_logs ORDER BY created_at DESC LIMIT :limit;"),
                {"limit": limit},
            )
        rows = res.mappings().fetchall()
        return [WatchdogLogModel(**dict(r)) for r in rows]


async def run_scheduler_tick() -> None:
    """Inspect enabled rules and evaluate those due for their interval."""
    try:
        rules = await list_rules()
        now = datetime.now(timezone.utc)
        for r in rules:
            if not r.enabled:
                continue

            is_due = False
            if r.last_run_at is None:
                is_due = True
            else:
                elapsed_minutes = (now - r.last_run_at).total_seconds() / 60.0
                if elapsed_minutes >= r.cron_interval_minutes:
                    is_due = True

            if is_due:
                logger.info("Executing scheduled watchdog rule #%d: %s", r.id, r.rule_name)
                try:
                    await evaluate_rule(r.id)
                except Exception as e:
                    logger.error("Error evaluating scheduled watchdog rule #%d: %s", r.id, e)
    except Exception as e:
        logger.error("Watchdog scheduler tick error: %s", e)


async def start_watchdog_scheduler() -> None:
    """Background loop running periodic checks every 60 seconds."""
    global _scheduler_running
    _scheduler_running = True
    logger.info("Watchdog background scheduler started.")
    while _scheduler_running:
        try:
            await run_scheduler_tick()
        except Exception as e:
            logger.error("Unexpected error in watchdog scheduler loop: %s", e)
        await asyncio.sleep(60)


def stop_watchdog_scheduler() -> None:
    """Gracefully signal the background scheduler loop to stop."""
    global _scheduler_running
    _scheduler_running = False
    logger.info("Watchdog background scheduler stopped.")
