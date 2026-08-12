"""API-key authentication for the paid API surface.

A single FastAPI dependency (`require_key`) gates every data endpoint. Keys live
in Supabase (`api_keys`, see supabase/schema.sql); only their sha256 hash is
stored. To keep Supabase off the hot path, the active-key set is cached
in-process on a short TTL, so a hot key verifies locally and Supabase is hit at
most once per TTL. Revocation therefore takes up to one TTL to propagate.

Two tiers share one dependency (behaviour differs by `tier`):
  anon      the publishable key the frontend ships; low limit, Origin-locked by
            CORS. Keeps the free consumer map working once endpoints are gated.
  partner   issued per customer; higher limit, metered.
  internal  our own tools.

Fail-closed: missing or unknown key → 401, revoked/inactive → treated as unknown
(the cache only holds active keys), over-limit → 429. If SUPABASE_SERVICE_KEY is
not set the key set is empty and everything 401s by design — that misconfiguration
should surface immediately, not silently allow access.
"""

from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass

from fastapi import HTTPException, Request

from . import store

# Local-dev escape hatch. With CANARY_DEV_OPEN_API set, require_key waves every
# request through with a synthetic internal key — so the map runs with zero setup
# (no Supabase, no issued keys). OFF by default → production still fails closed.
# This is the ONLY bypass; it changes nothing else about the gate.
_DEV_OPEN = os.environ.get("CANARY_DEV_OPEN_API", "").strip().lower() in {"1", "true", "yes", "on"}

# ---- key cache (active keys only), refreshed from Supabase on a short TTL -----
_CACHE_TTL_S = 60.0
_cache: dict[str, "KeyRecord"] = {}
_cache_at: float = -1e9


@dataclass(frozen=True)
class KeyRecord:
    prefix: str
    label: str
    tier: str
    rate_limit_per_min: int


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def _active_keys() -> dict[str, KeyRecord]:
    global _cache, _cache_at
    now = time.monotonic()
    if _cache_at >= 0 and now - _cache_at < _CACHE_TTL_S:
        return _cache
    rows = await store.fetch_api_keys()  # active only; [] if Supabase unconfigured
    _cache = {
        r["key_hash"]: KeyRecord(
            prefix=r.get("prefix", ""),
            label=r.get("label") or "",
            tier=r.get("tier") or "partner",
            rate_limit_per_min=int(r.get("rate_limit_per_min") or 60),
        )
        for r in rows
        if r.get("key_hash")
    }
    _cache_at = now
    return _cache


# ---- per-key sliding-window rate limit (mirrors ask.py, keyed on the key) -----
_WINDOW_S = 60
_hits: dict[str, list[float]] = {}


def _rate_ok(prefix: str, limit: int) -> bool:
    now = time.time()
    window = [t for t in _hits.get(prefix, []) if now - t < _WINDOW_S]
    if len(window) >= limit:
        _hits[prefix] = window
        return False
    window.append(now)
    _hits[prefix] = window
    return True


def _extract(request: Request) -> str | None:
    """Key from `Authorization: Bearer <k>` or `X-API-Key`."""
    auth = request.headers.get("authorization")
    if auth and auth[:7].lower() == "bearer ":
        return auth[7:].strip()
    return request.headers.get("x-api-key")


async def require_key(request: Request) -> KeyRecord:
    if _DEV_OPEN:
        # Zero-setup local dev: no key needed. Never reached in prod (flag unset).
        rec = KeyRecord(prefix="dev", label="dev-open", tier="internal", rate_limit_per_min=10_000)
        request.state.api_key = rec
        return rec

    raw = _extract(request)
    if not raw:
        raise HTTPException(
            status_code=401,
            detail="API key required. Send 'Authorization: Bearer <key>' or 'X-API-Key: <key>'.",
        )
    rec = (await _active_keys()).get(_hash(raw))
    if rec is None:
        raise HTTPException(status_code=401, detail="Invalid or revoked API key.")
    if not _rate_ok(rec.prefix, rec.rate_limit_per_min):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Slow down or upgrade your tier.")
    # Stash for Phase 2 metering (routes can read request.state.api_key).
    request.state.api_key = rec
    return rec
