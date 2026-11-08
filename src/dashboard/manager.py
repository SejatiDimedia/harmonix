"""Live BI Dashboard Canvas & Widget Manager (FR-37).

Enables pinning interactive charts, tables, and metric KPIs to a persistent dashboard,
with 0-LLM-cost batch data refresh against PostgreSQL.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Literal
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.db.connection import get_db_session
from src.tools.database import RunSQLTool

logger = logging.getLogger(__name__)

WidgetType = Literal["chart", "table", "kpi"]
LayoutSpan = Literal["half", "full"]


class DashboardWidgetModel(BaseModel):
    widget_id: str
    session_id: str
    widget_type: WidgetType
    title: str
    sql_query: str | None = None
    chart_spec: dict[str, Any] | None = None
    table_data: dict[str, Any] | None = None
    metric_summary: str | None = None
    layout_position: int = 0
    layout_span: LayoutSpan = "half"
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PinWidgetInput(BaseModel):
    session_id: str
    widget_type: WidgetType
    title: str
    sql_query: str | None = None
    chart_spec: dict[str, Any] | None = None
    table_data: dict[str, Any] | None = None
    metric_summary: str | None = None
    layout_position: int = 0
    layout_span: LayoutSpan = "half"


class WidgetLayoutItem(BaseModel):
    widget_id: str
    position: int
    span: LayoutSpan = "half"


async def init_dashboard_table() -> None:
    """Initialize analytics.dashboard_widgets table in PostgreSQL with layout support."""
    async with get_db_session() as session:
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS analytics.dashboard_widgets (
                widget_id VARCHAR(100) PRIMARY KEY,
                session_id VARCHAR(100) NOT NULL,
                widget_type VARCHAR(30) NOT NULL,
                title TEXT NOT NULL,
                sql_query TEXT,
                chart_spec JSONB,
                table_data JSONB,
                metric_summary TEXT,
                layout_position INT DEFAULT 0,
                layout_span VARCHAR(20) DEFAULT 'half',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """))

        # Add columns if table already existed without layout columns
        await session.execute(text("""
            ALTER TABLE analytics.dashboard_widgets
            ADD COLUMN IF NOT EXISTS layout_position INT DEFAULT 0;
        """))
        await session.execute(text("""
            ALTER TABLE analytics.dashboard_widgets
            ADD COLUMN IF NOT EXISTS layout_span VARCHAR(20) DEFAULT 'half';
        """))

        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_session
            ON analytics.dashboard_widgets(session_id);
        """))
        await session.commit()
    logger.info("Initialized analytics.dashboard_widgets table, layout columns, and index.")


async def pin_widget(payload: PinWidgetInput) -> DashboardWidgetModel:
    """Pin a chart, table, or KPI metric widget to a session's dashboard."""
    widget_id = f"wgt_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)

    async with get_db_session() as session:
        max_pos_res = await session.execute(
            text("SELECT COALESCE(MAX(layout_position), -1) FROM analytics.dashboard_widgets WHERE session_id = :session_id;"),
            {"session_id": payload.session_id},
        )
        current_max = max_pos_res.scalar()
        if current_max is None or current_max < 0:
            assigned_pos = 0
        else:
            assigned_pos = payload.layout_position if payload.layout_position > 0 else (current_max + 1)

        await session.execute(
            text("""
                INSERT INTO analytics.dashboard_widgets (
                    widget_id,
                    session_id,
                    widget_type,
                    title,
                    sql_query,
                    chart_spec,
                    table_data,
                    metric_summary,
                    layout_position,
                    layout_span,
                    created_at,
                    updated_at
                ) VALUES (
                    :widget_id,
                    :session_id,
                    :widget_type,
                    :title,
                    :sql_query,
                    :chart_spec,
                    :table_data,
                    :metric_summary,
                    :layout_position,
                    :layout_span,
                    :created_at,
                    :updated_at
                );
            """),
            {
                "widget_id": widget_id,
                "session_id": payload.session_id,
                "widget_type": payload.widget_type,
                "title": payload.title,
                "sql_query": payload.sql_query,
                "chart_spec": json.dumps(payload.chart_spec) if payload.chart_spec else None,
                "table_data": json.dumps(payload.table_data) if payload.table_data else None,
                "metric_summary": payload.metric_summary,
                "layout_position": assigned_pos,
                "layout_span": payload.layout_span,
                "created_at": now,
                "updated_at": now,
            },
        )
        await session.commit()

    return DashboardWidgetModel(
        widget_id=widget_id,
        session_id=payload.session_id,
        widget_type=payload.widget_type,
        title=payload.title,
        sql_query=payload.sql_query,
        chart_spec=payload.chart_spec,
        table_data=payload.table_data,
        metric_summary=payload.metric_summary,
        layout_position=assigned_pos,
        layout_span=payload.layout_span,
        created_at=now,
        updated_at=now,
    )


