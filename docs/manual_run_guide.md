# Panduan Menjalankan Harmonix Secara Manual (Manual Run Guide)

Dokumen ini memandu langkah demi langkah (*step-by-step*) cara menyiapkan dependensi, mengonfigurasi variabel lingkungan, menjalankan database, menyalakan server backend FastAPI, serta mengakses antarmuka frontend secara manual tanpa bergantung pada skrip otomatis `run.sh`.

---

## 📋 1. Prasyarat Sistem (Prerequisites)

Pastikan lingkungan lokal Anda telah terpasang:
* **Python**: Versi `3.11` ke atas (direkomendasikan Python 3.12 atau 3.13).
* **Docker Desktop / Docker Engine**: Untuk menjalankan PostgreSQL 16 dengan ekstensi `pgvector`.
* **Node.js & npm** (opsional): Versi `18+` (hanya jika ingin memodifikasi atau menjalankan dev server frontend Vite secara independen).
* **Git**: Untuk manajemen repositori kode.

---

## ⚙️ 2. Langkah 1: Konfigurasi Environment (`.env`)

Harmonix membaca konfigurasi dari berkas `.env` di *root* direktori.

1. Salin template `.env.example` menjadi `.env`:
   ```bash
   cp .env.example .env
   ```

2. Buka berkas `.env` dan periksa parameter penting:
   ```env
   # Mode Aplikasi
   APP_ENV=development
   APP_HOST=0.0.0.0
   APP_PORT=8000
   LOG_LEVEL=INFO

   # Database (PostgreSQL 16 + pgvector)
   DB_HOST=127.0.0.1
   DB_PORT=5433
   DB_USER=harmonix_user
   DB_PASSWORD=harmonix_pass
   DB_NAME=harmonix_db
   DB_SCHEMA=analytics
   DATABASE_URL=postgresql+asyncpg://harmonix_user:harmonix_pass@127.0.0.1:5433/harmonix_db

   # Pilihan Provider LLM: "ollama", "gemini", "groq", "openrouter", "mock"
   LLM_PROVIDER=ollama

   # Jika menggunakan Google Gemini (Free Tier)
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-2.0-flash

   # Jika menggunakan Groq Cloud (Free Tier)
   GROQ_API_KEY=gsk_your_groq_api_key_here
   GROQ_MODEL=llama-3.3-70b-versatile

   # Jika menggunakan Ollama (100% Offline Lokal)
   OLLAMA_BASE_URL=http://localhost:11434/v1
   OLLAMA_MODEL=qwen2.5-coder:7b
   ```

> [!TIP]
> Jika Anda belum memiliki API key cloud dan belum memasang Ollama, Anda dapat menyetel `LLM_PROVIDER=mock` untuk menjalankan seluruh alur sistem, testing, dan benchmark evaluasi secara 100% lokal dan offline tanpa biaya.

---

## 🐘 3. Langkah 2: Menjalankan Database PostgreSQL + pgvector

Harmonix memerlukan PostgreSQL 16 dengan ekstensi `pgvector` dan skema analitik awal (`docker/init-db.sql`).

1. **Nyalakan container PostgreSQL via Docker Compose:**
   ```bash
   docker compose up -d postgres
   ```

2. **Periksa status container:**
   ```bash
   docker compose ps
   ```
   Pastikan container `harmonix_postgres` berstatus `Up` atau `healthy`.

3. **Verifikasi kesiapan koneksi database:**
   ```bash
   docker compose exec postgres pg_isready -U harmonix_user -d harmonix_db
   ```
   *Output yang diharapkan:* `harmonix_db:5432 - accepting connections`.

> [!NOTE]
> Database berjalan di port host **`5433`** (bukan port default `5432`) untuk mencegah konflik dengan instalasi PostgreSQL lokal yang sudah ada di komputer Anda.

---

## 🐍 4. Langkah 3: Setup Virtual Environment Python

1. **Buat virtual environment (jika belum ada):**
   ```bash
   python3 -m venv .venv
   ```

2. **Aktifkan virtual environment:**
   - **macOS / Linux:**
     ```bash
     source .venv/bin/activate
     ```
   - **Windows (PowerShell):**
     ```powershell
     .\.venv\Scripts\Activate.ps1
     ```

3. **Perbarui pip dan instal dependensi Harmonix:**
   ```bash
   pip install --upgrade pip
   pip install -e ".[dev]"
   ```

---

## 🚀 5. Langkah 4: Menjalankan Server Backend FastAPI

Setelah database aktif dan dependensi terpasang, jalankan server API Harmonix menggunakan Uvicorn:

```bash
uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload
```

* Layanan API aktif di: **`http://localhost:8000`**
* Dokumentasi Interaktif Swagger UI: **`http://localhost:8000/docs`**
* Health Check Endpoint: **`http://localhost:8000/health`**

Periksa apakah API dan database telah terhubung dengan membuka terminal baru:
```bash
curl http://localhost:8000/health
```
*Respons JSON yang diharapkan:*
```json
{
  "status": "healthy",
  "llm_provider": "...",
  "database_connected": true,
  "app_env": "development"
}
```

---

## 🖥️ 6. Langkah 5: Mengakses & Menjalankan Frontend Web UI

