# Panduan Menjalankan Harmonix Secara Manual (Manual Run Guide)

Dokumen ini memandu langkah demi langkah (*step-by-step*) cara menyiapkan dependensi, mengonfigurasi variabel lingkungan, menjalankan database, menyalakan server backend FastAPI, serta mengakses antarmuka frontend secara manual tanpa bergantung pada skrip otomatis `run.sh`.

---

## 📋 1. Prasyarat Sistem (Prerequisites)

Pastikan lingkungan lokal Anda telah terpasang:
* **Python**: Versi `3.11` ke atas (direkomendasikan Python 3.12 atau 3.13).
* **Docker Desktop / Docker Engine**: Untuk menjalankan PostgreSQL 16 dengan ekstensi `pgvector`.
* **Node.js & npm** (opsional): Versi `18+` (hanya jika ingin memodifikasi atau menjalankan dev server frontend Vite secara independen).
* **9Router** (opsional): Smart Local AI Gateway untuk unified model routing, 3-tier fallback, dan kompresi token RTK di port 20128.
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

   # Pilihan Provider LLM: "ollama", "gemini", "groq", "openrouter", "9router", "mock"
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

   # Jika menggunakan OpenRouter (Free Tier Models)
   OPENROUTER_API_KEY=your_openrouter_key
   OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
   OPENROUTER_MODEL=nvidia/nemotron-3.5-lightning:free

   # Jika menggunakan 9Router (Smart Local Gateway di port 20128)
   NINEROUTER_BASE_URL=http://localhost:20128/v1
   NINEROUTER_API_KEY=your_ninerouter_key # Atau biarkan kosong untuk auto-detect dari ~/.9router/db/data.sqlite
   NINEROUTER_MODEL=ag/gemini-3.8-flash # Atau claude-3-7-sonnet, deepseek-r1, gpt-4o
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

## 🔀 4. Langkah Tambahan: Menjalankan 9Router Smart Gateway (Opsional)

Jika Anda memilih menggunakan **9Router** (`LLM_PROVIDER=9router`) sebagai gateway AI lokal:

### Apa itu 9Router?
9Router adalah CLI smart AI gateway lokal berbasis Node.js yang berjalan di port **`20128`** (`http://localhost:20128/v1`). 9Router bertindak sebagai proxy kompatibel OpenAI yang menghubungkan Harmonix ke beragam model (Claude 3.7 Sonnet, DeepSeek R1, GPT-4o, Gemini) dengan fitur:
* **Unified Model Routing**: Mengakses seluruh provider cloud dan lokal lewat satu endpoint standar di `http://localhost:20128/v1`.
* **Smart 3-Tier Fallback**: Otomatis mengalihkan ke model cadangan jika provider utama mengalami rate limit atau downtime.
* **Kompresi Token RTK**: Mengoptimalkan prompt dan context data analitik untuk menghemat biaya dan latensi.
* **Auto-Discovery Kunci API**: Harmonix otomatis membaca kredensial aktif 9Router dari database lokal `~/.9router/db/data.sqlite` jika `NINEROUTER_API_KEY` tidak diisi manual.

### 1. Periksa Ketersediaan 9Router:
Pastikan binary `9router` terpasang di sistem:
```bash
which 9router
```
*(Di lingkungan macOS dengan Laravel Herd / NVM, binary biasanya berada di: `~/Library/Application Support/Herd/config/nvm/versions/node/<versi>/bin/9router`)*.

### 2. Jalankan 9Router:
Buka terminal baru atau jalankan sebagai daemon latar belakang:
* **Mode Latar Belakang (Background Daemon):**
  ```bash
  9router -n -l --skip-update >/dev/null 2>&1 &
  ```
* **Mode Interaktif (Foreground / Debug):**
  ```bash
  9router -n -l --skip-update
  ```
  *Keterangan parameter:*
  * `-n` (*non-interactive*): Menghindari prompt terminal yang menahan proses.
  * `-l` (*local gateway*): Menjalankan server gateway lokal pada port `20128`.
  * `--skip-update`: Melewati pengecekan update otomatis saat startup agar proses inisialisasi instan.

