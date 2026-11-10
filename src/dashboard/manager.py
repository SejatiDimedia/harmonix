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
LayoutSpan = str  # 'half', 'full', 'third', or column count '3'..'12'
LayoutHeight = str  # 'compact', 'normal', 'tall', or pixel height '280'..'900'


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
    layout_height: LayoutHeight = "normal"
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
    layout_height: LayoutHeight = "normal"


class WidgetLayoutItem(BaseModel):
    widget_id: str
    position: int
    span: LayoutSpan = "half"
    height: LayoutHeight = "normal"


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
                layout_height VARCHAR(20) DEFAULT 'normal',
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
            ALTER TABLE analytics.dashboard_widgets
            ADD COLUMN IF NOT EXISTS layout_height VARCHAR(20) DEFAULT 'normal';
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

    # Guard against raw schema probe tables being pinned as chart data
    sanitized_table_data = payload.table_data
    if sanitized_table_data and isinstance(sanitized_table_data, dict):
        cols = sanitized_table_data.get("columns", [])
        if any(c == "_row_id" or str(c).startswith("unnamed_") for c in cols):
            sanitized_table_data = None

    resolved_sql = payload.sql_query
    # Defensive guard: if sql_query is missing or is an exploratory probe SELECT * ... LIMIT 5/10
    is_probe_sql = False
    if resolved_sql:
        r_lower = resolved_sql.lower()
        if "select *" in r_lower and ("limit 5" in r_lower or "limit 10" in r_lower) and "group by" not in r_lower and "join" not in r_lower:
            is_probe_sql = True

    if (not resolved_sql or is_probe_sql) and payload.chart_spec and isinstance(payload.chart_spec, dict):
        cs_sql = payload.chart_spec.get("sql_query")
        if cs_sql:
            cs_lower = cs_sql.lower()
            if not ("select *" in cs_lower and ("limit 5" in cs_lower or "limit 10" in cs_lower) and "group by" not in cs_lower and "join" not in cs_lower):
                resolved_sql = cs_sql

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
                    layout_height,
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
                    :layout_height,
                    :created_at,
                    :updated_at
                );
            """),
            {
                "widget_id": widget_id,
                "session_id": payload.session_id,
                "widget_type": payload.widget_type,
                "title": payload.title,
                "sql_query": resolved_sql,
                "chart_spec": json.dumps(payload.chart_spec) if payload.chart_spec else None,
                "table_data": json.dumps(sanitized_table_data) if sanitized_table_data else None,
                "metric_summary": payload.metric_summary,
                "layout_position": assigned_pos,
                "layout_span": payload.layout_span,
                "layout_height": payload.layout_height,
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
        sql_query=resolved_sql,
        chart_spec=payload.chart_spec,
        table_data=payload.table_data,
        metric_summary=payload.metric_summary,
        layout_position=assigned_pos,
        layout_span=payload.layout_span,
        layout_height=payload.layout_height,
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
                    COALESCE(layout_height, 'normal') as layout_height,
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
                layout_span=r[9] if r[9] else "half",
                layout_height=r[10] if r[10] else "normal",
                created_at=r[11],
                updated_at=r[12],
            )
        )
    return widgets


async def update_dashboard_layout(
    session_id: str,
    items: list[WidgetLayoutItem],
) -> int:
    """Update layout position, grid span, and height for multiple widgets in a dashboard session (FR-47)."""
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
                        layout_height = :height,
                        updated_at = :updated_at
                    WHERE widget_id = :widget_id AND session_id = :session_id;
                """),
                {
                    "position": item.position,
                    "span": item.span,
                    "height": item.height,
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
                
                # Only update table_data if it is a table widget or already had table_data
                if widget.widget_type == "table" or widget.table_data is not None:
                    widget.table_data = {
                        "columns": columns,
                        "rows": rows,
                        "row_count": len(rows),
                    }

                # If this widget has a chart_spec, refresh its data rows based on x_axis and y_axis
                if widget.chart_spec and isinstance(widget.chart_spec, dict):
                    x_col_orig = str(widget.chart_spec.get("x_axis") or "")
                    y_col_orig = str(widget.chart_spec.get("y_axis") or "")
                    chart_type = (widget.chart_spec.get("chart_type") or "bar").lower()

                    # Determine numeric vs non-numeric columns from sample rows
                    num_cols: list[str] = []
                    cat_cols: list[str] = []
                    for c_idx, col in enumerate(columns):
                        valid_vals = [r[c_idx] for r in rows if r[c_idx] is not None and r[c_idx] != ""]
                        is_num = False
                        if valid_vals:
                            num_count = sum(
                                1 for v in valid_vals
                                if isinstance(v, (int, float)) or (isinstance(v, str) and v.strip().replace(".", "", 1).replace("-", "", 1).isdigit())
                            )
                            if num_count / len(valid_vals) >= 0.6:
                                is_num = True
                        if is_num:
                            num_cols.append(col)
                        else:
                            cat_cols.append(col)

                    col_lookup = {c.lower(): c for c in columns}
                    num_lookup = {c.lower(): c for c in num_cols}
                    cat_lookup = {c.lower(): c for c in cat_cols}

                    # Resolve X-axis (prefer temporal/category column)
                    target_x: str = ""
                    if x_col_orig.lower() in cat_lookup:
                        target_x = cat_lookup[x_col_orig.lower()]
                    elif x_col_orig.lower() in col_lookup:
                        target_x = col_lookup[x_col_orig.lower()]
                    else:
                        for c in cat_cols:
                            if x_col_orig.lower() in c.lower() or c.lower() in x_col_orig.lower():
                                target_x = c
                                break

                    # Match title dimension keywords if target_x still unassigned
                    if not target_x:
                        title_lower = (widget.title or "").lower()
                        for c in cat_cols:
                            if c.lower() in title_lower:
                                target_x = c
                                break

                    # For trend/line charts or multi-series comparisons, prefer temporal column for X
                    temporal_keywords = ("month", "date", "period", "time", "year", "quarter", "day", "hari", "bulan", "tahun", "tanggal")
                    temporal_candidate = next((c for c in cat_cols if any(k in c.lower() for k in temporal_keywords)), None)
                    if (chart_type == "line" or not target_x) and temporal_candidate:
                        target_x = temporal_candidate
                    elif not target_x:
                        target_x = cat_cols[0] if cat_cols else (columns[0] if columns else (x_col_orig or "x"))

                    # Resolve Y-axis (MUST be a numeric metric column)
                    target_y: str = ""
                    if y_col_orig.lower() in num_lookup:
                        target_y = num_lookup[y_col_orig.lower()]
                    else:
                        for c in num_cols:
                            if y_col_orig.lower() in c.lower() or c.lower() in y_col_orig.lower():
                                target_y = c
                                break
                    if not target_y:
                        target_y = num_cols[0] if num_cols else (columns[1] if len(columns) >= 2 else (columns[0] if columns else (y_col_orig or "y")))

                    widget.chart_spec["x_axis"] = target_x
                    widget.chart_spec["y_axis"] = target_y

                    chart_type = widget.chart_spec.get("chart_type", "bar")
                    new_data = [
                        dict(zip(columns, row))
                        for row in rows
                    ]

                    # Defensive aggregation for pie/doughnut if duplicate categories exist
                    if chart_type in ("pie", "doughnut") and target_x in columns and target_y in columns:
                        agg_map: dict[Any, float] = {}
                        first_row_map: dict[Any, dict[str, Any]] = {}
                        has_duplicates = False
                        seen_keys = set()
                        for row_dict in new_data:
                            k = row_dict.get(target_x)
                            if k in seen_keys:
                                has_duplicates = True
                            seen_keys.add(k)

                        if has_duplicates:
                            for row_dict in new_data:
                                k = row_dict.get(target_x)
                                val = row_dict.get(target_y)
                                try:
                                    num_val = float(val) if val is not None else 0.0
                                except (ValueError, TypeError):
                                    num_val = 0.0
                                agg_map[k] = agg_map.get(k, 0.0) + num_val
                                if k not in first_row_map:
                                    first_row_map[k] = dict(row_dict)

                            aggregated_data = []
                            for k, sum_val in agg_map.items():
                                item = first_row_map[k]
                                item[target_y] = round(sum_val, 2) if isinstance(sum_val, float) else sum_val
                                aggregated_data.append(item)
                            new_data = aggregated_data

                    widget.chart_spec["data"] = new_data

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
