"""Automated Data Health & Anomaly Profiling Engine (FR-41).

Performs deterministic, instant, zero-cost statistical and data quality profiling
for PostgreSQL tables (uploaded files or warehouse tables). Evaluates completeness,
uniqueness, statistical outliers (IQR), semantic plausibility, category skews,
and calculates a composite Data Health Score (0-100) with actionable investigation prompts.
"""

from datetime import datetime, timezone
import logging
import re
from typing import Any
from decimal import Decimal
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.db.connection import get_db_session

logger = logging.getLogger("harmonix.data_health")

NUMERIC_TYPES = {
    "smallint", "integer", "bigint", "decimal", "numeric",
    "real", "double precision", "smallserial", "serial", "bigserial"
}

TEMPORAL_TYPES = {
    "date", "timestamp without time zone", "timestamp with time zone", "time"
}

PRICE_QTY_KEYWORDS = {
    "harga", "price", "biaya", "cost", "total", "subtotal", "amount",
    "jumlah", "qty", "quantity", "stok", "stock", "kuantitas", "sales", "penjualan", "gaji"
}


class ColumnHealthSummary(BaseModel):
    column_name: str
    data_type: str
    total_count: int
    null_count: int
    null_rate_pct: float
    distinct_count: int
    is_unique: bool
    is_primary_key_candidate: bool = False
    # Numeric statistics
    min_value: Any | None = None
    max_value: Any | None = None
    mean_value: float | None = None
    median_value: float | None = None
    stddev_value: float | None = None
    q1: float | None = None
    q3: float | None = None
    iqr: float | None = None
    outlier_count: int = 0
    outlier_rate_pct: float = 0.0
    suspicious_negatives: int = 0
    suspicious_zeros: int = 0
    # Categorical statistics
    top_categories: list[dict[str, Any]] = Field(default_factory=list)


class DataAnomalyItem(BaseModel):
    anomaly_id: str
    column_name: str | None = None
    category: str  # missing_values | outlier | duplication | semantic_logic | distribution_skew
    severity: str  # critical | warning | info
    title: str
    description: str
    affected_rows: int = 0
    affected_rate_pct: float = 0.0


class QuickActionPrompt(BaseModel):
    id: str
    title: str
    prompt: str
    category: str


class TableHealthProfile(BaseModel):
    table_name: str
    qualified_name: str
    session_id: str | None = None
    original_filename: str | None = None
    sheet_name: str | None = None
    total_rows: int
    total_columns: int
    total_cells: int
    duplicate_rows: int
    duplicate_rate_pct: float
    overall_completeness_pct: float
    health_score: int  # 0 to 100
    health_grade: str  # Prima | Perhatian | Kritis
    health_badge_color: str  # emerald | amber | rose
    column_profiles: list[ColumnHealthSummary]
    anomalies: list[DataAnomalyItem]
    quick_prompts: list[QuickActionPrompt]
    scanned_at: str


def _format_num(val: Any) -> str:
    """Format numeric values cleanly for prompt and summary text."""
    if val is None:
        return "-"
    try:
        f = float(val)
        if f.is_integer():
            return f"{int(f):,}"
        return f"{f:,.2f}"
    except (ValueError, TypeError):
        return str(val)


