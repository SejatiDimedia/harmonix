"""Local zero-cost embedding engine using FastEmbed (ONNX Runtime)."""

import logging
from fastembed import TextEmbedding

logger = logging.getLogger(__name__)

# Model identifier
DEFAULT_EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
EMBEDDING_DIMENSION = 384


class LocalEmbeddingEngine:
    """Singleton wrapper for local embedding inference without API keys or costs."""

    _instance = None
    _model = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            try:
                cls._model = TextEmbedding(model_name=DEFAULT_EMBEDDING_MODEL)
                logger.info("Loaded FastEmbed model: %s (Dim: %d)", DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMENSION)
            except Exception as e:
                logger.error("Failed to load FastEmbed model: %s", e)
                cls._model = None
        return cls._instance

    def embed_text(self, text: str) -> list[float]:
        """Generate embedding vector for a single text string."""
        if not self._model:
            # Fallback zero-vector for testing if model failed to load
            return [0.0] * EMBEDDING_DIMENSION

        generator = self._model.embed([text])
        return [float(x) for x in next(generator)]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Generate embedding vectors for multiple text strings."""
        if not self._model or not texts:
            return [[0.0] * EMBEDDING_DIMENSION for _ in texts]

        generator = self._model.embed(texts)
        return [[float(x) for x in vec] for vec in generator]


# Global embedding engine instance
embedding_engine = LocalEmbeddingEngine()
