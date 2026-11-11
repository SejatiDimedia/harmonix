"""Google Account OAuth 2.0 & Live Google Sheets Ingestion Engine (FR-50).

Provides:
1. Google OAuth 2.0 authorization URL generation, code exchange, and encrypted token vault.
2. Silent automatic token refresh via Google OAuth refresh tokens.
3. Google Sheets API v4 integration for spreadsheet metadata and grid data extraction.
4. Multi-sheet conversion into session-scoped physical PostgreSQL tables.
5. Registration into analytics.session_uploaded_tables for full agentText-to-SQL cross-join capability.
6. One-click on-demand re-sync from live Google Sheets.
"""

import base64
import datetime
import hashlib
import json
import logging
import re
import urllib.parse
import uuid
from typing import Any

from cryptography.fernet import Fernet
import httpx
import numpy as np
import pandas as pd
from pydantic import BaseModel, Field
from sqlalchemy import text

import os
from src.config import settings
from src.db.connection import get_db_session
from src.ingestion.excel_csv_parser import (
    ColumnMeta,
    UploadedTableSummary,
    infer_pg_type,
    sanitize_cell_value,
    sanitize_identifier,
)

logger = logging.getLogger("harmonix.ingestion.google_sheets")

# Google OAuth & Sheets API Endpoints
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets"

OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "openid",
    "email",
    "profile",
]


class GoogleConnectionModel(BaseModel):
    """Details of connected Google account for a session."""

    session_id: str
    google_email: str
    google_name: str | None = None
    google_picture_url: str | None = None
    is_connected: bool = True
    token_expires_at: str | None = None


class SheetTabInfo(BaseModel):
    """Metadata for a single sheet/tab within a Google Spreadsheet."""

    sheet_id: int
    sheet_title: str
    row_count: int = 0
    column_count: int = 0
    table_name: str | None = None


class GoogleSheetLinkSummary(BaseModel):
    """Summary of a linked Google Spreadsheet in a session."""

    sheet_link_id: str
    session_id: str
    spreadsheet_id: str
    spreadsheet_title: str
    sheet_tabs: list[dict[str, Any]]
    last_synced_at: str
    sync_status: str
    row_count_total: int


