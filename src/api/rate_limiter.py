"""Pure Python in-memory sliding window rate limiter for FastAPI (P1 Security).

Protects LLM inference endpoints (/v1/chat, /v1/batch) and heavy disk/DB endpoints
(/v1/sessions/{session_id}/upload) against request flooding, DoS, and API quota exhaustion.
Zero external dependencies, async thread-safe, and returns standard HTTP 429 with Retry-After.
"""

import asyncio
from collections import defaultdict
import logging
import time
from typing import Callable
from fastapi import HTTPException, Request, status

from src.config import settings

logger = logging.getLogger("harmonix.rate_limiter")


class SlidingWindowRateLimiter:
    """Sliding window log rate limiter using timestamp deques per client key."""

    def __init__(self, max_requests: int, window_seconds: int = 60, name: str = "default"):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.name = name
        self._requests: dict[str, list[float]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def check(self, key: str) -> tuple[bool, int]:
        """Check whether key is within limit.

        Returns:
            (allowed: bool, retry_after: int)
        """
        now = time.time()
        cutoff = now - self.window_seconds

        async with self._lock:
            timestamps = self._requests[key]
            # Prune timestamps older than window cutoff
            valid_timestamps = [ts for ts in timestamps if ts > cutoff]

            if len(valid_timestamps) >= self.max_requests:
                oldest = valid_timestamps[0]
                retry_after = max(1, int(oldest + self.window_seconds - now))
                self._requests[key] = valid_timestamps
                return False, retry_after

            valid_timestamps.append(now)
            self._requests[key] = valid_timestamps
            return True, 0

    def reset(self) -> None:
        """Clear all recorded request timestamps."""
        self._requests.clear()


def create_rate_limiter(
    get_limit: Callable[[], int],
    window_seconds: int = 60,
    limiter_name: str = "rate_limit",
) -> tuple[Callable, SlidingWindowRateLimiter]:
    """Factory creating a FastAPI dependency and its associated rate limiter instance."""
    limiter = SlidingWindowRateLimiter(
        max_requests=get_limit(),
        window_seconds=window_seconds,
        name=limiter_name,
    )

    async def rate_limit_dependency(request: Request) -> None:
        if not settings.rate_limit_enabled:
            return

        # Dynamically refresh limit in case settings changed at runtime / in tests
        limiter.max_requests = get_limit()

        # Extract client IP: check X-Forwarded-For first for reverse-proxy setups
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            client_ip = forwarded.split(",")[0].strip()
        else:
            client_ip = request.client.host if request.client else "unknown_client"

        # Combine with API key or authorization token if present
        api_key = request.headers.get("X-API-Key")
        client_key = f"{client_ip}:{api_key}" if api_key else client_ip

        allowed, retry_after = await limiter.check(client_key)
        if not allowed:
            logger.warning(
                "Rate limit exceeded on '%s' for client '%s'. Limit: %d/%ds. Retry-After: %ds",
                limiter_name,
                client_ip,
                limiter.max_requests,
                window_seconds,
                retry_after,
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Terlalu banyak permintaan ({limiter_name}). Batas maksimum {limiter.max_requests} "
                    f"permintaan per {window_seconds} detik. Silakan coba lagi dalam {retry_after} detik."
                ),
                headers={"Retry-After": str(retry_after)},
            )

    return rate_limit_dependency, limiter


# Pre-configured dependencies for critical endpoints
rate_limit_chat, chat_limiter = create_rate_limiter(
    get_limit=lambda: settings.rate_limit_chat_per_minute,
    window_seconds=60,
    limiter_name="chat",
)

rate_limit_upload, upload_limiter = create_rate_limiter(
    get_limit=lambda: settings.rate_limit_upload_per_minute,
    window_seconds=60,
    limiter_name="upload",
)

rate_limit_batch, batch_limiter = create_rate_limiter(
    get_limit=lambda: settings.rate_limit_batch_per_minute,
    window_seconds=60,
    limiter_name="batch",
)