### 3. Verifikasi Status 9Router:
Pastikan port 20128 aktif dan daftar model terhubung:
```bash
# Periksa status port
lsof -i :20128

# Periksa endpoint model
curl http://localhost:20128/v1/models
```

---

## 🐍 5. Langkah 3: Setup Virtual Environment Python

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

## 🚀 6. Langkah 4: Menjalankan Server Backend FastAPI

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

## 🖥️ 7. Langkah 5: Mengakses & Menjalankan Frontend Web UI

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

## 📊 8. Langkah 6 (Opsional): Seeding Data Demo Eksekutif

Jika Anda ingin langsung mencoba kanvas Live BI Dashboard yang sudah terisi widget (Line chart tren omzet bulanan, Doughnut status pengiriman, Bar kategori produk terlaris, dan tabel audit):

Jalankan skrip seed demo:
```bash
python scripts/seed_demo_story.py
```
Setelah skrip selesai, buka tab **Dashboard** di Web UI untuk melihat widget real-time.

---

## 🧪 9. Langkah 7: Menjalankan Test Suite & Benchmark Evaluasi

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

## 🔌 10. Menjalankan MCP Server (Model Context Protocol)

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

## 🛑 11. Menghentikan Layanan

Untuk menghentikan seluruh layanan setelah selesai bekerja:

1. **Hentikan server FastAPI:**
   Tekan `Ctrl + C` pada jendela terminal tempat Uvicorn berjalan, atau:
   ```bash
   lsof -ti :8000 | xargs kill -9
   ```

2. **Hentikan 9Router gateway (jika aktif):**
   ```bash
   lsof -ti :20128 | xargs kill -9
   ```

3. **Hentikan container database PostgreSQL:**
   ```bash
   docker compose down
   ```

4. **Mereset database dan menghapus volume (jika ingin memulai ulang dari nol):**
   ```bash
   docker compose down -v
   ```

---

## 🛠️ 12. Troubleshooting Masalah Umum

### 1. Port 8000, 5433, atau 20128 Sudah Digunakan (`Address already in use`)
* Cari proses yang sedang memakai port:
  ```bash
  lsof -i :8000
  lsof -i :5433
  lsof -i :20128
  ```
* Hentikan proses terkait:
  ```bash
  lsof -ti :8000 | xargs kill -9
  lsof -ti :20128 | xargs kill -9
  ```

### 2. 9Router Tidak Terdeteksi di `http://localhost:20128`
* Pastikan gateway 9Router sudah dijalankan: `9router -n -l --skip-update &`.
* Periksa apakah port 20128 aktif: `lsof -i :20128`.
* Jika 9Router belum terpasang atau tidak aktif, Anda dapat langsung beralih ke provider lain (Ollama, Gemini, Groq, atau Mock) kapan saja tanpa restart melalui UI modal di header Harmonix.

### 3. Database Error: `password authentication failed for user "harmonix_user"`
* Jika Anda sebelumnya pernah menjalankan container dengan kredensial lama, volume PostgreSQL `pgdata` mungkin masih menyimpan database lama.
* Solusi: Hapus volume lama dan inisialisasi ulang:
  ```bash
  docker compose down -v
  docker compose up -d
  ```

### 4. Docker Daemon Tidak Berjalan
* Pastikan aplikasi Docker Desktop sudah dibuka di komputer Anda sebelum menjalankan `docker compose up -d`.

### 5. FastEmbed Model Download Error
* Saat pertama kali hybrid search dijalankan, FastEmbed mengunduh model embedding ONNX (`BAAI/bge-small-en-v1.5`) ke direktori cache lokal `~/.cache/fastembed/`. Pastikan koneksi internet aktif pada eksekusi pertama.