async def compute_table_data_health(
    table_name: str,
    session_id: str | None = None,
    schema_name: str = "analytics",
) -> TableHealthProfile:
    """Compute comprehensive data health profile for a table in PostgreSQL."""
    # Sanitize identifiers to prevent SQL injection
    safe_table = re.sub(r"[^a-zA-Z0-9_]", "", table_name)
    safe_schema = re.sub(r"[^a-zA-Z0-9_]", "", schema_name)
    qualified_name = f"{safe_schema}.{safe_table}"

    if not safe_table:
        raise ValueError("Nama tabel tidak valid.")

    async with get_db_session() as session:
        # 1. Verify table exists and retrieve metadata
        meta_query = text("""
            SELECT original_filename, sheet_name 
            FROM analytics.session_uploaded_tables
            WHERE table_name = :tname
            LIMIT 1;
        """)
        meta_res = await session.execute(meta_query, {"tname": safe_table})
        meta_row = meta_res.fetchone()
        orig_filename = meta_row[0] if meta_row else safe_table
        sheet_name = meta_row[1] if meta_row else None

        # 2. Get columns and types from information_schema
        cols_query = text("""
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = :sname AND table_name = :tname
            ORDER BY ordinal_position ASC;
        """)
        cols_res = await session.execute(cols_query, {"sname": safe_schema, "tname": safe_table})
        raw_cols = cols_res.fetchall()

        if not raw_cols:
            raise ValueError(f"Tabel '{qualified_name}' tidak ditemukan di database.")

        # Filter out internal tracking columns like _row_id for business analysis
        biz_cols = [
            (c[0], c[1].lower())
            for c in raw_cols
            if c[0] != "_row_id"
        ]
        if not biz_cols:
            biz_cols = [(c[0], c[1].lower()) for c in raw_cols]

        # 3. Get total row count
        count_res = await session.execute(text(f'SELECT COUNT(*) FROM "{safe_schema}"."{safe_table}";'))
        total_rows = count_res.scalar() or 0

        # Edge case: Empty table
        if total_rows == 0:
            return TableHealthProfile(
                table_name=safe_table,
                qualified_name=qualified_name,
                session_id=session_id,
                original_filename=orig_filename,
                sheet_name=sheet_name,
                total_rows=0,
                total_columns=len(biz_cols),
                total_cells=0,
                duplicate_rows=0,
                duplicate_rate_pct=0.0,
                overall_completeness_pct=100.0,
                health_score=100,
                health_grade="Prima",
                health_badge_color="emerald",
                column_profiles=[],
                anomalies=[
                    DataAnomalyItem(
                        anomaly_id="empty_table",
                        category="missing_values",
                        severity="info",
                        title="Tabel Kosong",
                        description=f"Tabel {qualified_name} belum memiliki baris data.",
                    )
                ],
                quick_prompts=[
                    QuickActionPrompt(
                        id="empty_check",
                        title="Periksa Struktur Tabel",
                        prompt=f"Tampilkan struktur skema dan tipe kolom untuk tabel {qualified_name}",
                        category="general",
                    )
                ],
                scanned_at=datetime.now(timezone.utc).isoformat(),
            )

        # 4. Check Duplicate Rows (excluding internal _row_id)
        col_list_sql = ", ".join([f'"{c[0]}"' for c in biz_cols])
        dup_query = text(f"""
            SELECT (SELECT COUNT(*) FROM "{safe_schema}"."{safe_table}") - 
                   (SELECT COUNT(*) FROM (
                      SELECT DISTINCT {col_list_sql}
                      FROM "{safe_schema}"."{safe_table}"
                    ) _distinct_rows);
        """)
        try:
            dup_res = await session.execute(dup_query)
            duplicate_rows = dup_res.scalar() or 0
        except Exception as e:
            logger.warning("Error calculating duplicate rows for %s: %s", qualified_name, e)
            duplicate_rows = 0

        duplicate_rate_pct = round((duplicate_rows / total_rows) * 100, 2) if total_rows > 0 else 0.0

        # 5. Build Aggregation Query for Completeness & Distinct Counts per Column
        agg_selects = []
        for col_name, _ in biz_cols:
            agg_selects.append(f'COUNT(*) - COUNT("{col_name}") AS "null_{col_name}"')
            agg_selects.append(f'COUNT(DISTINCT "{col_name}") AS "dist_{col_name}"')

        agg_query_sql = f'SELECT {", ".join(agg_selects)} FROM "{safe_schema}"."{safe_table}";'
        agg_res = await session.execute(text(agg_query_sql))
        agg_data = dict(agg_res.fetchone()._mapping)

        total_cells = total_rows * len(biz_cols)
        total_null_cells = 0
        column_profiles: list[ColumnHealthSummary] = []
        anomalies: list[DataAnomalyItem] = []

        # Duplication Anomaly
        if duplicate_rows > 0:
            severity = "critical" if duplicate_rate_pct >= 5.0 else "warning"
            anomalies.append(
                DataAnomalyItem(
                    anomaly_id="duplicate_rows_detected",
                    category="duplication",
                    severity=severity,
                    title="Ditemukan Baris Duplikat",
                    description=(
                        f"Terdapat {duplicate_rows:,} baris ({duplicate_rate_pct}%) yang memiliki "
                        f"isi identik di seluruh kolom bisnis."
                    ),
                    affected_rows=duplicate_rows,
                    affected_rate_pct=duplicate_rate_pct,
                )
            )

        # Process each column
        for col_name, data_type in biz_cols:
            null_count = int(agg_data.get(f"null_{col_name}", 0))
            distinct_count = int(agg_data.get(f"dist_{col_name}", 0))
            total_null_cells += null_count
            null_rate_pct = round((null_count / total_rows) * 100, 2)
            is_unique = (distinct_count == total_rows and null_count == 0)
            is_pk_candidate = is_unique and ("id" in col_name.lower() or "kode" in col_name.lower() or "key" in col_name.lower())

            col_summary = ColumnHealthSummary(
                column_name=col_name,
                data_type=data_type,
                total_count=total_rows,
                null_count=null_count,
                null_rate_pct=null_rate_pct,
                distinct_count=distinct_count,
                is_unique=is_unique,
                is_primary_key_candidate=is_pk_candidate,
            )

            # Check Missing Values Anomalies
            if null_rate_pct >= 50.0:
                anomalies.append(
                    DataAnomalyItem(
                        anomaly_id=f"high_null_{col_name}",
                        column_name=col_name,
                        category="missing_values",
                        severity="critical",
                        title=f"Kekosongan Kritis pada '{col_name}'",
                        description=f"Kolom '{col_name}' memiliki {null_count:,} data hilang ({null_rate_pct}% dari total baris).",
                        affected_rows=null_count,
                        affected_rate_pct=null_rate_pct,
                    )
                )
            elif null_rate_pct >= 15.0:
                anomalies.append(
                    DataAnomalyItem(
                        anomaly_id=f"moderate_null_{col_name}",
                        column_name=col_name,
                        category="missing_values",
                        severity="warning",
                        title=f"Data Hilang pada '{col_name}'",
                        description=f"Kolom '{col_name}' memiliki {null_count:,} data kosong ({null_rate_pct}%).",
                        affected_rows=null_count,
                        affected_rate_pct=null_rate_pct,
                    )
                )

            # 6. Detailed Statistics for Numeric Columns
            is_numeric = any(num_t in data_type for num_t in NUMERIC_TYPES)
            if is_numeric and (total_rows - null_count) > 0:
                try:
                    stats_sql = text(f"""
                        SELECT 
                            MIN("{col_name}")::numeric AS min_val,
                            MAX("{col_name}")::numeric AS max_val,
                            AVG("{col_name}")::numeric AS avg_val,
                            STDDEV("{col_name}")::numeric AS std_val,
                            percentile_cont(0.25) WITHIN GROUP (ORDER BY "{col_name}") AS q1,
                            percentile_cont(0.50) WITHIN GROUP (ORDER BY "{col_name}") AS median,
                            percentile_cont(0.75) WITHIN GROUP (ORDER BY "{col_name}") AS q3,
                            COUNT(*) FILTER (WHERE "{col_name}" < 0) AS neg_count,
                            COUNT(*) FILTER (WHERE "{col_name}" = 0) AS zero_count
                        FROM "{safe_schema}"."{safe_table}"
                        WHERE "{col_name}" IS NOT NULL;
                    """)
                    s_res = await session.execute(stats_sql)
                    s_row = s_res.fetchone()
                    if s_row:
                        min_v = float(s_row[0]) if s_row[0] is not None else None
                        max_v = float(s_row[1]) if s_row[1] is not None else None
                        avg_v = round(float(s_row[2]), 2) if s_row[2] is not None else None
                        std_v = round(float(s_row[3]), 2) if s_row[3] is not None else None
                        q1_v = float(s_row[4]) if s_row[4] is not None else None
                        med_v = float(s_row[5]) if s_row[5] is not None else None
                        q3_v = float(s_row[6]) if s_row[6] is not None else None
                        neg_c = int(s_row[7] or 0)
                        zero_c = int(s_row[8] or 0)

                        col_summary.min_value = min_v
                        col_summary.max_value = max_v
                        col_summary.mean_value = avg_v
                        col_summary.median_value = med_v
                        col_summary.stddev_value = std_v
                        col_summary.q1 = q1_v
                        col_summary.q3 = q3_v
                        col_summary.suspicious_negatives = neg_c
                        col_summary.suspicious_zeros = zero_c

                        # IQR & Outlier computation
                        if q1_v is not None and q3_v is not None:
                            iqr_v = q3_v - q1_v
                            col_summary.iqr = round(iqr_v, 2)
                            lower_bound = q1_v - 1.5 * iqr_v
                            upper_bound = q3_v + 1.5 * iqr_v

                            # Outlier count query
                            outlier_sql = text(f"""
                                SELECT COUNT(*) 
                                FROM "{safe_schema}"."{safe_table}"
                                WHERE "{col_name}" IS NOT NULL
                                  AND ("{col_name}" < :lb OR "{col_name}" > :ub);
                            """)
                            out_res = await session.execute(outlier_sql, {"lb": lower_bound, "ub": upper_bound})
                            out_c = out_res.scalar() or 0
                            out_rate = round((out_c / total_rows) * 100, 2)
                            col_summary.outlier_count = out_c
                            col_summary.outlier_rate_pct = out_rate

                            if out_c > 0 and out_rate >= 1.0:
                                anomalies.append(
                                    DataAnomalyItem(
                                        anomaly_id=f"outlier_{col_name}",
                                        column_name=col_name,
                                        category="outlier",
                                        severity="warning" if out_rate < 10.0 else "critical",
                                        title=f"Outlier Terdeteksi pada '{col_name}'",
                                        description=(
                                            f"Ditemukan {out_c:,} nilai pencilan ekstrem ({out_rate}%) "
                                            f"di luar batas normal ({_format_num(lower_bound)} s/d {_format_num(upper_bound)}). "
                                            f"Nilai maksimum mencapai {_format_num(max_v)}."
                                        ),
                                        affected_rows=out_c,
                                        affected_rate_pct=out_rate,
                                    )
                                )

                        # Semantic checks for negative values on pricing/quantity columns
                        is_price_or_qty = any(kw in col_name.lower() for kw in PRICE_QTY_KEYWORDS)
                        if is_price_or_qty and neg_c > 0:
                            neg_rate = round((neg_c / total_rows) * 100, 2)
                            anomalies.append(
                                DataAnomalyItem(
                                    anomaly_id=f"negative_val_{col_name}",
                                    column_name=col_name,
                                    category="semantic_logic",
                                    severity="critical",
                                    title=f"Nilai Negatif Tak Wajar pada '{col_name}'",
                                    description=(
                                        f"Kolom '{col_name}' terdeteksi memuat {neg_c:,} baris bernilai negatif "
                                        f"({neg_rate}%). Hal ini tidak lazim untuk metrik harga/kuantitas."
                                    ),
                                    affected_rows=neg_c,
                                    affected_rate_pct=neg_rate,
                                )
                            )
                except Exception as e:
                    logger.warning("Error calculating numeric stats for %s.%s: %s", qualified_name, col_name, e)

            # 7. Distribution Check for Low-Cardinality / Categorical Columns
            is_text = "text" in data_type or "char" in data_type
            if is_text and 1 < distinct_count <= 50 and (total_rows - null_count) > 0:
                try:
                    top_cat_sql = text(f"""
                        SELECT "{col_name}" AS val, COUNT(*) AS cnt
                        FROM "{safe_schema}"."{safe_table}"
                        WHERE "{col_name}" IS NOT NULL
                        GROUP BY "{col_name}"
                        ORDER BY cnt DESC
                        LIMIT 5;
                    """)
                    top_res = await session.execute(top_cat_sql)
                    cats = []
                    for row in top_res.fetchall():
                        v_str = str(row[0]) if row[0] is not None else ""
                        c_cnt = int(row[1])
                        c_pct = round((c_cnt / total_rows) * 100, 1)
                        cats.append({"value": v_str, "count": c_cnt, "pct": c_pct})

                    col_summary.top_categories = cats

                    # Check severe distribution skew (>85% dominated by single category)
                    if cats and cats[0]["pct"] >= 85.0:
                        anomalies.append(
                            DataAnomalyItem(
                                anomaly_id=f"skew_{col_name}",
                                column_name=col_name,
                                category="distribution_skew",
                                severity="info",
                                title=f"Dominasi Kategori pada '{col_name}'",
                                description=(
                                    f"Kategori '{cats[0]['value']}' mendominasi {cats[0]['pct']}% dari total data "
                                    f"({cats[0]['count']:,} baris)."
                                ),
                                affected_rows=cats[0]["count"],
                                affected_rate_pct=cats[0]["pct"],
                            )
                        )
                except Exception as e:
                    logger.warning("Error calculating categories for %s.%s: %s", qualified_name, col_name, e)

            column_profiles.append(col_summary)

        # 8. Calculate Overall Completeness Percentage
        overall_completeness_pct = round(
            ((total_cells - total_null_cells) / total_cells) * 100, 2
        ) if total_cells > 0 else 100.0

        # 9. Compute Composite Data Health Score (0-100)
        # Starting base score
        score = 100.0

        # Penalty 1: Missing values (up to 35 pts)
        missing_rate_overall = (total_null_cells / total_cells) * 100 if total_cells > 0 else 0
        score -= min(35.0, missing_rate_overall * 0.7)

        # Penalty 2: High null columns (up to 15 pts)
        high_null_cols_count = sum(1 for c in column_profiles if c.null_rate_pct >= 20.0)
        score -= min(15.0, high_null_cols_count * 5.0)

        # Penalty 3: Duplicate rows (up to 25 pts)
        if duplicate_rate_pct > 0:
            score -= min(25.0, duplicate_rate_pct * 2.0)

        # Penalty 4: Critical semantic logic / negative anomalies (up to 20 pts)
        critical_anomalies_count = sum(1 for a in anomalies if a.severity == "critical")
        score -= min(20.0, critical_anomalies_count * 8.0)

        # Penalty 5: Severe outliers (up to 15 pts)
        outlier_cols_count = sum(1 for c in column_profiles if c.outlier_count > 0 and c.outlier_rate_pct >= 3.0)
        score -= min(15.0, outlier_cols_count * 3.0)

        final_score = max(0, min(100, int(round(score))))

        # Grading & Badging
        if final_score >= 90:
            health_grade = "Prima"
            badge_color = "emerald"
        elif final_score >= 70:
            health_grade = "Perhatian"
            badge_color = "amber"
        else:
            health_grade = "Kritis"
            badge_color = "rose"

        # 10. Generate 3 Contextual Quick-Action Investigation Prompts
        quick_prompts: list[QuickActionPrompt] = []

        # Find best candidate for Outlier Investigation
        outlier_candidates = sorted(
            [c for c in column_profiles if c.outlier_count > 0],
            key=lambda x: x.outlier_rate_pct,
            reverse=True,
        )
        if outlier_candidates:
            top_outlier_col = outlier_candidates[0]
            quick_prompts.append(
                QuickActionPrompt(
                    id="investigate_outliers",
                    title="Investigasi Nilai Pencilan (Outlier)",
                    prompt=(
                        f"Tampilkan 5 transaksi atau baris dengan nilai paling ekstrem pada kolom '{top_outlier_col.column_name}' "
                        f"di tabel {qualified_name} dalam bentuk tabel, serta analisislah potensi anomali penyebabnya."
                    ),
                    category="outlier",
                )
            )

        # Find best candidate for Missing Data / Semantic Investigation
        null_candidates = sorted(
            [c for c in column_profiles if c.null_count > 0],
            key=lambda x: x.null_rate_pct,
            reverse=True,
        )
        if null_candidates:
            top_null_col = null_candidates[0]
            quick_prompts.append(
                QuickActionPrompt(
                    id="investigate_missing_data",
                    title="Analisis Pola Data Kosong (NULL)",
                    prompt=(
                        f"Periksa kolom '{top_null_col.column_name}' di tabel {qualified_name} yang memiliki {top_null_col.null_count:,} data kosong ({top_null_col.null_rate_pct}%). "
                        f"Apakah data kosong ini terkonsentrasi pada kategori, periode, atau segmen tertentu?"
                    ),
                    category="missing",
                )
            )
        elif duplicate_rows > 0:
            quick_prompts.append(
                QuickActionPrompt(
                    id="investigate_duplicates",
                    title="Tampilkan Baris Duplikat",
                    prompt=(
                        f"Tampilkan sampel baris yang terduplikasi pada tabel {qualified_name} beserta jumlah pengulangannya dalam bentuk tabel terstruktur."
                    ),
                    category="duplication",
                )
            )

        # Find best candidate for Category / Breakdown Analysis
        cat_candidates = [c for c in column_profiles if c.top_categories]
        num_candidates = [c for c in column_profiles if c.mean_value is not None and c.column_name != "usia"]

        if cat_candidates and num_candidates:
            cat_col = cat_candidates[0].column_name
            num_col = num_candidates[0].column_name
            quick_prompts.append(
                QuickActionPrompt(
                    id="breakdown_and_chart",
                    title=f"Analisis & Grafik {cat_col}",
                    prompt=(
                        f"Hitung total dan rata-rata '{num_col}' berdasarkan '{cat_col}' dari tabel {qualified_name}. "
                        f"Sajikan hasilnya dalam tabel terurut dan buatkan visualisasi grafik batang (bar chart)."
                    ),
                    category="breakdown",
                )
            )
        else:
            quick_prompts.append(
                QuickActionPrompt(
                    id="comprehensive_summary",
                    title="Ringkasan Statistik & Korelasi",
                    prompt=(
                        f"Buatkan ringkasan statistik deskriptif dan temuan bisnis utama dari tabel {qualified_name} dalam bentuk tabel terstruktur."
                    ),
                    category="general",
                )
            )

        # Ensure we always have exactly 3 quick prompts
        if len(quick_prompts) < 3:
            quick_prompts.append(
                QuickActionPrompt(
                    id="cross_join_warehouse",
                    title="Cross-Join dengan Orders",
                    prompt=(
                        f"Coba hubungkan (JOIN) data dari tabel {qualified_name} dengan data master pesanan (orders) "
                        f"untuk mencari wawasan baru antar-sumber data."
                    ),
                    category="cross_join",
                )
            )

        # Cap at 3 prompts
        quick_prompts = quick_prompts[:3]

        return TableHealthProfile(
            table_name=safe_table,
            qualified_name=qualified_name,
            session_id=session_id,
            original_filename=orig_filename,
            sheet_name=sheet_name,
            total_rows=total_rows,
            total_columns=len(biz_cols),
            total_cells=total_cells,
            duplicate_rows=duplicate_rows,
            duplicate_rate_pct=duplicate_rate_pct,
            overall_completeness_pct=overall_completeness_pct,
            health_score=final_score,
            health_grade=health_grade,
            health_badge_color=badge_color,
            column_profiles=column_profiles,
            anomalies=anomalies,
            quick_prompts=quick_prompts,
            scanned_at=datetime.now(timezone.utc).isoformat(),
        )
