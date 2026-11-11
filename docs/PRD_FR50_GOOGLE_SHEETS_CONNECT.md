# Product Requirements Document (PRD)
## FR-50: Google Account OAuth & Live Google Sheets Ingestion Engine (Cloud Spreadsheet Connect & Warehouse Cross-Join)

| Atribut | Keterangan |
| :--- | :--- |
| ID Fitur | FR-50 |
| Nama Fitur | Google Account OAuth & Live Google Sheets Ingestion Engine (Cloud Spreadsheet Connect & Warehouse Cross-Join) |
| Versi | 1.0 (Proposal Spesifikasi Teknis) |
| Tanggal | 11 November 2026 |
| Status | Disetujui (Roadmap Pengembangan Aktif) |
| Prioritas | P1 (High Impact - Seamless Cloud Data Ingestion & Live Sync) |
| Komponen Terdampak | Backend (`src/ingestion/`, `src/tools/database.py`, `src/api/main.py`), Database (`analytics.google_connections`, `analytics.session_google_sheets`), Frontend (`GoogleSheetsModal.tsx`, `Navbar.tsx`, `ChatInput.tsx`, `useQueries.ts`) |

---

## 1. Ringkasan Eksekutif & Latar Belakang

### 1.1 Latar Belakang
Pada fitur Bring Your Own Data (FR-39), Harmonix telah mendukung pengunggahan berkas statis (Excel/CSV) multi-sheet hingga 10 berkas secara lokal. Namun, pada alur kerja modern:
1. **Data Berada di Cloud (Google Sheets)**: Sebagian besar tim bisnis (Sales, Marketing, Finance, HR) mengelola target harian, pipeline prospek, anggaran operasional, dan kampanye langsung di Google Sheets secara kolaboratif.
2. **Friksi Pengunduhan Berulang**: Setiap kali ada pembaruan data di spreadsheet, pengguna terpaksa mengunduh file `.xlsx` / `.csv` dari Google Sheets, menyimpannya di komputer lokal, lalu mengunggahnya kembali ke Harmonix.
3. **Ketiadaan Sinkronisasi Real-Time**: Data yang diunggah berupa snapshot statis yang cepat usang (*stale data*) jika spreadsheet terus diperbarui oleh rekan tim lain.

### 1.2 Solusi yang Ditetapkan
Membangun **Google Account OAuth & Live Google Sheets Ingestion Engine (FR-50)** yang menghubungkan Harmonix langsung dengan akun Google pengguna:
- **Autentikasi Terstandar (Google OAuth 2.0)**: Pengguna melakukan login Google sekali klik (*Sign in with Google*) dengan hak akses minimal yang aman (*least-privilege read-only scopes*).
- **Import Langsung via URL / Drive Picker**: Pengguna cukup menempelkan tautan (*URL*) Google Sheets atau memilih spreadsheet dari Google Drive mereka.
- **Konversi Multi-Tab ke SQL Otomatis**: Setiap tab/sheet di dalam Google Spreadsheet dikonversi menjadi tabel fisik PostgreSQL terisolasi (`analytics.gsheet_<session_id>_<doc_name>_<sheet_name>`).
- **Warehouse Cross-Join**: Agent Text-to-SQL Harmonix dapat langsung melakukan `JOIN` antara data Google Sheets dengan tabel data warehouse utama (`orders`, `customers`, `products`) maupun file Excel lokal lainnya.
- **Sinkronisasi 1-Klik (*Live Re-Sync*)**: Tombol segarkan data spreadsheet untuk menarik versi mutakhir langsung dari Google Sheets API v4 tanpa perlu mengulang proses input.
- **Zero-Cost First**: Memanfaatkan Google Sheets API v4 Free Tier dari Google Cloud Console (kuota gratis 300 requests/menit per project, 60 requests/menit per user) tanpa biaya langganan API berbayar.

---

## 2. Arsitektur & Alur Kerja Sistem

