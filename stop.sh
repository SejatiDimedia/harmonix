#!/usr/bin/env bash
# ==============================================================================
# Harmonix: One-Command All-in-One Stopper
# Menghentikan server FastAPI, 9Router (jika ada), dan container PostgreSQL.
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo ""
echo "🛑 Menghentikan seluruh layanan Harmonix..."

# 1. Hentikan Uvicorn jika berjalan di port 8000
UVICORN_PID=$(lsof -ti :8000 || true)
if [ -n "$UVICORN_PID" ]; then
  echo "⏹️ [1/3] Menghentikan server FastAPI di port 8000 (PID: $UVICORN_PID)..."
  kill $UVICORN_PID 2>/dev/null || true
else
  echo "ℹ️ [1/3] Server FastAPI di port 8000 tidak sedang berjalan."
fi

# 2. Hentikan 9Router jika berjalan di port 20128
ROUTER_PID=$(lsof -ti :20128 || true)
if [ -n "$ROUTER_PID" ]; then
  echo "⏹️ [2/3] Menghentikan 9Router gateway di port 20128 (PID: $ROUTER_PID)..."
  kill $ROUTER_PID 2>/dev/null || true
else
  echo "ℹ️ [2/3] 9Router gateway tidak sedang berjalan."
fi

# 3. Hentikan Docker container PostgreSQL
echo "🐘 [3/3] Menghentikan container database PostgreSQL..."
if docker info >/dev/null 2>&1; then
  docker compose down
  echo "✅ Database PostgreSQL berhasil dihentikan."
else
  echo "ℹ️ Docker daemon tidak aktif, lewati penghentian container."
fi

echo ""
echo "✨ Seluruh layanan Harmonix berhasil dihentikan dengan aman."
echo ""
