"""Bring Your Own Data (BYOD) Ingestion Engine (FR-39).

Parses CSV and Excel (.xlsx, .xls) files, performs multi-sheet extraction,
sanitizes table and column names, dynamically creates session-scoped PostgreSQL
tables in the analytics schema, and maintains session lifecycle tracking.
"""

import csv
import io
import json
import logging
from pathlib import Path
import re
import uuid
from typing import Any
import openpyxl
import pandas as pd
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.db.connection import get_db_session

logger = logging.getLogger("harnessly.ingestion")

MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024  # 15 MB
MAX_FILES_PER_BATCH = 5
SUPPORTED_EXTENSIONS = {".csv", ".xlsx", ".xls"}

POSTGRES_RESERVED_WORDS = {
    "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric",
    "authorization", "binary", "both", "case", "cast", "check", "collate", "collation",
    "column", "concurrently", "constraint", "create", "cross", "current_catalog",
    "current_date", "current_role", "current_schema", "current_time", "current_timestamp",
    "current_user", "default", "deferrable", "desc", "distinct", "do", "else", "end",
    "except", "false", "fetch", "for", "foreign", "freeze", "from", "full", "grant",
    "group", "having", "ilike", "in", "initially", "inner", "intersect", "into", "is",
    "isnull", "join", "lateral", "leading", "left", "like", "limit", "localtime",
    "localtimestamp", "natural", "not", "notnull", "null", "offset", "on", "only",
    "or", "order", "outer", "overlaps", "placing", "primary", "references", "returning",
    "right", "select", "session_user", "similar", "some", "symmetric", "table", "tablesample",
    "then", "to", "trailing", "true", "union", "unique", "user", "using", "variadic",
    "verbose", "when", "where", "window", "with"
}


class ColumnMeta(BaseModel):
    name: str
    data_type: str
    sample_values: list[Any] = Field(default_factory=list)


class UploadedTableSummary(BaseModel):
    table_name: str
    original_filename: str
    sheet_name: str
    row_count: int
    columns: list[ColumnMeta]


class UploadResult(BaseModel):
    status: str
    session_id: str
    total_files: int
    total_tables_created: int
    tables: list[UploadedTableSummary]
    error: str | None = None


async def init_uploaded_tables_registry() -> None:
    """Initialize metadata tracking table in PostgreSQL schema analytics."""
    async with get_db_session() as session:
        await session.execute(
            text("""
                CREATE TABLE IF NOT EXISTS analytics.session_uploaded_tables (
                    id VARCHAR(64) PRIMARY KEY,
                    session_id VARCHAR(64) NOT NULL,
                    table_name VARCHAR(128) NOT NULL,
                    original_filename VARCHAR(255) NOT NULL,
                    sheet_name VARCHAR(128) NOT NULL,
                    row_count INT NOT NULL DEFAULT 0,
                    columns JSONB NOT NULL DEFAULT '[]'::jsonb,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)
        )
        await session.execute(
            text("""
                CREATE INDEX IF NOT EXISTS idx_session_uploaded_tables_session_id
                    ON analytics.session_uploaded_tables(session_id);
            """)
        )
        await session.commit()
        logger.info("Initialized analytics.session_uploaded_tables metadata registry.")


def sanitize_identifier(raw: str, max_length: int = 30, prefix: str = "col") -> str:
    """Sanitize any raw string into a valid, safe PostgreSQL identifier (snake_case)."""
    if not raw or not raw.strip():
        return f"{prefix}_{uuid.uuid4().hex[:6]}"
    
    # 1. Lowercase and replace non-alphanumeric with underscores
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", str(raw).strip().lower())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")

    # 2. Must start with a letter or underscore
    if not cleaned or not cleaned[0].isalpha():
        cleaned = f"{prefix}_{cleaned}" if cleaned else f"{prefix}_{uuid.uuid4().hex[:6]}"

    # 3. Guard against SQL reserved words
    if cleaned in POSTGRES_RESERVED_WORDS:
        cleaned = f"{cleaned}_col"

    return cleaned[:max_length].rstrip("_")


def sanitize_cell_value(val: Any) -> Any:
    """Sanitize cell value to prevent CSV formula injection and normalize NaN/NaT."""
    if val is None or pd.isna(val):
        return None
    if isinstance(val, str):
        # CSV formula injection prevention: if starts with = + - @ \t \r, strip or neutralize
        if len(val) > 0 and val[0] in ("=", "+", "-", "@", "\t", "\r"):
            # Neutralize formula character
            val = "'" + val
        return val
    return val


def infer_pg_type(series: pd.Series) -> str:
    """Infer optimal PostgreSQL column type from Pandas Series."""
    dtype_str = str(series.dtype).lower()
    
    if "int" in dtype_str:
        return "BIGINT"
    if "float" in dtype_str:
        return "NUMERIC(18, 4)"
    if "bool" in dtype_str:
        return "BOOLEAN"
    if "datetime" in dtype_str:
        return "TIMESTAMP WITH TIME ZONE"
    
    # Try converting non-null values to numeric or datetime
    non_null = series.dropna()
    if len(non_null) > 0:
        # Check if all non-null can be integer
        try:
            converted_int = pd.to_numeric(non_null, downcast="integer")
            if (converted_int == non_null).all():
                return "BIGINT"
        except Exception:
            pass
        
        # Check if all non-null can be float
        try:
            pd.to_numeric(non_null)
            return "NUMERIC(18, 4)"
        except Exception:
            pass

    return "TEXT"


def parse_csv_bytes(file_bytes: bytes, filename: str) -> dict[str, pd.DataFrame]:
    """Parse CSV content with automatic delimiter and encoding detection."""
    # Detect encoding
    for enc in ("utf-8", "utf-8-sig", "latin-1", "cp1252"):
        try:
            text_sample = file_bytes[:8192].decode(enc)
            # Detect delimiter using Sniffer
            delimiter = ","
            try:
                sniffer = csv.Sniffer()
                dialect = sniffer.sniff(text_sample, delimiters=[",", ";", "\t", "|"])
                delimiter = dialect.delimiter
            except Exception:
                # Count delimiter candidates
                counts = {d: text_sample.count(d) for d in (",", ";", "\t", "|")}
                delimiter = max(counts, key=counts.get) if any(counts.values()) else ","
            
            df = pd.read_csv(
                io.BytesIO(file_bytes),
                sep=delimiter,
                encoding=enc,
                on_bad_lines="skip",
            )
            sheet_name = sanitize_identifier(Path(filename).stem, max_length=20) or "data"
            return {sheet_name: df}
        except UnicodeDecodeError:
            continue
        except Exception as e:
            logger.warning("Error parsing CSV with encoding %s: %s", enc, e)
            continue
            
    # Fallback default
    df = pd.read_csv(io.BytesIO(file_bytes), on_bad_lines="skip")
    return {"data": df}


def parse_excel_bytes(file_bytes: bytes) -> dict[str, pd.DataFrame]:
    """Parse all sheets from Excel workbook into a dictionary of DataFrames."""
    excel_file = io.BytesIO(file_bytes)
    # sheet_name=None reads all sheets into a dict {sheet_name: DataFrame}
    sheets_dict = pd.read_excel(excel_file, sheet_name=None, engine="openpyxl")
    return sheets_dict


async def process_file_and_create_tables(
    session_id: str,
    filename: str,
    file_bytes: bytes,
) -> list[UploadedTableSummary]:
    """Process a single file (CSV or Excel) and create session-scoped PostgreSQL tables."""
    await init_uploaded_tables_registry()
    
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Ekstensi file '{ext}' tidak didukung. Harap gunakan .csv, .xlsx, atau .xls.")
    
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"Ukuran file '{filename}' melebihi batas maksimum 15 MB.")

    # 1. Parse sheets
    if ext == ".csv":
        sheets = parse_csv_bytes(file_bytes, filename)
    else:
        sheets = parse_excel_bytes(file_bytes)

    if not sheets:
        raise ValueError(f"File '{filename}' tidak memiliki data atau sheet yang valid.")

    clean_session = sanitize_identifier(session_id[:8], max_length=8)
    clean_stem = sanitize_identifier(Path(filename).stem, max_length=16)

    created_summaries: list[UploadedTableSummary] = []

    async with get_db_session() as db:
        for raw_sheet_name, df in sheets.items():
            if df.empty or len(df.columns) == 0:
                continue

            clean_sheet = sanitize_identifier(str(raw_sheet_name), max_length=16)
            
            # Format PostgreSQL table name: upload_{clean_session}_{clean_stem}_{clean_sheet}
            # Max 63 characters in PostgreSQL
            base_table_name = f"upload_{clean_session}_{clean_stem}_{clean_sheet}"[:58]
            table_name = base_table_name

            # Check for name collisions and append index if needed
            idx = 1
            while True:
                exists_check = await db.execute(
                    text("SELECT 1 FROM information_schema.tables WHERE table_schema = 'analytics' AND table_name = :tname;"),
                    {"tname": table_name},
                )
                if not exists_check.scalar():
                    break
                table_name = f"{base_table_name[:52]}_{idx}"
                idx += 1

            # 2. Sanitize and deduplicate column names
            col_metas: list[ColumnMeta] = []
            seen_cols: set[str] = set()
            col_definitions: list[str] = []
            clean_col_names: list[str] = []

            for raw_col in df.columns:
                c_name = sanitize_identifier(str(raw_col), max_length=30)
                # Deduplicate if duplicate column names exist
                orig_c_name = c_name
                d_idx = 1
                while c_name in seen_cols:
                    c_name = f"{orig_c_name[:26]}_{d_idx}"
                    d_idx += 1
                seen_cols.add(c_name)
                clean_col_names.append(c_name)

                pg_type = infer_pg_type(df[raw_col])
                col_definitions.append(f'"{c_name}" {pg_type}')

                # Extract sample values (up to 3 non-null)
                samples = [
                    sanitize_cell_value(val)
                    for val in df[raw_col].dropna().head(3).tolist()
                ]
                col_metas.append(
                    ColumnMeta(name=c_name, data_type=pg_type, sample_values=samples)
                )

            # Assign sanitized column names back to DataFrame
            df.columns = clean_col_names

            # 3. Create physical table in PostgreSQL schema analytics
            ddl = f"""
                CREATE TABLE analytics."{table_name}" (
                    _row_id SERIAL PRIMARY KEY,
                    {", ".join(col_definitions)}
                );
            """
            await db.execute(text(ddl))

            # 4. Bulk insert rows into the newly created table
            if len(df) > 0:
                quoted_cols = ", ".join(f'"{c}"' for c in clean_col_names)
                placeholders = ", ".join(f":{c}" for c in clean_col_names)
                insert_sql = f'INSERT INTO analytics."{table_name}" ({quoted_cols}) VALUES ({placeholders})'

                # Clean cell values
                clean_records = []
                for _, row in df.iterrows():
                    rec = {c: sanitize_cell_value(row[c]) for c in clean_col_names}
                    clean_records.append(rec)

                # Batch inserts in chunks of 500 for optimal performance
                chunk_size = 500
                for i in range(0, len(clean_records), chunk_size):
                    chunk = clean_records[i : i + chunk_size]
                    await db.execute(text(insert_sql), chunk)

            # 5. Record metadata in analytics.session_uploaded_tables
            entry_id = str(uuid.uuid4())
            columns_json = [c.model_dump() for c in col_metas]
            await db.execute(
                text("""
                    INSERT INTO analytics.session_uploaded_tables
                        (id, session_id, table_name, original_filename, sheet_name, row_count, columns)
                    VALUES
                        (:id, :session_id, :table_name, :filename, :sheet_name, :row_count, CAST(:columns AS jsonb))
                """),
                {
                    "id": entry_id,
                    "session_id": session_id,
                    "table_name": table_name,
                    "filename": filename,
                    "sheet_name": str(raw_sheet_name),
                    "row_count": len(df),
                    "columns": json.dumps(columns_json),
                },
            )

            created_summaries.append(
                UploadedTableSummary(
                    table_name=table_name,
                    original_filename=filename,
                    sheet_name=str(raw_sheet_name),
                    row_count=len(df),
                    columns=col_metas,
                )
            )

        await db.commit()

    return created_summaries


async def get_session_uploaded_tables(session_id: str) -> list[UploadedTableSummary]:
    """Retrieve all uploaded tables associated with a given session."""
    if not session_id:
        return []
    await init_uploaded_tables_registry()
    
    async with get_db_session() as session:
        result = await session.execute(
            text("""
                SELECT table_name, original_filename, sheet_name, row_count, columns
                FROM analytics.session_uploaded_tables
                WHERE session_id = :session_id
                ORDER BY created_at ASC;
            """),
            {"session_id": session_id},
        )
        rows = result.fetchall()
        summaries = []
        for r in rows:
            raw_cols = r[4]
            if isinstance(raw_cols, str):
                try:
                    raw_cols = json.loads(raw_cols)
                except Exception:
                    raw_cols = []
            elif not isinstance(raw_cols, list):
                raw_cols = []

            cols = [
                ColumnMeta(
                    name=c.get("name", ""),
                    data_type=c.get("data_type", "TEXT"),
                    sample_values=c.get("sample_values", []),
                )
                for c in raw_cols
            ]
            summaries.append(
                UploadedTableSummary(
                    table_name=r[0],
                    original_filename=r[1],
                    sheet_name=r[2],
                    row_count=r[3],
                    columns=cols,
                )
            )
        return summaries


async def cleanup_session_uploaded_tables(session_id: str) -> int:
    """Drop all physical tables and delete metadata for a deleted session."""
    if not session_id:
        return 0
    await init_uploaded_tables_registry()

    dropped_count = 0
    async with get_db_session() as session:
        result = await session.execute(
            text("SELECT table_name FROM analytics.session_uploaded_tables WHERE session_id = :session_id;"),
            {"session_id": session_id},
        )
        table_names = [row[0] for row in result.fetchall()]

        for tname in table_names:
            # Safe drop using parameterless text with validated identifier
            safe_name = re.sub(r"[^a-zA-Z0-9_]", "", tname)
            if safe_name:
                try:
                    await session.execute(text(f'DROP TABLE IF EXISTS analytics."{safe_name}" CASCADE;'))
                    dropped_count += 1
                except Exception as e:
                    logger.warning("Error dropping table analytics.%s: %s", safe_name, e)

        await session.execute(
            text("DELETE FROM analytics.session_uploaded_tables WHERE session_id = :session_id;"),
            {"session_id": session_id},
        )
        await session.commit()

    logger.info("Dropped %d uploaded tables for session %s.", dropped_count, session_id)
    return dropped_count