```
[Pengguna di Web UI]
        │
        ├── 1. Klik "Connect Google Account"
        ▼
[Google OAuth 2.0 Consent Screen] (Scope: spreadsheets.readonly, drive.readonly)
        │
        ├── 2. Redirect callback dengan auth code ke FastAPI
        ▼
[Backend: /v1/auth/google/callback]
        │
        ├── 3. Pertukaran Token -> Dapatkan Access Token & Refresh Token
        ├── 4. Simpan terenkripsi (AES-256) di analytics.google_connections
        ▼
[Pengguna Memasukkan URL Google Sheets / ID Spreadsheet]
        │
        ▼
[Backend: Google Sheets Ingestion Engine]
        │
        ├── 5. Panggil Google Sheets API v4 (spreadsheets.get & values.batchGet)
        ├── 6. Ekstraksi seluruh Sheet/Tab, nama kolom, dan baris data
        ├── 7. Sanitasi Skema & Type Inference (NUMERIC, INTEGER, TIMESTAMP, TEXT)
        ├── 8. Dibuat tabel fisik: analytics.gsheet_<session_id>_<doc>_<sheet>
        ├── 9. Injeksi skema ke Dynamic Catalog Agent
        ▼
[Agent Text-to-SQL Harmonix]
        │
        ├── 10. Agent dapat kueri SQL, buat ECharts, atau JOIN dengan Warehouse
        ▼
[Pengguna Klik "Re-Sync Sheets" di Dashboard / Chat]
        │
        └── 11. Tarik data terbaru via Refresh Token -> TRUNCATE & COPY PostgreSQL
```

---

## 3. Rincian Kebutuhan Fungsional (Functional Requirements)

### 3.1 Autentikasi Google OAuth 2.0 & Token Vault
1. **Hak Akses Minimal (*Least Privilege Scopes*)**:
   - `https://www.googleapis.com/auth/spreadsheets.readonly` (hanya membaca spreadsheet, dilarang mengubah/menulis).
   - `https://www.googleapis.com/auth/drive.readonly` (hanya membaca metadata file spreadsheet di Google Drive).
   - `openid`, `profile`, `email` (identifikasi akun pengguna yang terhubung).
2. **Penyimpanan Kredensial Terenkripsi**:
   - Access token dan refresh token disimpan terenkripsi menggunakan kunci enkripsi simetris AES-256 (`Fernet`) di tabel database `analytics.google_connections`.
   - Token refresh otomatis diperbarui (*silent refresh*) di background jika access token telah kedaluwarsa (kedaluwarsa standar 1 jam).
3. **Pemisahan Sesi & Manajemen Akun**:
   - Pengguna dapat memutuskan koneksi (*Disconnect Google Account*) kapan saja dengan 1 klik, yang akan mencabut token dan menghapus sesi tersimpan.

### 3.2 Google Sheets Extraction & Ingestion Engine
1. **Resolusi Tautan Cerdas (*Smart URL Parser*)**:
   - Menerima format URL publik maupun privat milik akun pengguna:
     - `https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit#gid={sheetId}`
     - Atau input langsung `{spreadsheetId}`.
2. **Dukungan Multi-Tab Otomatis**:
   - Sistem membaca seluruh tab aktif dalam spreadsheet dan mengonversi masing-masing tab menjadi tabel terpisah di PostgreSQL:
     - Pola nama: `analytics.gsheet_<session_id>_<clean_title>_<clean_sheet_name>`.
3. **Sanitasi Header & Deteksi Tipe Kolom**:
   - Otomatis membersihkan nama kolom (snake_case, pemangkasan karakter khusus, penanganan nama kolom kosong `unnamed_x`).
   - Inferensi tipe data otomatis (kalkulasi rasio angka, tanggal, dan teks) untuk menghasilkan tipe kolom SQL yang akurat (`DECIMAL`, `BIGINT`, `DATE`, `TEXT`).
4. **Deteksi Baris Header Fleksibel**:
   - Mengatasi spreadsheet yang memiliki judul atau catatan di baris 1-3 dengan memindai baris pertama yang memuat header representatif (mirip parser Excel BYOD FR-39).

### 3.3 Warehouse Cross-Join & Agent Capability
1. **Analisis Terpadu**:
   - Analyst Agent secara otomatis mengenali tabel Google Sheets dalam *active table catalog*.
   - Agent dapat menjalankan query SQL yang menggabungkan tabel Google Sheets dengan tabel lokal PostgreSQL (misal: membandingkan target penjualan dari Google Sheets dengan realisasi penjualan di tabel `orders` warehouse).
2. **Pemeriksaan Kualitas Data (Data Health Profiling)**:
   - Data Google Sheets yang diimpor langsung mendapatkan audit kualitas data instan (missing value rate, duplikasi, outlier) dari engine FR-41.
3. **Visualisasi & Live Dashboard**:
   - Hasil analisis Google Sheets dapat divisualisasikan dengan Apache ECharts (FR-47), disematkan ke Live BI Dashboard Canvas, dan di-drilldown (FR-48).

