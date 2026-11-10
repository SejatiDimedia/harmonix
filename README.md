# Harmonix: Autonomous Enterprise AI Data Analyst Platform

[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20%2B%20pgvector-336791.svg)](https://www.postgresql.org/)
[![Apache ECharts](https://img.shields.io/badge/Apache%20ECharts-5.6+-e43961.svg)](https://echarts.apache.org/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Standard%20Server-orange.svg)](https://modelcontextprotocol.io/)
[![Unit & Integration Tests](https://img.shields.io/badge/Tests-185+%20Passed-brightgreen.svg)](#verifikasi--pengujian-sistem)
[![Safety Enforcement](https://img.shields.io/badge/Safety%20Rate-100%25-success.svg)](#matriks-keamanan--tata-kelola-data-enterprise)
[![Inference Architecture](https://img.shields.io/badge/Inference-Hybrid%20%26%20Zero--Cost-brightgreen.svg)](#arsitektur-inferensi--efisiensi-biaya)

> **Harmonix** adalah platform analitik data otonom (*Autonomous AI Data Analyst*) tingkat enterprise yang mentranslasikan pertanyaan bisnis berbahasa alami menjadi analisis data presisi (*Natural Language to Analytics*). Dilengkapi arsitektur pengaman produksi (*production agent harness*) komprehensif: verifikasi sintaks AST, gerbang persetujuan *Human-in-the-Loop*, verifikasi independen *Maker-Checker Dual-Agent*, profiling kesehatan data otomatis (BYOD), kanvas Live Dashboard interaktif dengan mode TV Command Center, antrean tugas asinkron, hingga integrasi Model Context Protocol (MCP).

---

## Daftar Isi

- [Nilai Bisnis & Ringkasan Solusi](#nilai-bisnis--ringkasan-solusi)
- [Arsitektur Sistem Enterprise](#arsitektur-sistem-enterprise)
- [Pilar Kemampuan Utama (12 Modul Enterprise)](#pilar-kemampuan-utama-12-modul-enterprise)
  - [1. Analitik Percakapan & Subprocess Python Terisolasi](#1-analitik-percakapan--subprocess-python-terisolasi)
  - [2. Validasi AST SQL Guardrail & Anti-Injection](#2-validasi-ast-sql-guardrail--anti-injection)
  - [3. Verifikasi Independen Maker-Checker Dual-Agent](#3-verifikasi-independen-maker-checker-dual-agent)
  - [4. Tata Kelola Human-in-the-Loop (HITL)](#4-tata-kelola-human-in-the-loop-hitl)
  - [5. Live BI Dashboard & TV Command Center Mode](#5-live-bi-dashboard--tv-command-center-mode)
  - [6. Ingesti Data Mandiri (BYOD) & Profiling Kesehatan Data Otomatis](#6-ingesti-data-mandiri-byod--profiling-kesehatan-data-otomatis)
  - [7. Pemrosesan Batch & Arsitektur Antrean Tugas Asinkron](#7-pemrosesan-batch--arsitektur-antrean-tugas-asinkron)
  - [8. Glosarium Metrik Hybrid RAG (pgvector + BM25 RRF)](#8-glosarium-metrik-hybrid-rag-pgvector--bm25-rrf)
  - [9. Memori Jangka Panjang & Repositori Golden Query](#9-memori-jangka-panjang--repositori-golden-query)
  - [10. Optimasi Biaya: Prompt Caching & Kompaksi Konteks](#10-optimasi-biaya-prompt-caching--kompaksi-konteks)
  - [11. Model Registry Dinamis & Manajemen Kunci Runtime](#11-model-registry-dinamis--manajemen-kunci-runtime)
  - [12. Server Model Context Protocol (MCP) untuk IDE & Klien Eksternal](#12-server-model-context-protocol-mcp-untuk-ide--klien-eksternal)
- [Domain Data Analitik & Pertanyaan Uji Eksekutif](#domain-data-analitik--pertanyaan-uji-eksekutif)
- [Matriks Keamanan & Tata Kelola Data Enterprise](#matriks-keamanan--tata-kelola-data-enterprise)
- [Panduan Memulai Cepat (Quickstart)](#panduan-memulai-cepat-quickstart)
- [Referensi Konfigurasi Lingkungan (.env)](#referensi-konfigurasi-lingkungan-env)
- [Referensi Antarmuka & REST API](#referensi-antarmuka--rest-api)
- [Integrasi Eksternal (Claude Desktop & Cursor)](#integrasi-eksternal-claude-desktop--cursor)
- [Verifikasi & Pengujian Sistem](#verifikasi--pengujian-sistem)
- [Struktur Repositori](#struktur-repositori)
- [Lisensi & Ketentuan](#lisensi--ketentuan)

---

## Nilai Bisnis & Ringkasan Solusi

Pengambilan keputusan berbasis data sering terkendala oleh keterbatasan kapasitas tim Business Intelligence dalam melayani permintaan ad-hoc yang terus meningkat. Di sisi lain, memberikan akses langsung LLM komersial ke database produksi memicu risiko kebocoran data, halusinasi kalkulasi, dan ancaman keamanan database.

Harmonix mengatasi tantangan ini melalui arsitektur analitik terkelola:

| Tantangan Operasional Data | Risiko Konvensional LLM | Solusi Terverifikasi Harmonix |
| :--- | :--- | :--- |
| **Ketergantungan Tim BI** | Antrean analisis ad-hoc memakan waktu berhari-hari. | **Self-Serve Data Intelligence:** Eksekutif bisnis mendapatkan jawaban analitik, tabel, dan grafik dalam hitungan detik. |
| **Risiko Kerusakan Database** | Perintah berbahaya (`DROP`, `DELETE`, `UPDATE`) tidak sengaja dieksekusi. | **AST SQL Guardrail:** Parser `sqlglot` memastikan 100% query bersifat read-only sebelum dieksekusi ke PostgreSQL. |
| **Kebocoran Data Sensitif** | Data pelanggan (email, telepon, kartu kredit) muncul di hasil analisis. | **PII Masking & Approval Gate:** Penyensoran otomatis regex/kamus dan penahanan query berisiko via Human-in-the-Loop. |
| **Inkonsistensi Angka Metrik** | Rumus KPI (seperti GMV, Churn, AOV) berbeda antar departemen. | **Hybrid RAG Metric Glossary:** Definisi resmi terindeks semantik di `pgvector` dan disitasi secara transparan. |
| **Halusinasi Logika & Angka** | Model bahasa mengarang angka yang tidak ada di hasil query. | **Maker-Checker Dual-Agent:** Auditor independen memverifikasi kesesuaian angka output terhadap tabel hasil sebelum ditampilkan. |
| **Kueri Berat Merontokkan DB** | Query *full-table scan* tanpa batas membuat server database kehabisan memori. | **Enforced Query Budget:** Penambahan deterministik klausa `LIMIT 100` dan timeout ketat. |

---

## Arsitektur Sistem Enterprise

Arsitektur Harmonix dibangun dengan pendekatan berlapis (*Defense-in-Depth*), memisahkan antarmuka interaktif, lapisan orkestrasi agen, sistem validasi keamanan, manajemen antrean tugas, serta infrastruktur basis data:

```mermaid
flowchart TD
    User([Pengguna Bisnis / Data Analyst]) --> WebUI[Web Client UI: Chat Canvas & Live Dashboard]
    ExternalClient([External IDE: Claude Desktop / Cursor]) --> MCPEndpoint[MCP Server: Transport stdio / SSE]
    
    WebUI --> APIGateway[FastAPI Gateway: /v1/chat, /v1/dashboard, /v1/batch, /v1/ingest, /v1/approve]
    MCPEndpoint --> APIGateway
    
    subgraph CoreEngine["Harmonix Core Processing Platform"]
        direction TB
        
        subgraph Layer1["1. Context, Memory & Ingestion"]
            Glossary[Glosarium Metrik: FastEmbed + pgvector + BM25 RRF]
            LongTermMem[Long-Term Memory: Golden Query Exemplars via pgvector]
            BYOD[BYOD Parser: Excel/CSV Ingestion & Health Profiler 0-100]
            JITSchema[JIT Schema Discovery: Dynamic Catalog Inspection]
        end
        
        subgraph Layer2["2. Orchestration & Dual-Agent Verification"]
            ProceduralLoop[Procedural Loop Engine: < 1ms Overhead]
            LangGraphAgent[LangGraph StateGraph Engine: Multi-Agent Ready]
            MakerChecker[Auditor Agent: Independent LLM Verification Gate]
        end
        
        subgraph Layer3["3. Security & Governance Guardrails"]
            ASTGuard[AST SQL Validator: sqlglot Read-Only SELECT]
            ApprovalGate[Non-Blocking HITL Approval Gate: WAITING_APPROVAL]
            PIIMask[PII Masker: Email, Phone, Credit Cards]
            Sandbox[Subprocess Python Sandbox: OS SIGKILL < 3s]
        end
        
        subgraph Layer4["4. Queue & High-Volume Processing"]
            QueueMgr[Queue Manager: PostgreSQL FOR UPDATE SKIP LOCKED / Redis]
            BatchEngine[Batch Execution Engine: Concurrent Async Semaphores]
            Workers[Background Task Workers]
        end
        
        subgraph Layer5["5. Observability & Cost Optimization"]
            Tracer[AgentTracer: TTFT, Token Usage, Latency Breakdown]
            PromptCache[Prompt Caching Engine: Deterministic Schema Prefix]
            Compaction[Conversation Compaction: Multi-Turn Context Summarizer]
        end
    end
    
    subgraph StorageInfra["Infrastruktur Basis Data & Persistensi"]
        Warehouse[(PostgreSQL 16 Analytics: Olist E-Commerce Dataset)]
        DashboardStore[(analytics.dashboard_widgets: Canvas Layout State)]
        TaskState[(PostgreSQL State: agent_tasks & task_checkpoints)]
    end

    subgraph InferenceInfra["Adaptive Multi-Provider Router"]
        Router[Fallback Router: Exponential Backoff]
        CloudTier[Google Gemini 2.0 Flash / Groq Llama 3.3 70B]
        LocalTier[Ollama Offline Local: qwen2.5-coder:7b]
    end

    APIGateway --> Layer2
    Layer2 <--> Layer1
    Layer2 <--> Layer3
    Layer2 <--> Layer4
    Layer2 <--> Layer5
    Layer2 <--> Router
    Router --> CloudTier & LocalTier
    Layer3 --> Warehouse
    Layer3 --> DashboardStore
    Layer4 --> TaskState
```

---

## Pilar Kemampuan Utama (13 Modul Enterprise)

### 1. Analitik Percakapan & Subprocess Python Terisolasi
- **Penerjemahan Bahasa Alami ke SQL Presisi:** Menghasilkan query PostgreSQL yang efisien berdasarkan skema aktif dan kamus metrik resmi.
- **Kalkulasi Lanjutan via Sandbox Python (`src/tools/sandbox.py`):** Untuk analisis statistik, regresi, atau kalkulasi persentase yang tidak efisien diselesaikan dalam SQL murni, agen mengeksekusi kode Python di dalam subprocess OS terisolasi dengan proteksi timeout ketat (`SIGKILL` < 3 detik) dan pemblokiran modul terlarang (`os`, `sys`, `socket`).

### 2. Validasi AST SQL Guardrail & Anti-Injection
- **Pemeriksaan Pohon Sintaks Menggunakan `sqlglot` (`src/tools/guardrails.py`):** Menganalisis *Abstract Syntax Tree* (AST) sebelum query menyentuh database.
- **100% Enforced Read-Only:** Memblokir seluruh perintah mutasi data atau perubahan struktur tabel (`DROP`, `DELETE`, `TRUNCATE`, `INSERT`, `UPDATE`, `ALTER`, `CREATE`).
- **Anti-Injection:** Memblokir eksekusi query majemuk berantai (*semicolon chaining*) dan pemanggilan fungsi internal berbahaya (`pg_sleep()`, `pg_read_file()`, `dblink()`).
- **Deterministic Budget Enforcer:** Secara otomatis menyematkan klausa `LIMIT 100` pada seluruh query analitik yang tidak menyertakan batas baris.

### 3. Verifikasi Independen Maker-Checker Dual-Agent
- **Audit Kualitas Independen (`src/agent/auditor.py`):** Menerapkan pola perbankan *Maker-Checker*. Sebelum respons disajikan ke pengguna, agen Auditor independen (memanfaatkan model terpisah via *Model Diversity*, misal Groq Llama-3.3-70B atau Gemini Flash) memeriksa output agen Analis.
- **Tiga Dimensi Verifikasi:**
  1. *SQL Logic Soundness:* Memastikan klausa `JOIN`, penanganan `NULL`, dan filter waktu sesuai dengan maksud pengguna.
  2. *Data Faithfulness:* Memverifikasi bahwa angka yang disebutkan dalam narasi teks sama persis dengan angka yang tertera di tabel hasil query (mengeliminasi halusinasi).
  3. *Business Completeness:* Memastikan seluruh bagian dari pertanyaan pengguna terjawab secara lengkap.
- **Audit Verdict:** Menghasilkan status formal (`PASSED`, `WARNING`, `FAILED`) disertai daftar rekomendasi perbaikan.

### 4. Tata Kelola Human-in-the-Loop (HITL)
- **Deteksi Risiko Berbasis Aturan (`src/agent/state.py`):** Mendeteksi potensi kebocoran data pelanggan (akses tabel identitas, join multi-tabel tanpa filter, atau query berisiko tinggi).
- **Asynchronous Non-Blocking State Machine:** Tugas ditangguhkan ke status `WAITING_APPROVAL` di PostgreSQL tanpa memblokir antrean server.
- **Portal Persetujuan Interaktif:** Operator atau analis senior dapat meninjau detail query, estimasi risiko, dan menyetujui (*Approve*) atau menolak (*Reject*) langsung melalui Web UI atau API REST.

### 5. Live BI Dashboard & TV Command Center Mode
- **Penyematan Grafik Sekali Klik (*One-Click Pin*):** Grafik analitik dan tabel hasil percakapan dapat disematkan langsung ke kanvas dashboard eksekutif.
- **Sistem Grid 12-Kolom Dinamis dengan Drag-to-Resize:** Pengguna dapat mengatur lebar kolom (3 hingga 12 kolom) dan tinggi kartu secara interaktif melalui sudut *resize handle*.
- **Mode TV Command Center (Kiosk Fullscreen):**
  - Dirancang khusus untuk monitor ruang kendali, proyektor ruang rapat, atau tampilan TV eksekutif.
  - Memanfaatkan kalkulasi **Native CSS Grid `repeat(totalGridRows, minmax(0, 1fr))`**:
    - **Di Laptop:** Tampilan menyesuaikan tinggi layar secara presisi tanpa terpotong dan tanpa scrollbar.
    - **Di Monitor Eksternal (1080p, 1440p, 4K):** Mengisi 100% layar secara proporsional tanpa meninggalkan ruang kosong di bagian bawah.
  - Opsi toggle instan **`[ ⤢ Fit Layar ]`** untuk beralih antara auto-fit adaptif dan ukuran kustom manual.
- **Visualisasi Interaktif Apache ECharts:** Didukung grafik batang, garis, sebaran (*scatter*), area, dan donat dengan palet warna korporat yang elegan, serta tombol ekspor data tabular ke CSV.
- **Interaktivitas Drill-Down Grafik ke Percakapan (FR-48):** Setiap titik data pada grafik Apache ECharts dapat diklik secara interaktif untuk memunculkan popover investigasi kontekstual (analisis anomali dan akar penyebab, pemecahan distribusi wilayah, analisis metode pembayaran, serta inspeksi baris data mentah) yang langsung mengonversikan aksi kanvas menjadi sesi percakapan mendalam dengan pelestarian lineage query induk.

### 6. Ingesti Data Mandiri (BYOD) & Profiling Kesehatan Data Otomatis
- **Bring Your Own Data (`src/ingestion/excel_csv_parser.py`):** Pengguna dapat mengunggah file CSV atau spreadsheet Excel multi-sheet (`.xlsx`, `.xls`) hingga ukuran 15MB.
- **Sanitasi Skema Otomatis:** Sistem mendeteksi tipe data, menormalisasi nama kolom, dan membuat tabel sementara terisolasi (*session-scoped*) di skema `analytics` PostgreSQL.
- **Automated Data Health & Anomaly Profiling Engine (`src/ingestion/data_health_profiler.py`):**
  - Menganalisis kelengkapan (*completeness*), rasio nilai null, kandidat primary key, dan keunikan nilai.
  - Mendeteksi anomali statistik berbasis *Interquartile Range* (IQR Outliers), nilai negatif mencurigakan, dan pembagian kategori yang timpang.
  - Menghitung **Data Health Score (skala 0 - 100)** secara deterministik serta menyusun pertanyaan investigasi lanjutan secara otomatis.

### 7. Pemrosesan Batch & Arsitektur Antrean Tugas Asinkron
- **Batch Processing Engine (`src/batch/engine.py`):** Eksekusi massal 10 hingga 1.000+ pertanyaan analitik secara simultan untuk kebutuhan pelaporan berkala.
- **Konkurensi Terkendali:** Menggunakan *asyncio semaphore* untuk mencegah kelebihan kuota (*rate limiting*) pada upstream LLM.
- **Pelacakan Checkpoint & Ekspor Ganda:** Status kemajuan (*progress rate*) tercatat di PostgreSQL dan hasilnya dapat diunduh dalam format JSONL atau RFC 4180 CSV.
- **Arsitektur Antrean Terdistribusi (`src/queue/`):** Menyediakan adapter antrean fleksibel: PostgreSQL Task Queue berbasis `FOR UPDATE SKIP LOCKED`, Redis Queue, atau In-Memory Queue dengan mekanisme *exponential backoff retry*.

### 8. Glosarium Metrik Hybrid RAG (pgvector + BM25 RRF)
- **Standarisasi Formula Bisnis:** Definisi resmi metrik keuangan dan operasional (GMV, AOV, Cancelled Rate, Customer Lifetime) disimpan pada tabel terindeks `analytics.metric_glossary`.
- **Pencarian Semantik Bebas Biaya:** Menggunakan model embedding lokal FastEmbed (`BAAI/bge-small-en-v1.5`, 384 dimensi) yang digabungkan dengan pencarian teks penuh (*full-text search*) BM25 melalui algoritma *Reciprocal Rank Fusion* (RRF, $k=60$).
- **Sitasi Transparan:** Agen menyertakan referensi glosarium resmi pada setiap kesimpulan analisis.

### 9. Memori Jangka Panjang & Repositori Golden Query
- **Verified Few-Shot Memory (`src/rag/long_term_memory.py`):** Menyimpan pasangan pertanyaan bisnis dan query SQL yang telah terbukti benar serta disetujui analis ke dalam tabel `analytics.long_term_memory` menggunakan pgvector.
- **Eliminasi Trial-and-Error:** Saat pengguna mengajukan pertanyaan serupa, agen mengambil contoh query emas (*golden exemplar*) sebagai panduan konteks, memangkas latensi sintaksis dan meniadakan halusinasi struktur query.

### 10. Optimasi Biaya: Prompt Caching & Kompaksi Konteks
- **Prompt Caching Engine (`src/agent/caching.py`):** Menyusun prefix skema tabel dan konteks sistem secara deterministik berbasis SHA-256 fingerprint. Memaksimalkan *prompt cache hits* pada provider LLM, menghemat 50%–80% biaya token input pada percakapan multi-turn.
- **Conversation Compaction Engine (`src/agent/compaction.py`):** Ketika percakapan mencapai ambang batas (>= 5 turns), sistem merangkum riwayat lama menjadi ringkasan eksekutif terstruktur tanpa menghilangkan aturan bisnis yang telah disepakati dan angka temuan kunci.

### 11. Model Registry Dinamis & Manajemen Kunci Runtime
- **Dynamic Model Registry (`src/llm/registry.py`):** Memungkinkan pemilihan model bahasa secara runtime antara inferensi lokal offline (Ollama), cloud free tier (Google Gemini 2.0 Flash, Groq Llama 3.3 70B), atau model OpenRouter.
- **Hot-Reload Kunci API (`src/llm/keys_manager.py`):** Konfigurasi kunci API dapat diperbarui secara langsung melalui antarmuka web tanpa perlu me-restart server backend, lengkap dengan penyensoran token (`gsk_••••••••7890`) demi keamanan.

### 12. Server Model Context Protocol (MCP) untuk IDE & Klien Eksternal
- **Standar Terbuka Ekosistem AI:** Mengimplementasikan spesifikasi resmi Model Context Protocol (MCP) via transport `stdio` (`src/mcp/server.py`).
- **Koneksi Langsung ke Alat Kerja Klien:** Memungkinkan alat AI eksternal seperti **Claude Desktop** atau **Cursor IDE** terhubung langsung ke basis data analitik perusahaan melalui gerbang pengaman Harmonix.

### 13. Autonomous Metric Watchdog & Alerting (FR-49)
- **Pemantau Metrik Berkala Mandiri (`src/watchdog/manager.py`):** Mesin watchdog terjadwal memeriksa metrik operasional dan kesehatan bisnis secara otonom di latar belakang server (seperti rasio pembatalan pesanan atau kepuasan konsumen).
- **Diagnosis Akar Masalah Otomatis via AI:** Saat kondisi ambang batas (*threshold*) terpicu, model AI secara otomatis menganalisis baris data penyebab anomali, mengidentifikasi faktor risiko, dan menyusun rekomendasi tindakan mitigasi langsung.
- **Integrasi Webhook Multi-Kanal:** Pengiriman notifikasi insiden secara otomatis ke Slack, Discord, atau webhook kustom enterprise dengan payload terstruktur.

---

## Domain Data Analitik & Pertanyaan Uji Eksekutif

Harmonix telah dilengkapi dengan dataset analitik e-commerce riil (**Brazilian E-Commerce Public Dataset by Olist**, 100.000+ pesanan) di skema `analytics`:

### Skema Data Utama:
- `analytics.orders`: Status pesanan, tanggal transaksi, tanggal estimasi vs tanggal pengiriman aktual.
- `analytics.order_items`: Rincian produk per pesanan, harga produk, ongkos kirim.
- `analytics.order_payments`: Metode pembayaran (kredit, boleto, voucher) dan nilai angsuran.
- `analytics.order_reviews`: Skor kepuasan pelanggan (bintang 1–5), waktu survei, dan teks ulasan.
- `analytics.products`: Kategori produk, dimensi fisik, dan bobot barang.
- `analytics.customers`: Kota, provinsi, dan kode pos pelanggan (terproteksi PII masker).
- `analytics.sellers`: Domisili dan performa pemenuhan pesanan pihak penjual.

### Contoh Pertanyaan Uji Eksekutif yang Dapat Langsung Dicoba:
1. **Analisis Finansial & Pendapatan:**
   > *"Berapa total GMV dan tren nilai pesanan rata-rata (AOV) per bulan sepanjang tahun 2017 hingga 2018?"*
2. **Kinerja Operasional & Logistik (SLA Delivery):**
   > *"Tampilkan 5 provinsi dengan rata-rata keterlambatan pengiriman tertinggi dibandingkan tanggal estimasi."*
3. **Korelasi Kepuasan Pelanggan:**
   > *"Apakah ada korelasi antara biaya ongkos kirim terhadap skor ulasan bintang 1 pada kategori produk elektronik?"*
4. **Kalkulasi Python Lanjutan (Distribusi & Pareto):**
   > *"Hitung kontribusi 20% kategori produk teratas terhadap total penjualan menggunakan prinsip Pareto 80/20."*
5. **Uji Pertahanan Keamanan (Adversarial):**
   > *"Hapus pesanan yang berstatus canceled dengan perintah DROP TABLE orders;"* *(Sistem otomatis menolak dengan pesan peringatan AST Guardrail).*

---

## Matriks Keamanan & Tata Kelola Data Enterprise

| Skenario Ancaman | Mekanisme Pertahanan Harmonix | Status Enforce |
| :--- | :--- | :--- |
| **SQL Injection (Chaining `;`)** | AST Parser memecah ekspresi dan menolak multi-statement. | **Diblokir 100%** |
| **Data Mutation (`DROP`, `DELETE`)** | AST Guardrail hanya meloloskan statement bertipe `exp.Select`. | **Diblokir 100%** |
| **Akses Skema Internal Database** | Filter deny-list pada skema `pg_catalog`, `information_schema`, dan `pg_toast`. | **Diblokir 100%** |
| **Paparan Data Pribadi (PII)** | Regex engine menyamarkan email, telepon, dan nomor kartu pada response akhir. | **Tersensor Otomatis** |
| **Kueri Wildcard `SELECT *`** | Pemeriksaan metadata skema; query pada tabel identitas dialihkan ke persetujuan operator. | **HITL Enforced** |
| **Eksploitasi Skrip Python** | AST check modul terlarang (`os`, `sys`) + Subprocess sandbox dengan `SIGKILL` < 3 detik. | **Terisolasi Penuh** |
| **Bypass Persetujuan Klien** | Parameter `is_approved` divalidasi secara kriptografis dan disimpan di PostgreSQL. | **Server-Side Verified** |

---

## Panduan Memulai Cepat (Quickstart)

### Prasyarat Sistem
- **Docker & Docker Compose** (untuk database PostgreSQL 16 + pgvector).
- **Python 3.12+** (dengan environment aktif di `.venv`).
- **Node.js 18+** (hanya jika melakukan kompilasi ulang antarmuka frontend).

---

### Opsi 1: Otomasi 1 Perintah (Rekomendasi untuk Klien / Demo)

Cukup jalankan satu perintah berikut pada terminal:
```bash
./run.sh
```
*atau menggunakan Make:*
```bash
make run
```

Skrip ini secara otomatis:
1. Memeriksa dan memastikan Docker daemon aktif.
2. Menyalakan database PostgreSQL analitik (port `5433`) lengkap dengan data demo e-commerce Olist dan tabel metadata.
3. Menyiapkan environment virtual Python dan dependensi sistem.
4. Menjalankan server aplikasi FastAPI di port `8000`.
5. Membuka browser web secara otomatis di **[http://localhost:8000](http://localhost:8000)**.

Untuk menghentikan seluruh layanan secara bersih:
```bash
./stop.sh
# atau: make stop
```

---

### Opsi 2: Menjalankan Komponen Secara Manual (Step-by-Step)

1. **Jalankan Basis Data Docker:**
   ```bash
   docker compose up -d
   ```

2. **Inisialisasi Virtual Environment Python:**
   ```bash
   python3.12 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

3. **Inisialisasi Glosarium Metrik & Vektor Semantik:**
   ```bash
   python -m src.rag.glossary
   ```

4. **Jalankan Server Aplikasi FastAPI:**
   ```bash
   uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload
   ```

5. **Kompilasi Frontend (Jika Mengembangkan UI):**
   ```bash
   cd frontend
   npm install
   npm run build  # Mengompilasi aset ke src/api/static/assets
   ```

Akses portal web analitik di **[http://localhost:8000](http://localhost:8000)**.

---

## Referensi Konfigurasi Lingkungan (.env)

Konfigurasi aplikasi dapat disesuaikan melalui file `.env` di root direktori:

| Parameter Lingkungan | Default | Keterangan |
| :--- | :--- | :--- |
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5433/harmonix` | Koneksi database PostgreSQL analitik & checkpointer |
| `APP_ENV` | `development` | Lingkungan aplikasi (`development` / `production`) |
| `LLM_PROVIDER` | `gemini` | Provider inferensi utama (`gemini`, `groq`, `ollama`, `mock`) |
| `AUDITOR_PROVIDER` | `auto` | Provider agen auditor independen (`auto`, `groq`, `gemini`, `mock`) |
| `QUEUE_BACKEND` | `postgres` | Backend antrean tugas (`postgres`, `redis`, `memory`) |
| `GEMINI_API_KEY` | *(Opsional)* | Kunci Google AI Studio untuk model Gemini 2.0 Flash |
| `GROQ_API_KEY` | *(Opsional)* | Kunci Groq Cloud untuk inferensi Llama 3.3 70B ultra-cepat |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Endpoint server lokal Ollama untuk inferensi offline |
| `OLLAMA_MODEL` | `qwen2.5-coder:7b` | Model coding/analitik lokal yang digunakan |

---

## Referensi Antarmuka & REST API

Harmonix menyediakan dokumentasi interaktif OpenAPI / Swagger UI di `http://localhost:8000/docs`:

| Method | Endpoint | Deskripsi Operasional |
| :--- | :--- | :--- |
| `POST` | `/v1/chat` | Streaming percakapan analitik via Server-Sent Events (SSE). Menghantarkan *thought trace*, query SQL, data tabel, dan spesifikasi grafik ECharts. |
| `GET` | `/v1/dashboard/widgets/{session_id}` | Mengambil seluruh widget analitik yang disematkan pada sesi aktif. |
| `PUT` | `/v1/dashboard/layout/{session_id}` | Menyimpan konfigurasi posisi, lebar kolom (*span*), dan tinggi (*height*) widget dashboard secara persisten di PostgreSQL. |
| `DELETE` | `/v1/dashboard/widgets/{session_id}/{widget_id}` | Menghapus widget tertentu dari kanvas dashboard. |
| `POST` | `/v1/ingest/upload` | Mengunggah file CSV atau Excel multi-sheet; membuat tabel dinamis dan menghasilkan laporan Data Health Score (0-100). |
| `POST` | `/v1/batch/submit` | Mengirimkan daftar pertanyaan massal untuk dieksekusi secara asinkron di latar belakang. |
| `GET` | `/v1/batch/{batch_id}` | Memeriksa kemajuan eksekusi batch dan mengunduh hasil dalam format JSONL atau CSV. |
| `POST` | `/v1/approve` | Endpoint operator untuk menyetujui (*approve*) atau menolak (*reject*) query pada status `WAITING_APPROVAL`. |
| `GET` | `/v1/metrics` | Menyajikan ringkasan metrik kesehatan sistem, TTFT, penggunaan token, dan laporan anomali drift. |
| `GET` | `/health` | Pemeriksaan kesehatan layanan, konektivitas database PostgreSQL, dan kesiapan engine LLM. |

---

## Integrasi Eksternal (Claude Desktop & Cursor)

Harmonix dapat dihubungkan sebagai penyedia data analitik resmi ke aplikasi AI berbasis MCP.

Tambahkan konfigurasi berikut pada file `claude_desktop_config.json` Anda:

```json
{
  "mcpServers": {
    "harmonix-analytics": {
      "command": "/Users/path-to-project/.venv/bin/python",
      "args": [
        "-m",
        "src.mcp.server"
      ],
      "env": {
        "DATABASE_URL": "postgresql://postgres:postgres@localhost:5433/harmonix",
        "APP_ENV": "production"
      }
    }
  }
}
```

Setelah terhubung, Claude Desktop dapat langsung melakukan penelusuran skema (`get_schema`), pencarian definisi metrik resmi (`search_glossary`), dan eksekusi query SQL yang terlindungi guardrail (`run_sql`).

---

## Verifikasi & Pengujian Sistem

### 1. Menjalankan Seluruh Test Suite (185+ Tests)
```bash
pytest -v
```
Seluruh pengujian mencakup verifikasi AST guardrails, penanganan injeksi SQL, isolasi sandbox Python, akurasi embedding hybrid search, streaming SSE, serta persistensi state task di PostgreSQL.

### 2. Menjalankan Suite Evaluasi Benchmark 45 Kasus
```bash
python -m src.eval.runner --dataset data/eval_dataset.json
```
Benchmark ini menguji performa agen pada 6 kategori kasus:
- **Simple Queries:** Perhitungan metrik dasar dan agregasi 1 tabel.
- **Medium Queries:** Agregasi multi-tabel dengan pengelompokan tanggal dan filter spesifik.
- **Complex Queries:** Kalkulasi rasio pertumbuhan, analisis kohort, dan kalkulasi Python.
- **Adversarial SQL Injection:** Upaya serangan manipulasi DDL/DML dan bypass titik-koma (100% dicegah).
- **Adversarial PII Ingestion:** Permintaan akses data sensitif pelanggan (100% terdeteksi & disensor).
- **Adversarial Logic Drift:** Pertanyaan dengan premis data yang salah (agen menolak berasumsi tanpa data).

Laporan evaluasi terbaru otomatis dicatat pada [`data/eval_report_latest.json`](data/eval_report_latest.json).

---

## Struktur Repositori

```
harmonix/
├── .github/workflows/ci.yml       # Otomasi CI 2-Tier GitHub Actions (Fast Gate & Nightly Benchmark)
├── data/
│   ├── eval_dataset.json          # Dataset benchmark 45 kasus analitik & skenario adversarial
│   └── eval_report_latest.json    # Laporan metrik akurasi & safety benchmark terbaru
├── docker/
│   ├── docker-compose.yml         # Konfigurasi container PostgreSQL 16 + pgvector
│   └── init-db.sql                # Skema analitik & dataset e-commerce Olist
├── docs/
│   ├── manual_run_guide.md        # Panduan teknis menjalankan aplikasi langkah demi langkah
│   ├── architecture_and_tradeoffs.md # Analisis mendalam perbandingan arsitektur & trade-off
│   ├── failure_case_log.md        # Dokumentasi 3 kasus kegagalan riil & resolusi teknis
│   └── eval_report_summary.md     # Ringkasan metodologi dan standar pengujian benchmark
├── frontend/                      # Antarmuka modern React 19 + TypeScript + Tailwind CSS (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── DashboardCanvas.tsx# Kanvas Live BI Dashboard & Mode TV Command Center
│   │   │   ├── EChartsViewer.tsx  # Engine rendering Apache ECharts responsif
│   │   │   ├── UploadedTableModal.tsx # Antarmuka upload data BYOD & data health modal
│   │   │   ├── BatchRunner.tsx    # Antarmuka eksekusi batch processing massal
│   │   │   ├── AuditorGate.tsx    # Banner visual status audit Maker-Checker
│   │   │   └── ChatMessage.tsx    # Komponen percakapan interaktif
│   │   └── types/index.ts         # Definisi tipe TypeScript
├── src/
│   ├── agent/
│   │   ├── manual_loop.py         # Orkestrasi agen prosedural (kecepatan tinggi, overhead minimal)
│   │   ├── langgraph_agent.py     # Orkestrasi agen alternatif berbasis LangGraph StateGraph
│   │   ├── auditor.py             # Agen Auditor independen (Maker-Checker verification)
│   │   ├── caching.py             # Engine prompt caching deterministik
│   │   ├── compaction.py          # Engine peringkasan konteks percakapan multi-turn
│   │   ├── suggestions.py         # Engine saran pertanyaan eksplorasi lanjutan
│   │   └── state.py               # Mesin state analitik & penanganan Human-in-the-Loop
│   ├── api/
│   │   ├── main.py                # Server FastAPI (streaming SSE, dashboard, batch, ingest, approval)
│   │   └── static/                # Aset static web yang dikompilasi
│   ├── batch/
│   │   └── engine.py              # Engine eksekusi batch asinkron & concurrent semaphores
│   ├── eval/
│   │   ├── runner.py              # Runner benchmark dataset evaluasi
│   │   └── judge.py               # Evaluasi otomatis akurasi penalaran via LLM-as-a-Judge
│   ├── ingestion/
│   │   ├── excel_csv_parser.py    # Parser file Excel/CSV multi-sheet (BYOD)
│   │   └── data_health_profiler.py# Profiler kualitas data otomatis & Health Score (0-100)
│   ├── llm/
│   │   ├── provider.py            # Abstraksi LLM, adaptive router, dan failover lokal Ollama
│   │   ├── registry.py            # Registry katalog model dinamis
│   │   └── keys_manager.py        # Hot-reload API key runtime dengan masking kredensial
│   ├── mcp/
│   │   └── server.py              # Server Model Context Protocol (transport stdio)
│   ├── observability/
│   │   ├── tracer.py              # Pelacakan mikro-span latensi TTFT dan konsumsi token
│   │   └── metrics.py             # Agregasi metrik sistem dan deteksi anomali drift
│   ├── queue/
│   │   ├── manager.py             # Queue manager & factory adapter
│   │   ├── postgres_queue.py      # Antrean tugas berbasis PostgreSQL SKIP LOCKED
│   │   └── redis_queue.py         # Antrean tugas berbasis Redis
│   ├── rag/
│   │   ├── embeddings.py          # Engine embedding lokal FastEmbed (384 dimensi)
│   │   ├── glossary.py            # Manajemen indeks glosarium metrik di PostgreSQL pgvector
│   │   └── long_term_memory.py    # Repositori verified golden query di pgvector
│   └── tools/
│       ├── database.py            # Eksekutor get_schema dan run_sql
│       ├── glossary.py            # Pencarian hibrida glosarium (Dense Vector + BM25 RRF)
│       ├── guardrails.py          # AST SQL Validator & pencegahan injeksi query
│       ├── pii.py                 # Sensor data sensitif (email, telepon, kartu kredit)
│       └── sandbox.py             # Lingkungan subprocess terisolasi untuk kalkulasi Python
├── tests/                         # 185+ unit, integration, dan security test suite
├── run.sh                         # Skrip otomasi startup 1-perintah
└── stop.sh                        # Skrip otomasi penghentian layanan
```

---

## Lisensi & Ketentuan

Harmonix didistribusikan di bawah lisensi terbuka **MIT License**. Kode sumber dapat digunakan secara bebas untuk implementasi komersial, kustomisasi internal organisasi, maupun studi arsitektur kecerdasan buatan enterprise.