Harmonix menyediakan antarmuka web modern bergaya Claude AI dengan Live Streaming SSE, kanvas BI Dashboard, visualisasi Chart.js, dan Human-in-the-Loop modal.

### Opsi A: Menggunakan Antarmuka Web Bawaan (Direkomendasikan)
FastAPI telah mengintegrasikan bundel frontend produksi di `src/api/static`. Anda cukup membuka peramban:
👉 **`http://localhost:8000`**

Jika Anda melakukan perubahan kode pada folder `frontend/` dan ingin mem-build ulang aset statis untuk FastAPI:
```bash
cd frontend
npm install
npm run build
cd ..
```
Hasil kompilasi otomatis disimpan ke `src/api/static/` dan langsung disajikan oleh server FastAPI.

---

### Opsi B: Menjalankan Frontend Dev Server Vite (Hot Reload)
Jika Anda sedang aktif mengembangkan komponen UI:
1. Masuk ke folder frontend:
   ```bash
   cd frontend
   npm install
   ```
2. Jalankan dev server Vite:
   ```bash
   npm run dev
   ```
3. Buka peramban di: **`http://localhost:5173`**
   *(Vite secara otomatis meneruskan permintaan `/v1`, `/health`, dan `/static` ke server FastAPI di `http://127.0.0.1:8000`)*.

---

## 📊 7. Langkah 6 (Opsional): Seeding Data Demo Eksekutif

Jika Anda ingin langsung mencoba kanvas Live BI Dashboard yang sudah terisi widget (Line chart tren omzet bulanan, Doughnut status pengiriman, Bar kategori produk terlaris, dan tabel audit):

Jalankan skrip seed demo:
```bash
python scripts/seed_demo_story.py
```
Setelah skrip selesai, buka tab **Dashboard** di Web UI untuk melihat widget real-time.

---

## 🧪 8. Langkah 7: Menjalankan Test Suite & Benchmark Evaluasi

### Menjalankan Unit & Integration Tests (185+ Test)
Jalankan seluruh test suite menggunakan pytest:
```bash
pytest -v
```

Untuk menjalankan hanya pengujian keamanan guardrails:
```bash
pytest tests/test_guardrails.py -v
```

Untuk menjalankan pengujian Model Context Protocol (MCP) server:
```bash
pytest tests/test_mcp_server.py -v
```

---

### Menjalankan Benchmark Evaluator (45 Kasus Uji)
Jalankan evaluasi benchmark akurasi analitik dan uji ketahanan adversarial:
```bash
python -m src.eval.runner --dataset data/eval_dataset.json
```
Hasil evaluasi akan otomatis diperbarui di file artefak `data/eval_report_latest.json`.

---

## 🔌 9. Menjalankan MCP Server (Model Context Protocol)

Harmonix menyediakan server MCP resmi berstandar terbuka (`src/mcp/server.py`) yang mengekspos database melalui protokol MCP untuk digunakan oleh **Claude Desktop** atau **Cursor**.

### Menjalankan MCP Server via CLI (stdio transport):
```bash
python -m src.mcp.server
```

### Konfigurasi untuk Claude Desktop:
Tambahkan konfigurasi berikut pada file `claude_desktop_config.json` Anda:
```json
{
  "mcpServers": {
    "harmonix": {
      "command": "/Users/username/Harmonix/.venv/bin/python",
      "args": ["-m", "src.mcp.server"],
      "cwd": "/Users/username/Harmonix",
      "env": {
        "DB_PORT": "5433",
        "DATABASE_URL": "postgresql+asyncpg://harmonix_user:harmonix_pass@127.0.0.1:5433/harmonix_db"
      }
    }
  }
}
```

---

## 🛑 10. Menghentikan Layanan

Untuk menghentikan seluruh layanan setelah selesai bekerja:

1. **Hentikan server FastAPI:**
   Tekan `Ctrl + C` pada jendela terminal tempat Uvicorn berjalan.

2. **Hentikan container database PostgreSQL:**
   ```bash
   docker compose down
   ```

3. **Mereset database dan menghapus volume (jika ingin memulai ulang dari nol):**
   ```bash
   docker compose down -v
   ```

---

## 🛠️ 11. Troubleshooting Masalah Umum

### 1. Port 8000 atau Port 5433 Sudah Digunakan (`Address already in use`)
* Cari proses yang sedang memakai port:
  ```bash
  lsof -i :8000
  lsof -i :5433
  ```
* Hentikan proses terkait:
  ```bash
  kill -9 <PID>
  ```

### 2. Database Error: `password authentication failed for user "harmonix_user"`
* Jika Anda sebelumnya pernah menjalankan container dengan kredensial lama, volume PostgreSQL `pgdata` mungkin masih menyimpan database lama.
* Solusi: Hapus volume lama dan inisialisasi ulang:
  ```bash
  docker compose down -v
  docker compose up -d
  ```

### 3. Docker Daemon Tidak Berjalan
* Pastikan aplikasi Docker Desktop sudah dibuka di komputer Anda sebelum menjalankan `docker compose up -d`.

### 4. FastEmbed Model Download Error
* Saat pertama kali hybrid search dijalankan, FastEmbed mengunduh model embedding ONNX (`BAAI/bge-small-en-v1.5`) ke direktori cache lokal `~/.cache/fastembed/`. Pastikan koneksi internet aktif pada eksekusi pertama.
