# Harnessly: Production-Grade AI Data Analyst Agent

[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cost: Zero-Cost](https://img.shields.io/badge/Cost-$0.00%20(Free)-brightgreen.svg)](#zero-cost-stack)

Proyek portofolio **AI Agent Engineer (Python Backend)**: text-to-SQL agent tangguh berbasis PostgreSQL dengan harness produksi lengkap:
- 🛡️ **SQL AST Guardrails (`sqlglot`)**: Menjamin hanya query `SELECT` yang dieksekusi, memblokir multi-statement injection, memblokir fungsi berbahaya (`pg_sleep`, `pg_read_file`), dan memaksa batas baris (`LIMIT`).
- 🛑 **Human-in-the-Loop Approval Gate**: Mendeteksi query berisiko (akses kolom PII sensitif seperti `email`/`phone_number` atau unbounded multi-table query) dan menahan eksekusi sampai mendapat persetujuan analis.
- ⚡ **Manual Agent Loop**: Dibangun tanpa framework abstrak (`Plan` -> `Tool Call` -> `Observe` -> `Output`), dilengkapi batas langkah, token budget, dan timeout.
- 🌊 **Real-Time SSE Streaming**: Mengirimkan token jawaban dan status eksekusi secara streaming ke UI.
- 💰 **Zero-Cost First Architecture**: 100% gratis menggunakan model lokal offline (**Ollama**) atau cloud free-tier (**Google AI Studio Gemini** / **Groq**).

---

## 🏗️ Arsitektur Sistem

```
[ User / Web UI ]
       │  (SSE Streaming / REST)
       ▼
[ FastAPI App (src/api/main.py) ]
       │
[ Manual Agent Loop (src/agent/manual_loop.py) ]
  ├── Step & Timeout Limiter (FR-02)
  ├── Token Budget Tracker (FR-29)
  │
  ├──► [ Unified LLM Provider (src/llm/provider.py) ]
  │      ├── Option A: Ollama (Offline: qwen2.5-coder:7b / llama3.1:8b)
  │      ├── Option B: Google Gemini 2.0 Flash (Cloud Free Tier)
  │      ├── Option C: Groq Llama 3.3 70B (Cloud Free Tier)
  │      └── Option D: Mock Provider (Testing / CI)
  │
  └──► [ Tools & Safety Guardrails ]
         ├── get_schema (src/tools/database.py)
         └── run_sql (src/tools/database.py)
               └── SQLGuardrail AST Validator (src/tools/guardrails.py)
                     └── [ PostgreSQL 16 + pgvector (Docker) ]
```

---

## 🚀 Panduan Memulai Cepat

### 1. Prasyarat
- Python 3.11+
- Docker & Docker Compose

### 2. Setup Virtual Environment
```bash
# Buat virtual environment dan aktifkan
python3 -m venv .venv
source .venv/bin/activate

# Install dependensi
pip install -r requirements.txt
```

### 3. Jalankan Database (Docker)
Jalankan kontainer PostgreSQL 16 + pgvector beserta data demo analitik:
```bash
docker compose up -d
```
*Database akan otomatis terinisialisasi dengan skema `analytics` dan sampel data e-commerce di `docker/init-db.sql`.*

### 4. Konfigurasi Environment (`.env`)
Salin file konfigurasi:
```bash
cp .env.example .env
```
Pilih provider di `.env`:
* **Mode Pengujian Offline (Default)**: `LLM_PROVIDER=mock`
* **Mode Ollama (Lokal di Mac)**: `LLM_PROVIDER=ollama`
* **Mode Google Gemini (Gratis)**: `LLM_PROVIDER=gemini` dan isi `GEMINI_API_KEY=...`
* **Mode Groq (Gratis)**: `LLM_PROVIDER=groq` dan isi `GROQ_API_KEY=...`

### 5. Jalankan Aplikasi
```bash
uvicorn src.api.main:app --reload --port 8000
```
Buka browser Anda di: **[http://localhost:8000](http://localhost:8000)** untuk berinteraksi langsung melalui Web Chat UI!

---

## 🧪 Menjalankan Pengujian (Testing)

Proyek ini dilengkapi dengan cakupan tes unit komprehensif untuk guardrail AST, agent loop, dan endpoint API:
```bash
pytest -v
```

Semua 21 pengujian mencakup:
1. Validasi query `SELECT` dan injeksi otomatis klausul `LIMIT`.
2. Pemblokiran operasi `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`.
3. Pemblokiran serangan injeksi multi-statement (semicolon chaining).
4. Pemblokiran fungsi berbahaya (`pg_sleep`, `pg_read_file`).
5. Deteksi akses kolom sensitif PII (`email`, `phone_number`) untuk approval gate.
6. Penanganan batas langkah dan batas anggaran token pada agent loop.
7. Streaming Server-Sent Events (SSE) pada endpoint `/v1/chat`.

---

## 📁 Struktur Repositori

```
harnessly/
├── PRD.md                     # Dokumen Persyaratan Produk (Versi 1.1 Zero-Cost Baseline)
├── README.md                  # Dokumentasi teknis proyek
├── docker-compose.yml         # PostgreSQL 16 + pgvector container
├── docker/
│   └── init-db.sql            # Skema e-commerce & seeding data demo
├── requirements.txt           # Dependensi Python
├── pyproject.toml             # Konfigurasi package & pytest
├── .env.example               # Contoh konfigurasi lingkungan
├── src/
│   ├── config.py              # Pydantic Settings
│   ├── db/
│   │   └── connection.py      # Async SQLAlchemy connection engine & healthcheck
│   ├── tools/
│   │   ├── base.py            # BaseTool abstraction & OpenAI schema converter
│   │   ├── guardrails.py      # AST SQL validator & risk assessment (sqlglot)
│   │   └── database.py        # get_schema & run_sql tools
│   ├── llm/
│   │   └── provider.py        # Unified Mock, Ollama, Gemini, Groq abstraction
│   ├── agent/
│   │   ├── models.py          # Structured output models & task states
│   │   └── manual_loop.py     # Framework-less agent loop
│   └── api/
│       └── main.py            # FastAPI app + SSE streaming + Web Chat UI
└── tests/
    ├── test_guardrails.py     # AST SQL guardrail tests
    ├── test_agent_loop.py     # Manual agent loop & safety limit tests
    └── test_api.py            # API endpoint integration tests
```
