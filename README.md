# Harmonix: Production-Grade AI Data Analyst Agent

[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20%2B%20pgvector-336791.svg)](https://www.postgresql.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-0.2.0+-purple.svg)](https://github.com/langchain-ai/langgraph)
[![MCP](https://img.shields.io/badge/MCP-Standard%20Server-orange.svg)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/Tests-185+%20Collected-brightgreen.svg)](#-menjalankan-pengujian-testing)
[![Safety Rate](https://img.shields.io/badge/Safety%20Rate-100%25-success.svg)](#-evaluasi-benchmark--observabilitas)
[![Cost](https://img.shields.io/badge/Cost-%240.00%20(Zero--Cost)-brightgreen.svg)](#-zero-cost-stack-architecture)

> **Harmonix** adalah proyek referensi produksi untuk posisi **AI Agent Engineer / Senior AI Backend Developer**. Mengubah bahasa alami menjadi query analitik PostgreSQL (*Text-to-SQL*) dengan sabuk pengaman (*agent harness*) produksi lengkap: AST guardrails, human-in-the-loop approval gate, local RAG metric glossary, state persistence di PostgreSQL, observabilitas granular, suite evaluasi benchmark, perbandingan LangGraph, dan Model Context Protocol (MCP) server.

---

## 🌟 Mengapa Membutuhkan "Agent Harness"?

Menyuruh LLM langsung mengeksekusi SQL mentah ke database analitik tanpa pengaman adalah bencana di lingkungan enterprise:
* ❌ **Halusinasi Nama Kolom:** LLM menebak struktur tabel yang tidak ada (*schema drift*).
* ❌ **Risiko Keamanan Fatal:** Potensi serangan injeksi SQL atau perintah merusak (`DROP TABLE`, `DELETE`).
* ❌ **Beban Biaya Komputasi:** Query *unbounded full-table scan* tanpa batas baris dapat merontokkan database.
* ❌ **Kebocoran Data Pribadi:** Data sensitif pelanggan (email, nomor telepon) terekspos tanpa sensor.

**Harmonix memecahkan seluruh risiko di atas** dengan membangun 5 lapisan perlindungan harness di sekeliling model bahasa:

```mermaid
flowchart TD
    User([Pengguna / Web UI]) --> API[FastAPI Server: /v1/chat & /v1/metrics]
    
    subgraph Harness["Harmonix Production Agent Harness"]
        direction TB
        
        subgraph Layer1["1. Context & Grounding"]
            Glossary[Local RAG Glosarium Metrik: FastEmbed + pgvector]
            JITSchema[Just-In-Time Schema Discovery: get_schema]
        end
        
        subgraph Layer2["2. Orchestration Layer"]
            ManualLoop[Manual Agent Loop: Procedural while-loop]
            LangGraphAgent[LangGraph StateGraph: Framework Comparison]
        end
        
        subgraph Layer3["3. Guardrails & Security"]
            ASTGuard[AST SQL Validator: sqlglot read-only SELECT]
            ApprovalGate[Human-in-the-Loop Gate: WAITING_APPROVAL]
            PIIMask[PII Masker: Email, Phone, Free-text]
            Sandbox[Subprocess Python Sandbox: OS-level SIGKILL]
        end
        
        subgraph Layer4["4. Memory & Durability"]
            ShortTerm[Short-Term Memory: 5-Turn Window]
            CheckpointDB[(PostgreSQL: task_checkpoints & agent_tasks)]
        end
        
        subgraph Layer5["5. Observability & Tracing"]
            Tracer[Agent Tracer: TTFT, Span Latency, Token Breakdown]
            MetricsDash[Live Metrics Dashboard: Drift Alerts]
        end
    end
    
    subgraph ZeroCost["Zero-Cost Inference & Tooling"]
        Router[Fallback & Routed LLM Provider]
        Ollama[Ollama Local Offline: qwen2.5-coder:7b]
        Gemini[Google Gemini 2.0 Flash: Cloud Free Tier]
        Groq[Groq Llama 3.3 70B: Cloud Free Tier]
        MCPServer[MCP Database Server: stdio / sse]
    end

    API --> Layer2
    Layer2 <--> Layer1
    Layer2 <--> Layer3
    Layer2 <--> Layer4
    Layer2 <--> Layer5
    Layer2 <--> Router
    Router --> Gemini & Groq & Ollama
    Layer3 --> Database[(PostgreSQL 16 Analitik: Olist E-Commerce)]
```

---

## 🚀 Fitur Unggulan Sistem

### 1. AST SQL Guardrails & Sanitizer (`src/tools/guardrails.py`)
* Dibangun menggunakan **`sqlglot`** untuk membedah *Abstract Syntax Tree* (AST) query PostgreSQL.
* **100% Read-Only:** Memblokir seluruh perintah mutasi data atau DDL (`DROP`, `DELETE`, `TRUNCATE`, `INSERT`, `UPDATE`, `ALTER`).
* **Anti-Injection:** Memblokir serangan *multi-statement chaining* (titik-koma `;`) dan pemanggilan fungsi berbahaya (`pg_sleep()`, `pg_read_file()`, `dblink()`).
* **Row-Limit Enforcer:** Secara deterministik menyisipkan klausul `LIMIT 100` pada semua query SELECT yang tidak memiliki batasan.

### 2. Human-in-the-Loop Approval Gate (`src/agent/state.py` & Web UI)
* Mendeteksi query berisiko tinggi (akses data PII sensitif atau multi-table join tanpa filter `WHERE`).
* Menahan eksekusi dan mengubah state task menjadi **`WAITING_APPROVAL`** tanpa memblokir thread server (*non-blocking asynchronous state machine*).
* Menyajikan dialog persetujuan interaktif di Web UI yang memungkinkan analis data menyetujui (*Approve*) atau menolak (*Reject*).

### 3. Local RAG Glosarium Metrik (`src/rag/` & `src/tools/glossary.py`)
* Indeks definisi bisnis resmi perusahaan (GMV, AOV, Delivered Rate, Pelanggan Aktif) di PostgreSQL `analytics.metric_glossary`.
* **Zero API Cost Hybrid Search:** Menggabungkan dense vector FastEmbed lokal (`BAAI/bge-small-en-v1.5`, 384 dimensi) dan full-text search BM25 menggunakan *Reciprocal Rank Fusion* (RRF, $k=60$).
* Menyertakan sitasi transparan pada jawaban akhir (*traceable citations*).

### 4. Sandbox Kalkulasi Python Terisolasi (`src/tools/sandbox.py`)
* Eksekusi kode Python untuk analisis lanjutan (rasio, pertumbuhan persentase, statistik) yang sulit dilakukan di SQL murni.
* **Pencegahan Eksploitasi Ganda:** Validasi AST untuk memblokir modul terlarang (`os`, `sys`, `socket`) dan eksekusi di subprocess OS terpisah dengan penghentian paksa instan via kernel `SIGKILL` (< 3 detik).

### 5. Penyensoran Data Pribadi / PII Masking (`src/tools/pii.py`)
* Mesin regex dan dictionary scanner otomatis untuk menyamarkan data sensitif pelanggan:
  - Email: `john.doe@example.com` $\rightarrow$ `j***@example.com`
  - Nomor Telepon Indonesia: `+6281234567890` $\rightarrow$ `+62812****7890`
  - Nomor Kartu Kredit: `****-****-****-****`

### 6. Observabilitas Granular & Tracing (`src/observability/`)
* Pencatatan span mikro untuk setiap fase (*LLM generation*, *tool execution*, *guardrail evaluation*, *checkpointing*).
* Melacak **Time-To-First-Token (TTFT)**, rincian token (prompt vs completion), dan latensi end-to-end.
* Deteksi anomali (*drift alerts*) otomatis untuk kegagalan tool atau lonjakan latensi.
* Sinkronisasi opsional non-blocking ke dashboard Langfuse.

### 7. Evaluasi Benchmark 45 Kasus & CI/CD Gate (`src/eval/` & `.github/workflows/ci.yml`)
* Suite pengujian komprehensif 45 kasus uji (Simple, Medium, Complex, Adversarial Injection, Adversarial PII, Adversarial Logic).
* **LLM-as-a-Judge (`src/eval/judge.py`)** mengukur Faithfulness, Clarity, dan Grounding.
* Otomasi 2-Tier GitHub Actions CI: PR Fast Gate & Nightly Benchmark Gate.

### 8. Perbandingan Framework: Manual Loop vs LangGraph (`src/agent/langgraph_agent.py`)
* Menyediakan dua implementasi setara untuk perbandingan trade-off performa:
  - **Manual Loop:** Latensi super cepat (< 1ms overhead), jejak memori minimal, zero framework lock-in.
  - **LangGraph StateGraph:** Standar industri graf, siklus visual, dan kesiapan multi-agent.

### 9. Model Context Protocol (MCP) Server Database (`src/mcp/server.py`)
* Server MCP resmi berbasis transport `stdio` yang mengekspos alat-alat database yang telah dijaga guardrail ke klien eksternal seperti **Claude Desktop** atau **Cursor**.

### 10. Model Routing & Automatic Fallback Resilience (`src/llm/provider.py`)
* Menggunakan Cloud Free Tier (Google Gemini 2.0 Flash / Groq Llama 3.3 70B) sebagai inferensi utama.
* Jika terkena batas kuota (*HTTP 429 Rate Limit*), sistem secara otomatis melakukan retry dengan *exponential backoff* dan beralih (*graceful fallback*) ke model offline lokal **Ollama** (`qwen2.5-coder:7b`) tanpa memutus percakapan pengguna.

---

## ⚡ Zero-Cost Stack Architecture

Harmonix beroperasi **100% Gratis (USD 0,00)** tanpa biaya kartu kredit:
- **Language & API:** Python 3.12, FastAPI (async), Pydantic v2.
- **Database & Vektor:** PostgreSQL 16 + pgvector (via Docker Compose lokal port `5433`).
- **AST Parsing:** `sqlglot`.
- **Embeddings Lokal:** FastEmbed ONNX runtime (`BAAI/bge-small-en-v1.5`, 384 dim).
- **Inference LLM:** Ollama lokal (`qwen2.5-coder:7b`) / Google AI Studio Gemini Free Tier / Groq Free Tier.
- **CI/CD:** GitHub Actions (2.000 menit gratis/bulan).

---

## 🚀 Panduan Memulai Cepat (Quickstart)

### ⚡ Jalankan Semua Layanan dengan 1 Perintah (Rekomendasi)
Cukup jalankan satu perintah berikut di terminal:
```bash
./run.sh
```
*atau jika menggunakan make:*
```bash
make run
```
Skrip otomatis memeriksa & membuka Docker Desktop jika belum aktif, menjalankan database PostgreSQL di port `5433`, mengaktifkan virtual environment, menjalankan 9Router (jika tersedia), menyalakan server FastAPI di port `8000`, dan membuka peramban di `http://localhost:8000`.

Untuk menghentikan seluruh layanan:
```bash
./stop.sh  # atau: make stop
```

---

### 🛠 Menjalankan Secara Manual (Step-by-Step)
Buka browser Anda di **[http://localhost:8000](http://localhost:8000)** untuk berinteraksi langsung melalui Web Chat UI & Live Metrics Dashboard!

> **Pengembangan Frontend (Opsional):**
> Frontend dibangun menggunakan **React 19 + TypeScript + Tailwind CSS (Vite)** di direktori `frontend/`.
> ```bash
> # Menjalankan Vite dev server dengan HMR (Hot Module Replacement):
> cd frontend && npm run dev
> 
> # Melakukan build otomatis ke static asset FastAPI:
> cd frontend && npm run build
> ```

---

## 🧪 Menjalankan Pengujian (Testing)

Jalankan seluruh **185+ unit dan integration test** di repositori:
```bash
pytest -v
```

Jalankan evaluasi benchmark otomatis pada dataset 45 kasus:
```bash
python -m src.eval.runner --dataset data/eval_dataset.json
```
Laporan evaluasi terbaru otomatis diperbarui di [`data/eval_report_latest.json`](file:///Users/timurdianradhasejati/Programming/Code/AI/Harmonix/data/eval_report_latest.json).

---

## 🔒 Security Model & Known Limitations

### Security Model (P0 Hardened)
1. **AST SQL Guardrail (Defense-in-Depth):**
   - **Strict Allowlist:** Hanya fungsi analitik aman (agregat, string, tanggal, matematika, window functions) yang diizinkan. Fungsi berbahaya (`pg_*`, `lo_*`, `query_to_*`, `dblink`, `set_config`) diblokir otomatis.
   - **System Catalog Shield:** Akses ke skema sistem (`pg_catalog`, `information_schema`, `pg_toast`) dan tabel internal (`pg_shadow`, `pg_user`, dll.) ditolak secara deterministik.
   - **Wildcard PII Expansion:** Query `SELECT *` diekspansi terhadap skema tabel. Jika tabel memuat data sensitif (`customers` dengan kolom `email`, `phone_number`), sistem otomatis menandainya sebagai risiko PII dan mengaktifkan Approval Gate.
   - **Read-Only Enforced:** Menolak keras mutasi DDL/DML, klausa `INTO`, dan row-level locking (`FOR UPDATE`, `FOR SHARE`).
2. **Server-Side Human-in-the-Loop (HITL) Gate:**
   - Parameter `is_approved` dihilangkan dari skema publik Tool MCP untuk mencegah bypass dari klien/LLM.
   - Izin dievaluasi secara idempotent di server backend dengan verifikasi status persetujuan dan pencatatan audit (`approved_by`, `processed_at`).
   - Penolakan oleh operator (`rejected`) menyetel status final task ke `REJECTED` dan menghentikan eksekusi secara aman.
3. **API & Configuration Protection:**
   - CORS dibatasi menggunakan allowlist tanpa wildcard kredensial.
   - Endpoint `POST /v1/models/keys` dinonaktifkan secara otomatis pada lingkungan produksi (`APP_ENV=production`) dan hanya menerima format key yang valid. Response API tidak pernah mengembalikan nilai key mentah.

### Known Limitations
1. **Cakupan Analitik Murni (Read-Only):** Agent secara sengaja tidak mendukung modifikasi data atau migrasi DDL untuk menjamin keamanan database analitik enterprise.
2. **Dependensi Embedding Lokal:** FastEmbed membutuhkan model ONNX lokal (`bge-small-en-v1.5`) yang berjalan di mesin host untuk semantic hybrid search.
3. **Zero-Cost CI Baseline:** Pipeline CI utama menggunakan provider `mock` untuk menguji integritas alur logika tanpa biaya runtime API eksternal. Evaluasi model komersial nyata dianjurkan dijalankan via cron nightly atau runner lokal terjadwal.

---

## 📁 Struktur Repositori

```
Harmonix/
├── .github/workflows/ci.yml       # 2-Tier GitHub Actions CI workflow
├── data/
│   ├── eval_dataset.json          # Benchmark dataset 45 kasus analitik & adversarial
│   └── eval_report_latest.json    # Laporan metrik evaluasi terbaru (45 kasus)
├── docker/
│   └── init-db.sql                # Skema analitik & data demo e-commerce Olist
├── docs/
│   ├── architecture_and_tradeoffs.md  # Analisis mendalam trade-off arsitektur (PRD Bagian 10)
│   ├── failure_case_log.md            # Dokumentasi 3 kasus kegagalan nyata & perbaikannya
│   ├── eval_report_summary.md         # Ringkasan metodologi & metrik benchmark evaluasi
│   └── demo_script.md                 # Naskah video demo teknis 3-5 menit
├── frontend/                      # Modern React 19 + TypeScript + Tailwind CSS UI (Vite)
├── src/
│   ├── agent/
│   │   ├── manual_loop.py         # Agent loop manual (procedural while-loop)
│   │   ├── langgraph_agent.py     # Agent pembanding berbasis LangGraph StateGraph
│   │   ├── models.py              # Schema output Pydantic terstruktur
│   │   └── state.py               # State machine persistence di PostgreSQL
│   ├── api/
│   │   ├── main.py                # FastAPI server (SSE streaming, approval, metrics)
│   │   └── static/index.html      # Tailwind Web Chat UI & Live Metrics Dashboard
│   ├── eval/
│   │   ├── runner.py              # Engine benchmark evaluasi
│   │   └── judge.py               # LLM-as-a-Judge evaluasi akurasi & penalaran
│   ├── llm/
│   │   └── provider.py            # Abstraksi LLM, Fallback resilient, & Router
│   ├── mcp/
│   │   └── server.py              # Custom MCP Database Server (stdio transport)
│   ├── observability/
│   │   ├── tracer.py              # Granular AgentTracer & TTFT tracker
│   │   └── metrics.py             # Agregasi metrik sistem & drift alerts
│   ├── rag/
│   │   ├── embeddings.py          # Local FastEmbed engine (384 dim)
│   │   └── glossary.py            # Glosarium metrik di pgvector
│   └── tools/
│   │   ├── database.py            # Tools get_schema & run_sql
│   │   ├── glossary.py            # Tool search_glossary (Hybrid search RRF)
│   │   ├── guardrails.py          # AST SQL Validator & Risk Assessment
│   │   ├── pii.py                 # PII Masker engine
│   │   └── sandbox.py             # Subprocess Python calculation sandbox
└── tests/                         # 185+ unit & integration tests
```

---

## 📚 Dokumen Pendukung Portofolio

Sesuai persyaratan portofolio Bagian 10 PRD:
1. **[Analisis Trade-Off Arsitektur](docs/architecture_and_tradeoffs.md)**: Perbandingan Manual Loop vs LangGraph vs Claude Agent SDK, Single vs Multi-Agent, Cost vs Latency vs Akurasi, dan mengapa fine-tuning tidak diperlukan.
2. **[Failure Case Log](docs/failure_case_log.md)**: Analisis 3 kegagalan nyata (SQLAlchemy binding, infinite loop sandbox GIL, halusinasi skema) dan solusinya.
3. **[Laporan Evaluasi](docs/eval_report_summary.md)**: Metrik akurasi, safety rate, breakdown 6 kategori, dan release gate.
4. **[Naskah Video Demo](docs/demo_script.md)**: Panduan presentasi portofolio menit-demi-menit.

---

## 📄 Lisensi

Didistribusikan di bawah Lisensi **MIT**. Bebas digunakan untuk referensi belajar, portofolio, dan implementasi produksi.
