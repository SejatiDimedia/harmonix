"""Re-export FastAPI app for convenience (e.g. uvicorn src.api.app:app)."""

from src.api.main import app

__all__ = ["app"]
