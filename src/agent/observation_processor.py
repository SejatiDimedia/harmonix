"""Observation processor for structuring tables and synthesizing visual charts (FR-07)."""

import json
import logging
import re
from typing import Any
from src.agent.models import ChartSpec, Citation, TableData

logger = logging.getLogger(__name__)


class ObservationProcessor:
    """Processes raw observations from tool executions into structured tables and charts."""

    @staticmethod
    def format_observation_for_llm(
        tool_name: str,
        observation: Any,
        max_preview_rows: int = 15,
    ) -> str:
        """Format tool observation for LLM conversation context, pruning large payloads to save tokens.

        - If rows <= max_preview_rows: preserves full JSON.
        - If rows > max_preview_rows: retains top preview rows + summary metadata and explanatory note,
          ensuring full rows remain safely stored in captured_tables for UI and chart rendering.
        """
        if not isinstance(observation, dict):
            if isinstance(observation, list):
                return json.dumps(observation, ensure_ascii=False)
            return str(observation)

        if tool_name == "run_sql" and observation.get("status") == "success":
            rows = observation.get("rows", [])
            total_rows = len(rows)
            if total_rows > max_preview_rows:
                pruned = dict(observation)
                pruned["rows"] = rows[:max_preview_rows]
                pruned["row_count"] = total_rows
                pruned["total_rows_count"] = total_rows
                pruned["preview_count"] = max_preview_rows
                pruned["preview_rows_count"] = max_preview_rows
                pruned["is_preview"] = True
                pruned["system_note"] = (
                    f"Menampilkan sampel {max_preview_rows} dari {total_rows} baris data. "
                    f"Seluruh {total_rows} baris data telah ditampilkan kepada pengguna di tabel UI. "
                    "Analisis tren, pola utama, atau nilai ringkasan tanpa mengetik ulang seluruh baris."
                )
                return json.dumps(pruned, ensure_ascii=False)

        return json.dumps(observation, ensure_ascii=False)

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
            captured_tables.append(TableData(columns=cols, rows=rows, row_count=len(rows), sql_query=sanitized or None))

    @staticmethod
    def find_best_table_for_chart(
        chart_spec: dict[str, Any] | ChartSpec,
        captured_tables: list[TableData],
    ) -> TableData | None:
        """Find the table that most accurately produced or matches the chart specification."""
        if not captured_tables:
            return None

        c_spec = chart_spec if isinstance(chart_spec, dict) else chart_spec.model_dump()
        x_col = str(c_spec.get("x_axis") or "").lower()
        y_col = str(c_spec.get("y_axis") or "").lower()
        c_title = str(c_spec.get("title") or "").lower()
        c_data = c_spec.get("data") or []
        sample_keys = [str(k).lower() for k in (c_data[0].keys() if c_data else [])]

        # Extract meaningful tokens from chart title (>= 4 chars)
        title_tokens = [
            t for t in re.split(r"[_\s\-–,:]+", c_title)
            if len(t) >= 4 and t not in ("chart", "grafik", "perbandingan", "analisis", "total", "nilai")
        ]

        best_tbl: TableData | None = None
        max_score = -1

        for tbl in captured_tables:
            if not tbl.columns or not tbl.rows:
                continue

            # Skip raw schema file probe tables (e.g. SELECT * FROM tbl LIMIT 10 with _row_id or unnamed_)
            is_raw_probe = any(c == "_row_id" or str(c).startswith("unnamed_") for c in tbl.columns)
            if is_raw_probe:
                continue

            cols = [str(c).lower() for c in tbl.columns]
            score = 0

            # 1. Exact or substring match on x_axis
            if x_col and x_col in cols:
                score += 10
            elif x_col and any(x_col in c or c in x_col for c in cols):
                score += 5
            elif x_col:
                tokens = [t for t in re.split(r"[_\s\-]+", x_col) if len(t) >= 3]
                score += sum(3 for t in tokens if any(t in c for c in cols))

            # 2. Exact or substring match on y_axis
            if y_col and y_col in cols:
                score += 10
            elif y_col and any(y_col in c or c in y_col for c in cols):
                score += 5
            elif y_col:
                tokens = [t for t in re.split(r"[_\s\-]+", y_col) if len(t) >= 3]
                score += sum(3 for t in tokens if any(t in c for c in cols))

            # 3. Match keys in chart data rows
            for k in sample_keys:
                if k in cols:
                    score += 4
                elif any(k in c or c in k for c in cols):
                    score += 2

            # 4. Match tokens from chart title
            matched_title_dims = 0
            for tt in title_tokens:
                if any(tt in c or c in tt for c in cols):
                    score += 4
                    matched_title_dims += 1

            if matched_title_dims >= 2:
                score += 12

            # 5. Row count proximity and dimensionality penalty
            if c_data:
                if len(tbl.rows) == len(c_data):
                    score += 12
                elif abs(len(tbl.rows) - len(c_data)) <= 2:
                    score += 6
                elif len(c_data) >= 4 and len(tbl.rows) <= len(c_data) // 2:
                    # Penalize collapsed single-dimension aggregations when detailed multi-dimension chart is rendered
                    score -= 15

            if score > max_score:
                max_score = score
                best_tbl = tbl

        if best_tbl and max_score > 0:
            return best_tbl

        non_raw = [t for t in captured_tables if not any(c == "_row_id" or str(c).startswith("unnamed_") for c in t.columns)]
        return non_raw[-1] if non_raw else captured_tables[-1]

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

        # Match source table and auto-fill from captured_tables if c_data is empty
        matched_sql = None
        if captured_tables:
            matching_tbl = ObservationProcessor.find_best_table_for_chart(c_spec, captured_tables)
            if matching_tbl:
                matched_sql = matching_tbl.sql_query
                if not c_data and len(matching_tbl.columns) >= 2 and matching_tbl.rows:
                    t_x_candidate = c_spec.get("x_axis")
                    t_y_candidate = c_spec.get("y_axis")
                    t_x = t_x_candidate if t_x_candidate in matching_tbl.columns else matching_tbl.columns[0]
                    t_y = t_y_candidate if t_y_candidate in matching_tbl.columns else matching_tbl.columns[1]
                    c_data = [
                        {
                            col: val if val is not None else "(NULL)"
                            for col, val in zip(matching_tbl.columns, r)
                        }
                        for r in matching_tbl.rows
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
                sql_query=matched_sql,
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

        # 2. Ensure existing charts have data and sql_query if tables exist
        for ch in final_charts:
            if captured_tables and (not ch.data or not ch.sql_query):
                matching_tbl = ObservationProcessor.find_best_table_for_chart(ch, captured_tables)
                if matching_tbl:
                    if not ch.sql_query:
                        ch.sql_query = matching_tbl.sql_query

                    if not ch.data and len(matching_tbl.columns) >= 2 and matching_tbl.rows:
                        t_x = ch.x_axis if ch.x_axis in matching_tbl.columns else matching_tbl.columns[0]
                        t_y = ch.y_axis if ch.y_axis in matching_tbl.columns else matching_tbl.columns[1]
                        ch.x_axis = t_x
                        ch.y_axis = t_y
                        ch.data = [
                            {
                                col: val if val is not None else "(NULL)"
                                for col, val in zip(matching_tbl.columns, r)
                            }
                            for r in matching_tbl.rows
                        ]
            if any(w in uq_lower for w in ("donat", "donut", "doughnut")):
                ch.chart_type = "doughnut"
            elif any(w in uq_lower for w in ("pie", "lingkaran", "proporsi", "porsi")) and not any(w in uq_lower for w in ("batang", "bar")):
                ch.chart_type = "pie"
            elif any(w in uq_lower for w in ("garis", "line", "tren", "trend")) and not any(w in uq_lower for w in ("batang", "bar")):
                ch.chart_type = "line"

        # 3. Auto-synthesize chart if user requested visuals/dashboard or analysis but model didn't call make_chart
        chart_keywords = (
            "grafik", "chart", "visualisasi", "visual", "diagram", "plot",
            "tren", "trend", "dashboard", "persentase", "porsi", "proporsi",
            "distribusi", "perbandingan", "komparasi", "analisis", "terlaris",
            "tertinggi", "terendah"
        )
        if not final_charts and captured_tables and any(kw in uq_lower for kw in chart_keywords):
            # Find eligible tables (exclude schema queries like column_name or table_name)
            candidate_tables = []
            for tbl in captured_tables:
                if not tbl.columns or not tbl.rows:
                    continue
                col_names_lower = [c.lower() for c in tbl.columns]
                # Skip raw metadata or information_schema tables
                if any(meta in col_names_lower for meta in ("column_name", "table_name", "table_schema", "original_filename")):
                    continue
                if len(tbl.columns) >= 2 and len(tbl.rows) >= 1:
                    candidate_tables.append(tbl)

            # Synthesize up to 3 charts from the candidate tables
            selected_tables = candidate_tables[-3:] if len(candidate_tables) > 3 else candidate_tables
            if not selected_tables and captured_tables:
                selected_tables = [captured_tables[-1]]

            for tbl in selected_tables:
                clean_cols = [c for c in tbl.columns if not c.startswith("_") and "unnamed" not in c.lower()]
                if len(clean_cols) < 2 or not tbl.rows:
                    continue

                # Find best categorical column for col_x and numeric for col_y
                first_row = tbl.rows[0]
                str_cols = []
                num_cols = []
                for idx, c in enumerate(clean_cols):
                    col_orig_idx = tbl.columns.index(c)
                    val = first_row[col_orig_idx]
                    if isinstance(val, (int, float)):
                        num_cols.append(c)
                    elif isinstance(val, str):
                        str_cols.append(c)

                if str_cols and num_cols:
                    col_x = str_cols[0]
                    col_y = num_cols[0]
                elif len(clean_cols) >= 2:
                    col_x = clean_cols[0]
                    col_y = clean_cols[1]
                else:
                    continue

                col_x_lower = col_x.lower()
                if any(w in uq_lower for w in ("donat", "donut", "doughnut")):
                    c_type = "doughnut"
                elif any(w in uq_lower for w in ("pie", "lingkaran", "proporsi", "komposisi", "porsi", "share")) or (len(tbl.rows) <= 6 and any(p in col_y.lower() for p in ("persen", "share", "porsi"))):
                    c_type = "pie"
                elif any(w in uq_lower for w in ("tren", "trend", "bulanan", "waktu", "harian")) or any(time_kw in col_x_lower for time_kw in ("bulan", "tanggal", "periode", "tahun", "waktu", "month", "date")):
                    c_type = "line"
                else:
                    c_type = "bar"

                x_title = col_x.replace("_", " ").title()
                y_title = col_y.replace("_", " ").title()
                if c_type in ("pie", "doughnut"):
                    title_text = f"Distribusi {y_title} per {x_title}"
                elif c_type == "line":
                    title_text = f"Tren {y_title} berdasarkan {x_title}"
                else:
                    title_text = f"Perbandingan {y_title} per {x_title}"

                final_charts.append(
                    ChartSpec(
                        chart_type=c_type,
                        title=title_text,
                        x_axis=col_x,
                        y_axis=col_y,
                        data=[
                            dict(zip(tbl.columns, r))
                            for r in tbl.rows
                        ],
                        sql_query=tbl.sql_query,
                    )
                )

        return final_charts
