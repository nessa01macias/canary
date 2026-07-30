"""
Server-side write path to Supabase (user data / the moat).

This is the ONLY place Supabase credentials live. The frontend never holds a key
and never talks to Supabase directly — it POSTs to /api/contributions and this
module performs the write. Keys come from the server environment (compose env in
prod, backend/.env in local dev), never from the client.

Uses Supabase's PostgREST endpoint over httpx (already a dependency) — no extra
SDK. The publishable/anon key is sufficient to INSERT (RLS allows it); a
service-role key can be swapped in later for reads/aggregation with no code
change (SUPABASE_SERVICE_KEY takes precedence when present).
"""

from __future__ import annotations

import os
from pathlib import Path

import httpx

# Load backend/.env for local dev. In Docker, env comes from compose (this is a
# no-op then). Never fails hard if python-dotenv or the file is absent.
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
except Exception:  # noqa: BLE001
    pass

SUPABASE_URL = os.environ.get("SUPABASE_URL")
# Prefer a service key if provided; fall back to the publishable/anon key, which
# can still INSERT contributions under RLS.
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY")


def supabase_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)


async def fetch_resident_layer(view: str) -> list[dict]:
    """Read one of the k-anonymised aggregate views (resident_layer_agg /
    resident_layer_by_area). These are the ONLY readable shape of contributions
    — raw reviews have no SELECT policy. Returns [] if the view doesn't exist
    yet (schema.sql not re-run) so the endpoint degrades instead of erroring."""
    if not supabase_configured():
        return []
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/{view}", headers=headers)
    if resp.status_code == 404:  # view not created yet
        return []
    resp.raise_for_status()
    return resp.json()


async def fetch_api_keys() -> list[dict]:
    """Active API keys for the auth path (backend/app/api/auth.py).

    Reads `api_keys` with the server key. The table is RLS-locked to the service
    role, so SUPABASE_SERVICE_KEY must be set — with only the anon key this
    returns [] and every gated endpoint fails closed. Returns [] (not an error)
    when Supabase is unconfigured or the table is absent, so local dev without
    Supabase simply has no valid keys rather than crashing on boot.
    """
    if not supabase_configured():
        return []
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    params = "active=eq.true&select=key_hash,prefix,label,tier,rate_limit_per_min,daily_quota"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/api_keys?{params}", headers=headers)
    if resp.status_code == 404:  # table not created yet
        return []
    resp.raise_for_status()
    return resp.json()


async def insert_api_key(row: dict) -> None:
    """Store one issued key (hash + metadata). Plaintext is never passed here."""
    await _insert("api_keys", row)


async def revoke_api_key(prefix: str) -> None:
    """Deactivate a key by its prefix (PATCH active=false)."""
    if not supabase_configured():
        raise RuntimeError("Supabase not configured (set SUPABASE_URL and a key).")
    endpoint = f"{SUPABASE_URL}/rest/v1/api_keys?prefix=eq.{prefix}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.patch(endpoint, headers=headers, json={"active": False})
    if resp.status_code >= 400:
        raise RuntimeError(f"Supabase revoke failed ({resp.status_code}): {resp.text}")
    if not resp.json():
        raise RuntimeError(f"No key with prefix '{prefix}'.")


async def insert_contribution(row: dict) -> None:
    """Insert one contribution row. Raises RuntimeError on any failure."""
    await _insert("contributions", row)


async def insert_gate_event(row: dict) -> None:
    """Insert one fake-door funnel event (gate_shown / gate_completed)."""
    await _insert("gate_events", row)


async def _insert(table: str, row: dict) -> None:
    if not supabase_configured():
        raise RuntimeError(
            "Supabase not configured on the server (set SUPABASE_URL and "
            "SUPABASE_KEY / SUPABASE_SERVICE_KEY)."
        )
    endpoint = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(endpoint, headers=headers, json=row)
    if resp.status_code >= 400:
        raise RuntimeError(f"Supabase insert failed ({resp.status_code}): {resp.text}")