async def get_dashboard_widgets(session_id: str) -> list[DashboardWidgetModel]:
    """Retrieve all pinned widgets for a given session, sorted by layout position."""
    async with get_db_session() as session:
        result = await session.execute(
            text("""
                SELECT
                    widget_id,
                    session_id,
                    widget_type,
                    title,
                    sql_query,
                    chart_spec,
                    table_data,
                    metric_summary,
                    COALESCE(layout_position, 0) as layout_position,
                    COALESCE(layout_span, 'half') as layout_span,
                    created_at,
                    updated_at
                FROM analytics.dashboard_widgets
                WHERE session_id = :session_id
                ORDER BY layout_position ASC, created_at ASC;
            """),
            {"session_id": session_id},
        )
        rows = result.fetchall()

    widgets = []
    for r in rows:
        chart_spec = r[5]
        if isinstance(chart_spec, str):
            try:
                chart_spec = json.loads(chart_spec)
            except Exception:
                pass

        table_data = r[6]
        if isinstance(table_data, str):
            try:
                table_data = json.loads(table_data)
            except Exception:
                pass

        widgets.append(
            DashboardWidgetModel(
                widget_id=r[0],
                session_id=r[1],
                widget_type=r[2],
                title=r[3],
                sql_query=r[4],
                chart_spec=chart_spec,
                table_data=table_data,
                metric_summary=r[7],
                layout_position=int(r[8]),
                layout_span=r[9] if r[9] in ("half", "full") else "half",
                created_at=r[10],
                updated_at=r[11],
            )
        )
    return widgets


async def update_dashboard_layout(
    session_id: str,
    items: list[WidgetLayoutItem],
) -> int:
    """Update layout position and grid span for multiple widgets in a dashboard session (FR-47)."""
    if not items:
        return 0

    now = datetime.now(timezone.utc)
    updated_count = 0

    async with get_db_session() as session:
        for item in items:
            result = await session.execute(
                text("""
                    UPDATE analytics.dashboard_widgets
                    SET
                        layout_position = :position,
                        layout_span = :span,
                        updated_at = :updated_at
                    WHERE widget_id = :widget_id AND session_id = :session_id;
                """),
                {
                    "position": item.position,
                    "span": item.span,
                    "updated_at": now,
                    "widget_id": item.widget_id,
                    "session_id": session_id,
                },
            )
            updated_count += result.rowcount
        await session.commit()

    return updated_count


async def delete_dashboard_widget(widget_id: str) -> bool:
    """Delete/unpin a widget from the dashboard."""
    async with get_db_session() as session:
        result = await session.execute(
            text("DELETE FROM analytics.dashboard_widgets WHERE widget_id = :widget_id;"),
            {"widget_id": widget_id},
        )
        await session.commit()
        return result.rowcount > 0


async def refresh_dashboard_widgets(session_id: str) -> list[DashboardWidgetModel]:
    """Deterministically refresh all pinned widgets via SQL execution (0 LLM Cost)."""
    widgets = await get_dashboard_widgets(session_id)
    if not widgets:
        return []

    sql_tool = RunSQLTool()
    now = datetime.now(timezone.utc)

    for widget in widgets:
        if not widget.sql_query:
            continue

        try:
            exec_res = await sql_tool.execute(query=widget.sql_query, is_approved=True)
            if exec_res.get("status") == "success":
                columns = exec_res.get("columns", [])
                rows = exec_res.get("rows", [])
                new_table_data = {
                    "columns": columns,
                    "rows": rows,
                    "row_count": len(rows),
                }
                widget.table_data = new_table_data

                # If this widget has a chart_spec, refresh its data rows based on x_axis and y_axis
                if widget.chart_spec and isinstance(widget.chart_spec, dict):
                    x_col = widget.chart_spec.get("x_axis")
                    y_col = widget.chart_spec.get("y_axis")
                    if x_col in columns and y_col in columns:
                        x_idx = columns.index(x_col)
                        y_idx = columns.index(y_col)
                        new_data = [
                            {x_col: row[x_idx], y_col: row[y_idx]}
                            for row in rows
                        ]
                        widget.chart_spec["data"] = new_data
                    elif len(columns) >= 2:
                        # Fallback to first two columns
                        x_col_fallback = columns[0]
                        y_col_fallback = columns[1]
                        widget.chart_spec["data"] = [
                            {x_col_fallback: row[0], y_col_fallback: row[1]}
                            for row in rows
                        ]

                # Update database record
                async with get_db_session() as session:
                    await session.execute(
                        text("""
                            UPDATE analytics.dashboard_widgets
                            SET
                                table_data = :table_data,
                                chart_spec = :chart_spec,
                                updated_at = :updated_at
                            WHERE widget_id = :widget_id;
                        """),
                        {
                            "table_data": json.dumps(widget.table_data) if widget.table_data else None,
                            "chart_spec": json.dumps(widget.chart_spec) if widget.chart_spec else None,
                            "updated_at": now,
                            "widget_id": widget.widget_id,
                        },
                    )
                    await session.commit()
                widget.updated_at = now
        except Exception as e:
            logger.warning("Failed to refresh widget %s: %s", widget.widget_id, e)

    return widgets
