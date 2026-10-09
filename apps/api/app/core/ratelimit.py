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
    """The caller's address. Each trusted proxy appends the address it saw to X-Forwarded-For, so the real client is the Nth
    entry from the right; anything further left was written by the client and is never used."""
    hops = settings.trusted_proxy_hops
    if hops > 0:
        # A proxy may add its entry as a separate header line: read every line, in order, as one list.
        lines = request.headers.getlist("x-forwarded-for")
        entries = [e.strip() for line in lines for e in line.split(",") if e.strip()]
        if len(entries) >= hops:
            return entries[-hops]
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
