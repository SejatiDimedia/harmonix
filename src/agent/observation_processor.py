"""Observation processor for structuring tables and synthesizing visual charts (FR-07)."""

import logging
from typing import Any
from src.agent.models import ChartSpec, Citation, TableData

logger = logging.getLogger(__name__)


class ObservationProcessor:
    """Processes raw observations from tool executions into structured tables and charts."""

    @staticmethod
    def process_sql_observation(
        observation: dict[str, Any],
        executed_sqls: list[str],
        citations: list[Citation],
        captured_tables: list[TableData],
    ) -> None:
        """Extract table data, executed query, and citations from successful run_sql observation."""
        if not isinstance(observation, dict) or observation.get("status") != "success":
            return

        sanitized = observation.get("sanitized_query", "")
        if sanitized:
            executed_sqls.append(sanitized)
            citations.append(Citation(sql_query=sanitized, source_tables=[]))

        cols = observation.get("columns", [])
        rows = observation.get("rows", [])
        if cols and rows:
            captured_tables.append(TableData(columns=cols, rows=rows, row_count=len(rows)))

    @staticmethod
    def process_chart_observation(
        observation: dict[str, Any],
        captured_charts: list[ChartSpec],
        captured_tables: list[TableData],
        user_query: str,
    ) -> None:
        """Extract chart spec from make_chart observation and autofill data if needed."""
        if not isinstance(observation, dict) or observation.get("status") != "success":
            return

        c_spec = observation.get("chart", {})
        c_data = c_spec.get("data", [])

        # Auto-fill from captured_tables if c_data is empty
        if not c_data and captured_tables:
            last_tbl = captured_tables[-1]
            if len(last_tbl.columns) >= 2 and last_tbl.rows:
                t_x = c_spec.get("x_axis") if c_spec.get("x_axis") in last_tbl.columns else last_tbl.columns[0]
                t_y = c_spec.get("y_axis") if c_spec.get("y_axis") in last_tbl.columns else last_tbl.columns[1]
                c_data = [
                    {t_x: r[0] if r[0] is not None else "(NULL)", t_y: r[1]}
                    for r in last_tbl.rows
                ]
                c_spec["x_axis"] = t_x
                c_spec["y_axis"] = t_y

        raw_c_type = c_spec.get("chart_type", "bar")
        uq_lower = user_query.lower()
        if any(w in uq_lower for w in ("donat", "donut", "doughnut")):
            final_c_type = "doughnut"
        elif any(w in uq_lower for w in ("pie", "lingkaran", "proporsi", "porsi")) and not any(w in uq_lower for w in ("batang", "bar")):
            final_c_type = "pie"
        elif any(w in uq_lower for w in ("garis", "line", "tren", "trend")) and not any(w in uq_lower for w in ("batang", "bar")):
            final_c_type = "line"
        else:
            final_c_type = raw_c_type

        raw_title = (c_spec.get("title") or "").strip()
        generic_names = ("chart", "grafik", "visualisasi", "data visualization", "visualisasi data", "")
        if not raw_title or raw_title.lower() in generic_names:
            x_label = (c_spec.get("x_axis") or "Kategori").replace("_", " ").title()
            y_label = (c_spec.get("y_axis") or "Nilai").replace("_", " ").title()
            if final_c_type in ("pie", "doughnut"):
                resolved_title = f"Distribusi {y_label} per {x_label}"
            elif final_c_type == "line":
                resolved_title = f"Tren {y_label} berdasarkan {x_label}"
            else:
                resolved_title = f"Perbandingan {y_label} per {x_label}"
        else:
            resolved_title = raw_title

        captured_charts.append(
            ChartSpec(
                chart_type=final_c_type,
                title=resolved_title,
                x_axis=c_spec.get("x_axis", "x"),
                y_axis=c_spec.get("y_axis", "y"),
                data=c_data,
            )
        )

    @staticmethod
    def finalize_charts(
        captured_charts: list[ChartSpec],
        captured_tables: list[TableData],
        user_query: str,
    ) -> list[ChartSpec]:
        """Deduplicate charts, ensure data consistency, and auto-synthesize if requested by user."""
        # 1. Deduplicate charts with identical title, keeping the latest one
        deduped: list[ChartSpec] = []
        seen_titles: set[str] = set()
        for ch in reversed(captured_charts):
            normalized_title = ch.title.strip().lower()
            if normalized_title not in seen_titles:
                seen_titles.add(normalized_title)
                deduped.append(ch)
        final_charts = list(reversed(deduped))

        uq_lower = user_query.lower()

        # 2. Ensure existing charts have data if tables exist
        for ch in final_charts:
            if not ch.data and captured_tables:
                last_tbl = captured_tables[-1]
                if len(last_tbl.columns) >= 2 and last_tbl.rows:
                    t_x = ch.x_axis if ch.x_axis in last_tbl.columns else last_tbl.columns[0]
                    t_y = ch.y_axis if ch.y_axis in last_tbl.columns else last_tbl.columns[1]
                    ch.x_axis = t_x
                    ch.y_axis = t_y
                    ch.data = [
                        {t_x: r[0] if r[0] is not None else "(NULL)", t_y: r[1]}
                        for r in last_tbl.rows
                    ]
            if any(w in uq_lower for w in ("donat", "donut", "doughnut")):
                ch.chart_type = "doughnut"
            elif any(w in uq_lower for w in ("pie", "lingkaran", "proporsi", "porsi")) and not any(w in uq_lower for w in ("batang", "bar")):
                ch.chart_type = "pie"
            elif any(w in uq_lower for w in ("garis", "line", "tren", "trend")) and not any(w in uq_lower for w in ("batang", "bar")):
                ch.chart_type = "line"

        # 3. Auto-synthesize chart if user explicitly requested visual but model didn't call make_chart
        chart_keywords = ("grafik", "chart", "visualisasi", "diagram", "plot", "tren", "trend")
        if not final_charts and captured_tables and any(kw in uq_lower for kw in chart_keywords):
            last_tbl = captured_tables[-1]
            if len(last_tbl.columns) >= 2 and last_tbl.rows:
                col_x = last_tbl.columns[0]
                col_y = last_tbl.columns[1]
                if any(w in uq_lower for w in ("donat", "donut", "doughnut")):
                    c_type = "doughnut"
                elif any(w in uq_lower for w in ("pie", "lingkaran", "proporsi", "komposisi", "porsi", "share")):
                    c_type = "pie"
                elif any(w in uq_lower for w in ("tren", "trend", "bulanan", "waktu", "harian")):
                    c_type = "line"
                else:
                    c_type = "bar"

                title_text = f"Visualisasi {col_x.replace('_', ' ').title()} vs {col_y.replace('_', ' ').title()}"
                final_charts.append(
                    ChartSpec(
                        chart_type=c_type,
                        title=title_text,
                        x_axis=col_x,
                        y_axis=col_y,
                        data=[
                            {col_x: r[0] if r[0] is not None else "(NULL)", col_y: r[1]}
                            for r in last_tbl.rows
                        ],
                    )
                )

        return final_charts
