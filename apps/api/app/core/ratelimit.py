"""A small in-process rate limiter for the sign-in endpoints.

Counts are per API process: with several replicas the effective limit is the limit times the replica count, which is fine for
slowing password guessing. Use a gateway for hard limits.
"""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from app.core.config import settings

_hits: dict[str, deque] = defaultdict(deque)
_PRUNE_AT = 10_000


def reset() -> None:
    _hits.clear()


def client_ip(request: Request) -> str:
    if settings.trust_forwarded_for:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce(key: str, limit: int, window: int) -> None:
    """Count one hit on `key`; refuse with 429 once `limit` hits fall within the last `window` seconds."""
    now = time.monotonic()
    if len(_hits) > _PRUNE_AT:
        for k in [k for k, q in _hits.items() if not q or now - q[-1] > 3600]:
            del _hits[k]
    hits = _hits[key]
    while hits and now - hits[0] > window:
        hits.popleft()
    if len(hits) >= limit:
        retry = max(1, int(window - (now - hits[0])))
        raise HTTPException(status_code=429, detail="Too many attempts, try again later", headers={"Retry-After": str(retry)})
    hits.append(now)
