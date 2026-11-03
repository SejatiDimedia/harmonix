"""Cross-Encoder Reranker Engine for RAG (FR-12): Second-stage local precision ranking."""

import logging
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_RERANKER_MODEL = "ms-marco-TinyBERT-L-2-v2"


class BaseReranker(ABC):
    """Abstract interface for RAG document rerankers."""

    @abstractmethod
    def rerank(
        self,
        query: str,
        documents: list[dict[str, Any]],
        top_k: int = 3,
    ) -> list[dict[str, Any]]:
        """Rerank candidate documents against query using cross-attention scoring."""
        pass


class FlashRankReranker(BaseReranker):
    """High-speed, zero-cost local Cross-Encoder using FlashRank (ONNX Runtime, no GPU required)."""

    _instance = None
    _ranker = None
    _load_attempted = False

    def __init__(self, model_name: str = DEFAULT_RERANKER_MODEL):
        self.model_name = model_name

    def _get_ranker(self):
        """Lazily initialize FlashRank Ranker singleton on first reranking request."""
        if not FlashRankReranker._load_attempted:
            FlashRankReranker._load_attempted = True
            try:
                from flashrank import Ranker
                FlashRankReranker._ranker = Ranker(model_name=self.model_name)
                logger.info("Loaded FlashRank Cross-Encoder model: %s", self.model_name)
            except Exception as e:
                logger.warning("FlashRank Cross-Encoder initialization fallback: %s", e)
                FlashRankReranker._ranker = None
        return FlashRankReranker._ranker

    def rerank(
        self,
        query: str,
        documents: list[dict[str, Any]],
        top_k: int = 3,
    ) -> list[dict[str, Any]]:
        if not documents:
            return []

        ranker = self._get_ranker()
        if not ranker:
            # Fallback to heuristic reranking if FlashRank cannot be loaded
            return HeuristicCrossReranker().rerank(query, documents, top_k)

        try:
            from flashrank import RerankRequest

            passages = [
                {
                    "id": idx,
                    "text": doc.get("text") or doc.get("content") or doc.get("name", ""),
                    "meta": doc,
                }
                for idx, doc in enumerate(documents)
            ]

            rerank_req = RerankRequest(query=query, passages=passages)
            ranked_results = ranker.rerank(rerank_req)

            reranked_docs = []
            for r in ranked_results[:top_k]:
                doc_meta = dict(r.get("meta", {}))
                doc_meta["rerank_score"] = round(float(r.get("score", 0.0)), 4)
                reranked_docs.append(doc_meta)

            return reranked_docs
        except Exception as e:
            logger.warning("FlashRank reranking error, falling back to heuristic: %s", e)
            return HeuristicCrossReranker().rerank(query, documents, top_k)


class HeuristicCrossReranker(BaseReranker):
    """Deterministic token-overlap and exact-phrase cross reranker (Offline / Zero-dependency)."""

    def rerank(
        self,
        query: str,
        documents: list[dict[str, Any]],
        top_k: int = 3,
    ) -> list[dict[str, Any]]:
        if not documents:
            return []

        q_lower = query.lower().strip()
        q_tokens = set(q_lower.split())

        scored_docs = []
        for doc in documents:
            text = (doc.get("text") or doc.get("content") or doc.get("name", "")).lower()
            name = (doc.get("name") or doc.get("metric_name") or "").lower()

            score = 0.0
            # 1. Exact phrase in name (highest confidence)
            if q_lower in name or name in q_lower:
                score += 0.60
            # 2. Exact phrase in full body text
            elif q_lower in text:
                score += 0.35

            # 3. Token coverage ratio
            if q_tokens:
                matched_tokens = sum(1 for tok in q_tokens if tok in text)
                score += 0.40 * (matched_tokens / len(q_tokens))

            # 4. Integrate initial RRF or dense score if available
            prior_score = float(doc.get("rrf_score") or doc.get("dense_score") or 0.0)
            score += 0.10 * prior_score

            doc_copy = dict(doc)
            doc_copy["rerank_score"] = round(score, 4)
            scored_docs.append(doc_copy)

        scored_docs.sort(key=lambda x: x["rerank_score"], reverse=True)
        return scored_docs[:top_k]


def get_reranker(model_name: str | None = None) -> BaseReranker:
    """Factory returning configured Cross-Encoder reranker."""
    from src.config import settings

    if not getattr(settings, "rag_enable_reranker", True):
        return HeuristicCrossReranker()

    m_name = model_name or getattr(settings, "rag_reranker_model", DEFAULT_RERANKER_MODEL)
    return FlashRankReranker(model_name=m_name)
