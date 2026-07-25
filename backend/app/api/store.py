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


async def insert_contribution(row: dict) -> None:
    """Insert one contribution row. Raises RuntimeError on any failure."""
    if not supabase_configured():
        raise RuntimeError(
            "Supabase not configured on the server (set SUPABASE_URL and "
            "SUPABASE_KEY / SUPABASE_SERVICE_KEY)."
        )
    endpoint = f"{SUPABASE_URL}/rest/v1/contributions"
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