### 3.4 On-Demand Re-Sync & Auto-Sync
1. **Tombol 1-Klik Segarkan Spreadsheet**:
   - Tersedia tombol "Sync Google Sheets" di bilah atas sesi obrolan dan Live BI Dashboard.
   - Sistem menarik kembali data terbaru dari API Google Sheets tanpa mengubah struktur skema tabel SQL yang sudah ada, sehingga query riwayat chat dan widget dashboard tetap valid.
2. **Penanganan Konflik Skema**:
   - Jika pengguna menambah kolom baru di Google Sheets, proses re-sync secara cerdas menjalankan `ALTER TABLE ADD COLUMN` tanpa menghapus data sebelumnya.

---

## 4. Skema Database

```sql
-- Tabel untuk menyimpan status koneksi akun Google per pengguna/sesi
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

-- Tabel registrasi spreadsheet yang sedang aktif dihubungkan ke sesi
CREATE TABLE IF NOT EXISTS analytics.session_google_sheets (
    sheet_link_id VARCHAR(64) PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    spreadsheet_id VARCHAR(128) NOT NULL,
    spreadsheet_title VARCHAR(255) NOT NULL,
    sheet_tabs JSONB NOT NULL, -- Array nama sheet & nama tabel SQL target
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sync_status VARCHAR(32) DEFAULT 'SYNCED', -- 'SYNCED', 'SYNCING', 'ERROR'
    row_count_total INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_google_conn_session ON analytics.google_connections(session_id);
CREATE INDEX IF NOT EXISTS idx_google_sheets_session ON analytics.session_google_sheets(session_id);
```

---

## 5. Kontrak API Endpoints (FastAPI)

| Metode | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/v1/auth/google/login?session_id={id}` | Menghasilkan Google OAuth consent URL untuk otorisasi pengguna |
| `GET` | `/v1/auth/google/callback` | Menangani pertukaran authorization code, enkripsi token, dan redirect |
| `GET` | `/v1/auth/google/status?session_id={id}` | Memeriksa status koneksi Google (email terhubung, avatar, status token) |
| `DELETE` | `/v1/auth/google/disconnect?session_id={id}` | Memutus koneksi akun Google dan mencabut token |
| `POST` | `/v1/google-sheets/import` | Menerima spreadsheet URL / ID, mengambil data via API, dan membuat tabel SQL |
| `POST` | `/v1/google-sheets/resync/{sheet_link_id}` | Menjalankan sinkronisasi ulang data terbaru dari Google Sheets |
| `GET` | `/v1/google-sheets/{session_id}` | Menampilkan daftar Google Sheets yang aktif di sesi ini |

---

## 6. Desain Antarmuka Pengguna (Web UI)

1. **Tombol "Connect Google Sheets" di Input Area & File Uploader**:
   - Ikon Google Drive / Google Sheets hijau khas di samping tombol lampiran file lokal.
   - Menampilkan status badge: `Belum Terhubung` atau `Terhubung sebagai email@gmail.com`.
2. **Modal Impor Google Sheets**:
   - Input kolom untuk menempelkan URL Google Sheets (`https://docs.google.com/spreadsheets/d/...`).
   - Tombol pratinjau daftar sheet/tab yang ditemukan di dokumen tersebut.
   - Opsi memilih sheet mana saja yang ingin diimpor ke SQL.
3. **Pill Indikator Sinkronisasi di Sesi Chat**:
   - Badge mengambang halus di bagian atas pesan yang menandakan bahwa sesi ini terhubung dengan live Google Sheets.
   - Tombol ikon putar (*Refresh*) untuk memicu re-sync instan.

---

## 7. Pertimbangan Keamanan & Batasan (Guardrails)

1. **Read-Only Enforced**: Scope OAuth hanya meminta akses baca (`readonly`). Aplikasi tidak memiliki izin untuk mengedit atau menghapus lembar kerja di Google Drive pengguna.
2. **Batas Ukuran & Rate-Limiting**:
   - Maksimal 100.000 baris per spreadsheet untuk menjamin performa ingestion dan respons latensi rendah.
   - Menghormati rate-limit Google API (exponential backoff jika terkena kuota per menit).
3. **Pembersihan Data Sesi (Session Lifecycle)**:
   - Ketika pengguna menghapus sesi percakapan (`DELETE /v1/sessions/{id}`), seluruh tabel PostgreSQL yang dibuat dari Google Sheets (`analytics.gsheet_<session_id>_*`) otomatis dihapus bersamanya (`DROP TABLE CASCADE`).