def _get_cipher() -> Fernet:
    """Obtain symmetric Fernet cipher using configured key or deterministic hash."""
    if settings.google_token_encryption_key:
        try:
            return Fernet(settings.google_token_encryption_key.encode("utf-8"))
        except Exception:
            pass
    # Deterministically derive 32-byte key from database URL salt
    derived = hashlib.sha256((settings.database_url + "harmonix_google_oauth_salt_2026").encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt_token(raw_token: str) -> str:
    """Encrypt raw token string to base64 Fernet cipher."""
    if not raw_token:
        return ""
    cipher = _get_cipher()
    return cipher.encrypt(raw_token.encode("utf-8")).decode("utf-8")


def decrypt_token(encrypted_token: str) -> str:
    """Decrypt base64 Fernet cipher to raw token string."""
    if not encrypted_token:
        return ""
    cipher = _get_cipher()
    try:
        return cipher.decrypt(encrypted_token.encode("utf-8")).decode("utf-8")
    except Exception as e:
        logger.error("Failed to decrypt Google token: %s", e)
        return ""


async def init_google_tables() -> None:
    """Initialize Google OAuth and Sheets registration tables in analytics schema."""
    async with get_db_session() as session:
        await session.execute(
            text("""
                CREATE TABLE IF NOT EXISTS analytics.google_connections (
                    connection_id VARCHAR(64) PRIMARY KEY,
                    session_id VARCHAR(64) NOT NULL,
                    google_email VARCHAR(255) NOT NULL,
                    google_name VARCHAR(255),
                    google_picture_url TEXT,
                    encrypted_access_token TEXT NOT NULL,
                    encrypted_refresh_token TEXT,
                    token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uk_google_conn_session UNIQUE (session_id)
                );
            """)
        )
        await session.execute(
            text("""
                CREATE TABLE IF NOT EXISTS analytics.session_google_sheets (
                    sheet_link_id VARCHAR(64) PRIMARY KEY,
                    session_id VARCHAR(64) NOT NULL,
                    spreadsheet_id VARCHAR(128) NOT NULL,
                    spreadsheet_title VARCHAR(255) NOT NULL,
                    sheet_tabs JSONB NOT NULL DEFAULT '[]'::jsonb,
                    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    sync_status VARCHAR(32) DEFAULT 'SYNCED',
                    row_count_total INT DEFAULT 0,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)
        )
        await session.execute(
            text("""
                CREATE INDEX IF NOT EXISTS idx_google_conn_session
                    ON analytics.google_connections(session_id);
            """)
        )
        await session.execute(
            text("""
                CREATE INDEX IF NOT EXISTS idx_google_sheets_session
                    ON analytics.session_google_sheets(session_id);
            """)
        )
        await session.commit()
        logger.info("Initialized analytics.google_connections and analytics.session_google_sheets tables.")


def extract_spreadsheet_id(url_or_id: str) -> str:
    """Extract standard Google Spreadsheet ID from URL or return ID if raw."""
    clean = url_or_id.strip()
    # Match /spreadsheets/d/<ID>/...
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", clean)
    if m:
        return m.group(1)

    # Match raw spreadsheet ID (typically 20+ chars alphanumeric, hyphens, underscores)
    if re.match(r"^[a-zA-Z0-9-_]{20,}$", clean):
        return clean

    raise ValueError(
        f"Format URL atau ID Google Sheets tidak valid: '{url_or_id}'. "
        "Pastikan menggunakan tautan seperti 'https://docs.google.com/spreadsheets/d/...' atau ID spreadsheet."
    )


def get_google_auth_url(session_id: str, redirect_uri: str | None = None) -> str:
    """Build Google OAuth 2.0 authorization URL."""
    client_id = settings.google_client_id
    if not client_id:
        raise ValueError(
            "GOOGLE_CLIENT_ID belum dikonfigurasi. "
            "Harap tambahkan GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET di file .env untuk mengaktifkan integrasi Google Sheets."
        )

    effective_redirect = redirect_uri or settings.google_redirect_uri
    state_payload = json.dumps({"session_id": session_id, "nonce": uuid.uuid4().hex[:8]})
    state_b64 = base64.urlsafe_b64encode(state_payload.encode("utf-8")).decode("utf-8")

    params = {
        "client_id": client_id,
        "redirect_uri": effective_redirect,
        "response_type": "code",
        "scope": " ".join(OAUTH_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state_b64,
    }
    return f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"


async def handle_google_oauth_callback(
    code: str,
    state: str,
    redirect_uri: str | None = None,
) -> dict[str, Any]:
    """Exchange authorization code for tokens, fetch profile, and save encrypted tokens."""
    client_id = settings.google_client_id
    client_secret = settings.google_client_secret or os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id:
        raise ValueError("Kredensial GOOGLE_CLIENT_ID belum dikonfigurasi di file .env.")

    try:
        decoded_state = json.loads(base64.urlsafe_b64decode(state.encode("utf-8")).decode("utf-8"))
        session_id = decoded_state.get("session_id")
    except Exception:
        session_id = state

    effective_redirect = redirect_uri or settings.google_redirect_uri

    # 1. Exchange code for access & refresh tokens
    token_request_body: dict[str, str] = {
        "code": code,
        "client_id": client_id,
        "redirect_uri": effective_redirect,
        "grant_type": "authorization_code",
    }
    if client_secret:
        token_request_body["client_secret"] = client_secret

    async with httpx.AsyncClient(timeout=15.0) as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data=token_request_body,
        )
        if token_resp.status_code != 200:
            logger.error("Google token exchange failed: %s", token_resp.text)
            raise ValueError(f"Gagal menukar kode otorisasi Google: {token_resp.text}")

        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 3600)

        # 2. Fetch user profile
        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if userinfo_resp.status_code != 200:
            logger.warning("Failed to fetch Google userinfo: %s", userinfo_resp.text)
            user_email = "connected_user@gmail.com"
            user_name = "Google User"
            user_pic = None
        else:
            u_data = userinfo_resp.json()
            user_email = u_data.get("email", "unknown@gmail.com")
            user_name = u_data.get("name")
            user_pic = u_data.get("picture")

    # 3. Store encrypted tokens in database
    expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=expires_in)
    enc_access = encrypt_token(access_token)
    enc_refresh = encrypt_token(refresh_token) if refresh_token else None
    conn_id = f"gconn_{uuid.uuid4().hex[:12]}"

    async with get_db_session() as session:
        await session.execute(
            text("""
                INSERT INTO analytics.google_connections (
                    connection_id,
                    session_id,
                    google_email,
                    google_name,
                    google_picture_url,
                    encrypted_access_token,
                    encrypted_refresh_token,
                    token_expires_at,
                    updated_at
                ) VALUES (
                    :conn_id,
                    :session_id,
                    :email,
                    :name,
                    :picture,
                    :enc_access,
                    :enc_refresh,
                    :expires_at,
                    CURRENT_TIMESTAMP
                )
                ON CONFLICT (session_id) DO UPDATE SET
                    google_email = EXCLUDED.google_email,
                    google_name = EXCLUDED.google_name,
                    google_picture_url = EXCLUDED.google_picture_url,
                    encrypted_access_token = EXCLUDED.encrypted_access_token,
                    encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, analytics.google_connections.encrypted_refresh_token),
                    token_expires_at = EXCLUDED.token_expires_at,
                    updated_at = CURRENT_TIMESTAMP;
            """),
            {
                "conn_id": conn_id,
                "session_id": session_id,
                "email": user_email,
                "name": user_name,
                "picture": user_pic,
                "enc_access": enc_access,
                "enc_refresh": enc_refresh,
                "expires_at": expires_at,
            },
        )
        await session.commit()

    logger.info("Successfully connected Google Account %s for session %s", user_email, session_id)
    return {
        "status": "connected",
        "session_id": session_id,
        "google_email": user_email,
        "google_name": user_name,
        "google_picture_url": user_pic,
        "expires_at": expires_at.isoformat(),
    }


async def get_google_connection_status(session_id: str) -> GoogleConnectionModel:
    """Retrieve Google connection status for a given session, falling back to latest connection."""
    async with get_db_session() as session:
        res = await session.execute(
            text("""
                SELECT google_email, google_name, google_picture_url, token_expires_at
                FROM analytics.google_connections
                WHERE session_id = :session_id;
            """),
            {"session_id": session_id},
        )
        row = res.mappings().one_or_none()
        if not row:
            # Fallback to the latest connected Google account in the database
            latest_res = await session.execute(
                text("""
                    SELECT google_email, google_name, google_picture_url, token_expires_at,
                           encrypted_access_token, encrypted_refresh_token
                    FROM analytics.google_connections
                    ORDER BY updated_at DESC
                    LIMIT 1;
                """)
            )
            latest = latest_res.mappings().one_or_none()
            if latest:
                # Associate the existing connection to this new session
                await session.execute(
                    text("""
                        INSERT INTO analytics.google_connections (
                            connection_id, session_id, google_email, google_name, google_picture_url,
                            encrypted_access_token, encrypted_refresh_token, token_expires_at, updated_at
                        ) VALUES (
                            :conn_id, :session_id, :email, :name, :pic,
                            :enc_acc, :enc_ref, :exp, CURRENT_TIMESTAMP
                        )
                        ON CONFLICT (session_id) DO NOTHING;
                    """),
                    {
                        "conn_id": f"conn_{uuid.uuid4().hex[:12]}",
                        "session_id": session_id,
                        "email": latest["google_email"],
                        "name": latest["google_name"],
                        "pic": latest["google_picture_url"],
                        "enc_acc": latest["encrypted_access_token"],
                        "enc_ref": latest["encrypted_refresh_token"],
                        "exp": latest["token_expires_at"],
                    },
                )
                await session.commit()
                row = latest

        if not row:
            return GoogleConnectionModel(
                session_id=session_id,
                google_email="",
                is_connected=False,
            )

        exp = row["token_expires_at"]
        exp_iso = exp.isoformat() if isinstance(exp, datetime.datetime) else str(exp)

        return GoogleConnectionModel(
            session_id=session_id,
            google_email=row["google_email"],
            google_name=row["google_name"],
            google_picture_url=row["google_picture_url"],
            is_connected=True,
            token_expires_at=exp_iso,
        )


async def disconnect_google_account(session_id: str) -> bool:
    """Disconnect Google account and remove stored tokens for session."""
    async with get_db_session() as session:
        # Fetch token for revoke attempt
        res = await session.execute(
            text("SELECT encrypted_access_token FROM analytics.google_connections WHERE session_id = :session_id;"),
            {"session_id": session_id},
        )
        row = res.mappings().one_or_none()
        if row and row["encrypted_access_token"]:
            token = decrypt_token(row["encrypted_access_token"])
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    await client.post(GOOGLE_REVOKE_URL, params={"token": token})
            except Exception:
                pass

        del_res = await session.execute(
            text("DELETE FROM analytics.google_connections WHERE session_id = :session_id;"),
            {"session_id": session_id},
        )
        await session.commit()
        return del_res.rowcount > 0


async def get_valid_access_token(session_id: str) -> str:
    """Get non-expired Google access token, automatically refreshing if needed."""
    async with get_db_session() as session:
        res = await session.execute(
            text("""
                SELECT encrypted_access_token, encrypted_refresh_token, token_expires_at
                FROM analytics.google_connections
                WHERE session_id = :session_id;
            """),
            {"session_id": session_id},
        )
        row = res.mappings().one_or_none()
        if not row:
            # Check latest connection fallback
            latest_res = await session.execute(
                text("""
                    SELECT encrypted_access_token, encrypted_refresh_token, token_expires_at
                    FROM analytics.google_connections
                    ORDER BY updated_at DESC
                    LIMIT 1;
                """)
            )
            row = latest_res.mappings().one_or_none()

        if not row:
            raise ValueError("Akun Google belum terhubung pada sesi ini. Silakan klik 'Hubungkan Akun Google' terlebih dahulu.")

        enc_access = row["encrypted_access_token"]
        enc_refresh = row["encrypted_refresh_token"]
        expires_at = row["token_expires_at"]

    now = datetime.datetime.now(datetime.timezone.utc)
    if isinstance(expires_at, datetime.datetime) and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)

    # If access token has at least 60 seconds left, return it
    if expires_at and expires_at > now + datetime.timedelta(seconds=60):
        return decrypt_token(enc_access)

    # Token is expired or expiring soon -> Refresh using refresh_token
    if not enc_refresh:
        # Fallback to existing decrypted token if refresh token absent
        return decrypt_token(enc_access)

    refresh_token = decrypt_token(enc_refresh)
    client_id = settings.google_client_id
    client_secret = settings.google_client_secret or os.getenv("GOOGLE_CLIENT_SECRET")

    refresh_payload: dict[str, str] = {
        "client_id": client_id,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    if client_secret:
        refresh_payload["client_secret"] = client_secret

    async with httpx.AsyncClient(timeout=15.0) as client:
        refresh_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data=refresh_payload,
        )
        if refresh_resp.status_code != 200:
            logger.error("Token refresh failed: %s", refresh_resp.text)
            return decrypt_token(enc_access)

        new_data = refresh_resp.json()
        new_access = new_data.get("access_token")
        new_expires_in = new_data.get("expires_in", 3600)
        new_expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=new_expires_in)
        new_enc_access = encrypt_token(new_access)

    async with get_db_session() as session:
        await session.execute(
            text("""
                UPDATE analytics.google_connections
                SET encrypted_access_token = :enc_access,
                    token_expires_at = :expires_at,
                    updated_at = CURRENT_TIMESTAMP
                WHERE session_id = :session_id;
            """),
            {
                "enc_access": new_enc_access,
                "expires_at": new_expires_at,
                "session_id": session_id,
            },
        )
        await session.commit()

    return new_access


async def fetch_spreadsheet_metadata(access_token: str, spreadsheet_id: str) -> dict[str, Any]:
    """Fetch spreadsheet title and tab properties from Google Sheets API v4."""
    url = f"{GOOGLE_SHEETS_API_BASE}/{spreadsheet_id}?fields=properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {access_token}"})
        if resp.status_code != 200:
            logger.error("Failed to fetch spreadsheet metadata: %s", resp.text)
            if resp.status_code == 404:
                raise ValueError("Spreadsheet tidak ditemukan atau link salah. Periksa kembali ID spreadsheet.")
            if resp.status_code in (401, 403):
                raise ValueError("Akses ke spreadsheet ditolak. Pastikan akun Google yang terhubung memiliki izin melihat dokumen ini.")
            raise ValueError(f"Google Sheets API error ({resp.status_code}): {resp.text}")

        data = resp.json()
        title = data.get("properties", {}).get("title", "Google Spreadsheet")
        sheets_raw = data.get("sheets", [])

        tabs: list[SheetTabInfo] = []
        for s in sheets_raw:
            props = s.get("properties", {})
            grid = props.get("gridProperties", {})
            tabs.append(
                SheetTabInfo(
                    sheet_id=props.get("sheetId", 0),
                    sheet_title=props.get("title", "Sheet1"),
                    row_count=grid.get("rowCount", 0),
                    column_count=grid.get("columnCount", 0),
                )
            )

        return {
            "spreadsheet_id": spreadsheet_id,
            "spreadsheet_title": title,
            "tabs": [t.model_dump() for t in tabs],
        }


async def fetch_sheet_values(access_token: str, spreadsheet_id: str, sheet_title: str) -> list[list[Any]]:
    """Fetch 2D array of values for a specific sheet title."""
    encoded_title = urllib.parse.quote(sheet_title)
    url = f"{GOOGLE_SHEETS_API_BASE}/{spreadsheet_id}/values/{encoded_title}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING"
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {access_token}"})
        if resp.status_code != 200:
            logger.error("Failed to fetch sheet values for '%s': %s", sheet_title, resp.text)
            raise ValueError(f"Gagal mengambil data dari sheet '{sheet_title}': {resp.text}")

        val_data = resp.json()
        return val_data.get("values", [])


def _find_header_row_index(raw_rows: list[list[Any]]) -> int:
    """Find the best row index to use as column headers (skipping metadata/title banners)."""
    if not raw_rows:
        return 0

    best_idx = 0
    max_non_empty = 0

    # Scan up to first 5 rows
    for idx, row in enumerate(raw_rows[:5]):
        non_empty = sum(1 for cell in row if cell is not None and str(cell).strip() != "")
        if non_empty > max_non_empty:
            max_non_empty = non_empty
            best_idx = idx

    return best_idx


async def ingest_google_sheets(
    session_id: str,
    spreadsheet_url_or_id: str,
    selected_sheet_titles: list[str] | None = None,
) -> dict[str, Any]:
    """Import selected or all sheets from Google Spreadsheet into session PostgreSQL tables."""
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    access_token = await get_valid_access_token(session_id)

    meta = await fetch_spreadsheet_metadata(access_token, spreadsheet_id)
    doc_title = meta.get("spreadsheet_title", "Spreadsheet")
    available_tabs: list[dict[str, Any]] = meta.get("tabs", [])

    # Filter tabs
    if selected_sheet_titles:
        target_tabs = [t for t in available_tabs if t["sheet_title"] in selected_sheet_titles]
    else:
        target_tabs = available_tabs

    if not target_tabs:
        raise ValueError("Tidak ada sheet/tab yang dipilih untuk diimpor.")

    session_short = session_id.replace("ses_", "")[:6]
    clean_doc = sanitize_identifier(doc_title, max_length=15, prefix="doc")

    created_tables: list[UploadedTableSummary] = []
    registered_tabs: list[dict[str, Any]] = []
    total_rows_all_sheets = 0

    for tab in target_tabs:
        sheet_title = tab["sheet_title"]
        raw_rows = await fetch_sheet_values(access_token, spreadsheet_id, sheet_title)
        if not raw_rows or len(raw_rows) <= 1:
            logger.info("Sheet '%s' is empty or has only 1 row, skipping table creation.", sheet_title)
            continue

        header_idx = _find_header_row_index(raw_rows)
        raw_headers = raw_rows[header_idx]
        data_rows = raw_rows[header_idx + 1 :]
        if not data_rows:
            continue

        # Standardize column count across all rows
        col_count = len(raw_headers)
        norm_rows: list[list[Any]] = []
        for r in data_rows:
            if len(r) < col_count:
                norm_rows.append(r + [None] * (col_count - len(r)))
            else:
                norm_rows.append(r[:col_count])

        # Convert to Pandas DataFrame for type inference
        df = pd.DataFrame(norm_rows, columns=[str(h).strip() if h is not None else "" for h in raw_headers])
        # Drop completely empty columns
        df = df.dropna(how="all", axis=1)
        if df.empty:
            continue

        clean_sheet = sanitize_identifier(sheet_title, max_length=15, prefix="sht")
        # Pola nama tabel: analytics.upload_<session_id>_gsheet_<doc>_<sheet>
        table_name = f"upload_{session_short}_gs_{clean_doc}_{clean_sheet}"[:55]

        # 1. Sanitize column names & build schema
        used_cols: set[str] = set()
        sanitized_col_names: list[str] = []
        column_meta_list: list[ColumnMeta] = []
        col_defs: list[str] = ["_row_id SERIAL PRIMARY KEY"]

        for idx, orig_col in enumerate(df.columns):
            raw_c = str(orig_col).strip()
            if not raw_c:
                raw_c = f"unnamed_{idx}"
            clean_c = sanitize_identifier(raw_c, max_length=30, prefix="col")

            # Resolve duplicates
            candidate = clean_c
            counter = 1
            while candidate in used_cols:
                candidate = f"{clean_c}_{counter}"
                counter += 1
            used_cols.add(candidate)
            sanitized_col_names.append(candidate)

            pg_type = infer_pg_type(df.iloc[:, idx])
            col_defs.append(f'"{candidate}" {pg_type}')

            # Extract sample values (up to 3 non-null)
            samples = [
                v for v in df.iloc[:10, idx].dropna().tolist()
                if v is not None and str(v).strip() != ""
            ][:3]
            column_meta_list.append(ColumnMeta(name=candidate, data_type=pg_type, sample_values=samples))

        # 2. Create PostgreSQL table
        async with get_db_session() as session:
            await session.execute(text(f'DROP TABLE IF EXISTS analytics."{table_name}" CASCADE;'))
            create_sql = f'CREATE TABLE analytics."{table_name}" (\n    ' + ",\n    ".join(col_defs) + "\n);"
            await session.execute(text(create_sql))

            # 3. Insert rows in chunks
            insert_cols = ['"' + c + '"' for c in sanitized_col_names]
            val_placeholders = [f":c{i}" for i in range(len(sanitized_col_names))]
            insert_sql = f'INSERT INTO analytics."{table_name}" ({", ".join(insert_cols)}) VALUES ({", ".join(val_placeholders)});'

            chunk_size = 500
            for chunk_start in range(0, len(df), chunk_size):
                chunk = df.iloc[chunk_start : chunk_start + chunk_size]
                batch_params = []
                for _, row in chunk.iterrows():
                    row_dict = {}
                    for c_idx, col_name in enumerate(sanitized_col_names):
                        raw_v = row.iloc[c_idx]
                        c_meta = column_meta_list[c_idx]
                        row_dict[f"c{c_idx}"] = sanitize_cell_value(raw_v, c_meta.data_type)
                    batch_params.append(row_dict)

                if batch_params:
                    await session.execute(text(insert_sql), batch_params)

            # 4. Register in analytics.session_uploaded_tables
            reg_id = f"up_{uuid.uuid4().hex[:12]}"
            await session.execute(
                text("""
                    INSERT INTO analytics.session_uploaded_tables (
                        id, session_id, table_name, original_filename, sheet_name, row_count, columns, created_at
                    ) VALUES (
                        :id, :session_id, :table_name, :filename, :sheet_name, :row_count, CAST(:columns AS JSONB), CURRENT_TIMESTAMP
                    );
                """),
                {
                    "id": reg_id,
                    "session_id": session_id,
                    "table_name": table_name,
                    "filename": f"Google Sheets: {doc_title}",
                    "sheet_name": sheet_title,
                    "row_count": len(df),
                    "columns": json.dumps([c.model_dump() for c in column_meta_list]),
                },
            )
            await session.commit()

        total_rows_all_sheets += len(df)
        table_summary = UploadedTableSummary(
            table_name=table_name,
            original_filename=f"Google Sheets: {doc_title}",
            sheet_name=sheet_title,
            row_count=len(df),
            columns=column_meta_list,
        )
        created_tables.append(table_summary)
        registered_tabs.append({
            "sheet_id": tab.get("sheet_id", 0),
            "sheet_title": sheet_title,
            "table_name": table_name,
            "row_count": len(df),
        })

    # 5. Record link in analytics.session_google_sheets
    sheet_link_id = f"gs_{uuid.uuid4().hex[:12]}"
    now = datetime.datetime.now(datetime.timezone.utc)
    async with get_db_session() as session:
        await session.execute(
            text("""
                INSERT INTO analytics.session_google_sheets (
                    sheet_link_id, session_id, spreadsheet_id, spreadsheet_title,
                    sheet_tabs, last_synced_at, sync_status, row_count_total, created_at
                ) VALUES (
                    :link_id, :session_id, :spreadsheet_id, :title,
                    CAST(:tabs AS JSONB), :now, 'SYNCED', :total_rows, :now
                );
            """),
            {
                "link_id": sheet_link_id,
                "session_id": session_id,
                "spreadsheet_id": spreadsheet_id,
                "title": doc_title,
                "tabs": json.dumps(registered_tabs),
                "now": now,
                "total_rows": total_rows_all_sheets,
            },
        )
        await session.commit()

    # 6. Profile newly created tables via DataHealthProfiler (FR-41)
    health_profiles = []
    try:
        from src.ingestion.data_health_profiler import DataHealthProfiler
        profiler = DataHealthProfiler()
        for t in created_tables:
            p = await profiler.profile_table(t.table_name)
            health_profiles.append(p.model_dump())
    except Exception as e:
        logger.warning("Data health profiling failed for Google Sheet tables: %s", e)

    return {
        "status": "success",
        "sheet_link_id": sheet_link_id,
        "spreadsheet_id": spreadsheet_id,
        "spreadsheet_title": doc_title,
        "total_tables_created": len(created_tables),
        "total_rows_imported": total_rows_all_sheets,
        "tables": [t.model_dump() for t in created_tables],
        "health_profiles": health_profiles,
    }


async def resync_google_sheet(sheet_link_id: str) -> dict[str, Any]:
    """Re-sync live data from Google Sheets API into existing PostgreSQL tables."""
    async with get_db_session() as session:
        res = await session.execute(
            text("""
                SELECT session_id, spreadsheet_id, spreadsheet_title, sheet_tabs
                FROM analytics.session_google_sheets
                WHERE sheet_link_id = :link_id;
            """),
            {"link_id": sheet_link_id},
        )
        link = res.mappings().one_or_none()
        if not link:
            raise ValueError(f"Link Google Sheets dengan ID '{sheet_link_id}' tidak ditemukan.")

    session_id = link["session_id"]
    spreadsheet_id = link["spreadsheet_id"]
    doc_title = link["spreadsheet_title"]
    sheet_tabs = link["sheet_tabs"]
    if isinstance(sheet_tabs, str):
        sheet_tabs = json.loads(sheet_tabs)

    access_token = await get_valid_access_token(session_id)
    updated_tables = []
    new_total_rows = 0

    for tab in sheet_tabs:
        sheet_title = tab["sheet_title"]
        table_name = tab["table_name"]

        raw_rows = await fetch_sheet_values(access_token, spreadsheet_id, sheet_title)
        if not raw_rows or len(raw_rows) <= 1:
            continue

        header_idx = _find_header_row_index(raw_rows)
        raw_headers = raw_rows[header_idx]
        data_rows = raw_rows[header_idx + 1 :]
        if not data_rows:
            continue

        col_count = len(raw_headers)
        norm_rows: list[list[Any]] = []
        for r in data_rows:
            if len(r) < col_count:
                norm_rows.append(r + [None] * (col_count - len(r)))
            else:
                norm_rows.append(r[:col_count])

        df = pd.DataFrame(norm_rows, columns=[str(h).strip() if h is not None else "" for h in raw_headers])
        df = df.dropna(how="all", axis=1)
        if df.empty:
            continue

        # Get existing columns in PostgreSQL table
        async with get_db_session() as session:
            c_res = await session.execute(
                text("""
                    SELECT column_name, data_type
                    FROM information_schema.columns
                    WHERE table_schema = 'analytics' AND table_name = :t_name
                      AND column_name != '_row_id';
                """),
                {"t_name": table_name},
            )
            existing_cols = {r["column_name"]: r["data_type"] for r in c_res.mappings().all()}

            if not existing_cols:
                continue

            # Truncate existing data
            await session.execute(text(f'TRUNCATE TABLE analytics."{table_name}" RESTART IDENTITY;'))

            sanitized_names = list(existing_cols.keys())
            insert_cols = ['"' + c + '"' for c in sanitized_names]
            val_placeholders = [f":c{i}" for i in range(len(sanitized_names))]
            insert_sql = f'INSERT INTO analytics."{table_name}" ({", ".join(insert_cols)}) VALUES ({", ".join(val_placeholders)});'

            chunk_size = 500
            for chunk_start in range(0, len(df), chunk_size):
                chunk = df.iloc[chunk_start : chunk_start + chunk_size]
                batch_params = []
                for _, row in chunk.iterrows():
                    row_dict = {}
                    for c_idx, col_name in enumerate(sanitized_names):
                        raw_v = row.iloc[c_idx] if c_idx < len(row) else None
                        pg_type = existing_cols[col_name]
                        row_dict[f"c{c_idx}"] = sanitize_cell_value(raw_v, pg_type)
                    batch_params.append(row_dict)

                if batch_params:
                    await session.execute(text(insert_sql), batch_params)

            # Update row count in session_uploaded_tables
            await session.execute(
                text("""
                    UPDATE analytics.session_uploaded_tables
                    SET row_count = :rc
                    WHERE session_id = :session_id AND table_name = :t_name;
                """),
                {"rc": len(df), "session_id": session_id, "t_name": table_name},
            )
            await session.commit()

        tab["row_count"] = len(df)
        new_total_rows += len(df)
        updated_tables.append({"table_name": table_name, "sheet_title": sheet_title, "new_rows": len(df)})

    now = datetime.datetime.now(datetime.timezone.utc)
    async with get_db_session() as session:
        await session.execute(
            text("""
                UPDATE analytics.session_google_sheets
                SET last_synced_at = :now,
                    sheet_tabs = CAST(:tabs AS JSONB),
                    row_count_total = :tot,
                    sync_status = 'SYNCED'
                WHERE sheet_link_id = :link_id;
            """),
            {
                "now": now,
                "tabs": json.dumps(sheet_tabs),
                "tot": new_total_rows,
                "link_id": sheet_link_id,
            },
        )
        await session.commit()

    return {
        "status": "success",
        "sheet_link_id": sheet_link_id,
        "spreadsheet_title": doc_title,
        "last_synced_at": now.isoformat(),
        "updated_tables": updated_tables,
        "total_rows": new_total_rows,
    }


async def list_session_google_sheets(session_id: str) -> list[GoogleSheetLinkSummary]:
    """Retrieve all linked Google Sheets for a session."""
    async with get_db_session() as session:
        res = await session.execute(
            text("""
                SELECT sheet_link_id, session_id, spreadsheet_id, spreadsheet_title,
                       sheet_tabs, last_synced_at, sync_status, row_count_total
                FROM analytics.session_google_sheets
                WHERE session_id = :session_id
                ORDER BY created_at DESC;
            """),
            {"session_id": session_id},
        )
        items: list[GoogleSheetLinkSummary] = []
        for r in res.mappings().all():
            tabs = r["sheet_tabs"]
            if isinstance(tabs, str):
                tabs = json.loads(tabs)
            l_synced = r["last_synced_at"]
            l_iso = l_synced.isoformat() if isinstance(l_synced, datetime.datetime) else str(l_synced)
            items.append(
                GoogleSheetLinkSummary(
                    sheet_link_id=r["sheet_link_id"],
                    session_id=r["session_id"],
                    spreadsheet_id=r["spreadsheet_id"],
                    spreadsheet_title=r["spreadsheet_title"],
                    sheet_tabs=tabs,
                    last_synced_at=l_iso,
                    sync_status=r["sync_status"],
                    row_count_total=r["row_count_total"],
                )
            )
        return items


async def remove_session_google_sheet(sheet_link_id: str) -> bool:
    """Drop PostgreSQL tables and delete registrations for a linked Google Sheet."""
    async with get_db_session() as session:
        res = await session.execute(
            text("SELECT session_id, sheet_tabs FROM analytics.session_google_sheets WHERE sheet_link_id = :link_id;"),
            {"link_id": sheet_link_id},
        )
        row = res.mappings().one_or_none()
        if not row:
            return False

        session_id = row["session_id"]
        tabs = row["sheet_tabs"]
        if isinstance(tabs, str):
            tabs = json.loads(tabs)

        for tab in tabs:
            table_name = tab.get("table_name")
            if table_name:
                try:
                    await session.execute(text(f'DROP TABLE IF EXISTS analytics."{table_name}" CASCADE;'))
                    await session.execute(
                        text("DELETE FROM analytics.session_uploaded_tables WHERE session_id = :sid AND table_name = :tname;"),
                        {"sid": session_id, "tname": table_name},
                    )
                except Exception as e:
                    logger.warning("Failed dropping table %s: %s", table_name, e)

        await session.execute(
            text("DELETE FROM analytics.session_google_sheets WHERE sheet_link_id = :link_id;"),
            {"link_id": sheet_link_id},
        )
        await session.commit()
        return True
