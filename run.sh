#!/usr/bin/env bash
# ==============================================================================
# Harmonix: One-Command All-in-One Launcher
# Menjalankan Docker, PostgreSQL, 9Router (opsional), FastAPI Server,
# dan membuka browser secara otomatis.
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo ""
echo "╔═════════════════════════════════════════════════════════════════╗"
echo "║             🚀 HARMONIX ALL-IN-ONE SYSTEM LAUNCHER             ║"
echo "║          Autonomous Enterprise AI Data Analyst Agent            ║"
echo "╚═════════════════════════════════════════════════════════════════╝"
echo ""

# 1. Periksa berkas konfigurasi .env
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    echo "📋 Membuat file konfigurasi .env dari .env.example..."
    cp .env.example .env
  else
    echo "⚠️ Berkas .env tidak ditemukan dan .env.example tidak tersedia."
  fi
fi

# 2. Periksa status Docker Daemon
echo "🔍 [1/5] Memeriksa status Docker..."
if ! docker info >/dev/null 2>&1; then
  if [ -d "/Applications/Docker.app" ]; then
    echo "🐳 Docker Desktop belum berjalan. Membuka Docker Desktop..."
    open -a Docker
    echo "⏳ Menunggu Docker daemon siap (bisa memakan waktu beberapa detik)..."
    RETRIES=0
    MAX_RETRIES=30
    until docker info >/dev/null 2>&1 || [ $RETRIES -ge $MAX_RETRIES ]; do
      sleep 2
      RETRIES=$((RETRIES + 1))
      printf "."
    done
    echo ""
    if [ $RETRIES -ge $MAX_RETRIES ]; then
      echo "❌ Docker gagal siap dalam waktu yang ditentukan. Pastikan Docker Desktop terbuka."
      exit 1
    fi
  else
    echo "❌ Docker daemon tidak aktif dan Docker.app tidak ditemukan di /Applications."
    echo "   Silakan jalankan Docker secara manual terlebih dahulu."
    exit 1
  fi
fi
echo "✅ Docker daemon aktif."

# 3. Jalankan Container Database PostgreSQL
echo "🐘 [2/5] Menjalankan PostgreSQL 16 (harmonix_postgres) via Docker Compose..."
docker compose up -d

echo "⏳ Menunggu database PostgreSQL siap menerima koneksi pada port 5433..."
DB_READY=false
for i in {1..20}; do
  if docker compose exec -T postgres pg_isready -U "${DB_USER:-harmonix_user}" -d "${DB_NAME:-harmonix_db}" >/dev/null 2>&1; then
    DB_READY=true
    break
  fi
  sleep 1
done

if [ "$DB_READY" = true ]; then
  echo "✅ PostgreSQL siap di port 5433."
else
  echo "⚠️ Database sedang inisialisasi, melanjutkan proses startup..."
fi

# 4. Jalankan 9Router Gateway Lokal jika tersedia (opsional)
echo "🔀 [3/5] Memeriksa 9Router Smart Gateway..."
NINEROUTER_BIN="/Users/timurdianradhasejati/Library/Application Support/Herd/config/nvm/versions/node/v23.11.0/bin/9router"
if [ -x "$NINEROUTER_BIN" ]; then
  if ! lsof -i :20128 >/dev/null 2>&1; then
    echo "⚡ Menjalankan 9Router gateway di latar belakang (port 20128)..."
    "$NINEROUTER_BIN" -n -l --skip-update >/dev/null 2>&1 &
    sleep 1
  else
    echo "✅ 9Router gateway sudah aktif di port 20128."
  fi
else
  echo "ℹ️ 9Router tidak terinstal (menggunakan koneksi langsung ke provider)."
fi

# 5. Aktifkan Virtual Environment Python
echo "🐍 [4/5] Memuat virtual environment Python..."
if [ -d ".venv" ]; then
  source .venv/bin/activate
else
  echo "📦 Membuat virtual environment .venv baru..."
  python3 -m venv .venv
  source .venv/bin/activate
  echo "📥 Menginstal dependensi Python..."
  pip install -e .
fi

# 6. Buka Browser Otomatis
echo "🌐 [5/5] Menyiapkan antarmuka web di peramban..."
(
  sleep 2
  if command -v open >/dev/null 2>&1; then
    open "http://localhost:8000"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:8000"
  fi
) &

# 7. Jalankan Server FastAPI Uvicorn
echo ""
echo "✨ SELURUH LAYANAN SIAP! Memulai server FastAPI di http://localhost:8000..."
echo "👉 Tekan [CTRL + C] di jendela terminal ini kapan saja untuk menghentikan server."
echo "-----------------------------------------------------------------"
echo ""

exec uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload
