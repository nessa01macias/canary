"""Issue or revoke a Canary API key.

Keys are stored in Supabase as a sha256 HASH only (see supabase/schema.sql); the
plaintext is printed ONCE here and never persisted. Requires SUPABASE_URL and a
key with write access (SUPABASE_SERVICE_KEY) in backend/.env.

Issue a partner key:
    python scripts/issue_api_key.py --label "Acme AI" --tier partner --rate-limit 120

Issue the frontend's publishable anon key (put the printed value in
VITE_CANARY_ANON_KEY at build time):
    python scripts/issue_api_key.py --label "web app" --tier anon --rate-limit 60

Revoke by prefix:
    python scripts/issue_api_key.py --revoke canary_sk_ab12cd
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import secrets
import sys
from pathlib import Path

# Allow running as `python scripts/issue_api_key.py` from backend/ (puts the
# backend dir on the path so `app` resolves, like the `-m` module scripts do).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api import store  # noqa: E402


def _new_key(tier: str) -> tuple[str, str, str]:
    """Return (plaintext, prefix, sha256). Anon keys get a 'pk' marker so a
    publishable key is visually distinct from a secret one."""
    marker = "pk" if tier == "anon" else "sk"
    body = secrets.token_hex(20)
    plaintext = f"canary_{marker}_{body}"
    prefix = plaintext[: len(f"canary_{marker}_") + 6]  # canary_sk_ab12cd
    return plaintext, prefix, hashlib.sha256(plaintext.encode()).hexdigest()


async def _issue(label: str, tier: str, rate_limit: int, quota: int | None) -> None:
    if not store.supabase_configured():
        raise SystemExit("Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env")
    plaintext, prefix, key_hash = _new_key(tier)
    await store.insert_api_key({
        "key_hash": key_hash,
        "prefix": prefix,
        "label": label,
        "tier": tier,
        "active": True,
        "rate_limit_per_min": rate_limit,
        "daily_quota": quota,
    })
    print("\n  Key issued. Copy the plaintext now — it is not stored and cannot be shown again.\n")
    print(f"    key      {plaintext}")
    print(f"    prefix   {prefix}   (use this to revoke)")
    print(f"    label    {label}")
    print(f"    tier     {tier}   rate {rate_limit}/min   quota {quota if quota is not None else 'unlimited'}\n")
    if tier == "anon":
        print("  Anon key: set it as VITE_CANARY_ANON_KEY in the frontend build env.\n")


async def _revoke(prefix: str) -> None:
    if not store.supabase_configured():
        raise SystemExit("Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env")
    await store.revoke_api_key(prefix)
    print(f"  Revoked {prefix}. Takes effect within the auth cache TTL (~60s).")


def main() -> None:
    p = argparse.ArgumentParser(description="Issue or revoke a Canary API key.")
    p.add_argument("--revoke", metavar="PREFIX", help="deactivate the key with this prefix")
    p.add_argument("--label", help="partner name / purpose")
    p.add_argument("--tier", choices=["anon", "partner", "internal"], default="partner")
    p.add_argument("--rate-limit", type=int, default=60, help="requests per minute")
    p.add_argument("--quota", type=int, default=None, help="daily request quota (Phase 2; default unlimited)")
    args = p.parse_args()

    if args.revoke:
        asyncio.run(_revoke(args.revoke))
        return
    if not args.label:
        raise SystemExit("--label is required to issue a key (or use --revoke PREFIX).")
    asyncio.run(_issue(args.label, args.tier, args.rate_limit, args.quota))


if __name__ == "__main__":
    main()
