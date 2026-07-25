"""L4 publish: push serving tables to Supabase and/or export them to processed/.

The analytical store (canary.duckdb) never serves users; this step extracts the small,
final, neighborhood-grain tables and publishes them. Two targets:

  --local   write JSON to data/processed/ (no credentials needed; the FastAPI/agents
            can serve these without holding any lock on canary.duckdb)
  --push    upsert to Supabase. Requires SUPABASE_SERVICE_KEY (the publishable key is
            client-safe/read-only by design and cannot write). Tables must exist once:
            run `--schema` and paste the SQL into the Supabase SQL editor (RLS on,
            anon read policy -- so the frontend can read them with the publishable key).

Default mode (no flags) is a connectivity check: verifies the key reaches the project
and reports whether the serving tables exist yet.

Usage:
    python -m app.pipeline.publish             # connectivity check
    python -m app.pipeline.publish --schema    # print one-time table DDL
    python -m app.pipeline.publish --local     # export processed/ JSON
    python -m app.pipeline.publish --push      # upsert to Supabase (needs service key)
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone

from dotenv import load_dotenv

from app.pipeline import core

TRAJECTORY_TABLE = "neighborhood_trajectory"
MONTHLY_TABLE = "neighborhood_metrics_monthly"
MONTHLY_WINDOW_MONTHS = 36
BATCH = 500

SCHEMA_SQL = f"""
-- One-time setup: paste into Supabase SQL editor (Dashboard > SQL). RLS is enabled
-- with an anon read policy: the publishable key can READ, only service role writes.
create table if not exists public.{TRAJECTORY_TABLE} (
  area_id text not null,
  metric text not null,
  last12 double precision,
  prior12 double precision,
  pct_change double precision,
  slope36 double precision,
  z double precision,
  rankable boolean,
  source text,
  source_as_of date,
  computed_at timestamptz,
  pipeline_version text,
  primary key (area_id, metric)
);
create table if not exists public.{MONTHLY_TABLE} (
  area_id text not null,
  metric text not null,
  period date not null,
  value double precision,
  n integer,
  source text,
  source_as_of date,
  primary key (area_id, metric, period)
);
alter table public.{TRAJECTORY_TABLE} enable row level security;
alter table public.{MONTHLY_TABLE} enable row level security;
drop policy if exists "public read" on public.{TRAJECTORY_TABLE};
create policy "public read" on public.{TRAJECTORY_TABLE} for select using (true);
drop policy if exists "public read" on public.{MONTHLY_TABLE};
create policy "public read" on public.{MONTHLY_TABLE} for select using (true);
"""


def _env() -> tuple[str | None, str | None, str | None]:
    load_dotenv(core.BACKEND_DIR / ".env")
    return (
        os.environ.get("SUPABASE_URL"),
        os.environ.get("SUPABASE_KEY"),
        os.environ.get("SUPABASE_SERVICE_KEY"),
    )


def _extract(con) -> dict[str, list[dict]]:
    """The two serving payloads, JSON-safe (dates -> ISO strings)."""

    def rows(sql: str) -> list[dict]:
        cur = con.execute(sql)
        cols = [d[0] for d in cur.description]
        return [
            {c: (v.isoformat() if hasattr(v, "isoformat") else v) for c, v in zip(cols, row)}
            for row in cur.fetchall()
        ]

    return {
        TRAJECTORY_TABLE: rows(
            """
            SELECT area_id, metric, last12, prior12, pct_change, slope36, z, rankable,
                   source, source_as_of, computed_at, pipeline_version
            FROM trajectory WHERE area_level = 'neighborhood'
            """
        ),
        MONTHLY_TABLE: rows(
            f"""
            SELECT area_id, metric, period, value, n, source, source_as_of
            FROM metrics
            WHERE area_level = 'neighborhood'
              AND period >= date_trunc('month', current_date) - INTERVAL {MONTHLY_WINDOW_MONTHS} MONTH
            """
        ),
    }


def export_local(payloads: dict[str, list[dict]]) -> None:
    core.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    for name, rows in payloads.items():
        out = core.PROCESSED_DIR / f"{name}.json"
        out.write_text(
            json.dumps(
                {
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "pipeline_version": core.pipeline_version(),
                    "row_count": len(rows),
                    "rows": rows,
                },
                indent=1,
            )
        )
        print(f"[local] {name}: {len(rows):,} rows -> {out.relative_to(core.DATA_DIR)}")


def check(url: str, key: str) -> None:
    from postgrest.exceptions import APIError
    from supabase import create_client

    client = create_client(url, key)
    try:
        client.table(TRAJECTORY_TABLE).select("area_id").limit(1).execute()
        print(f"[check] connected to {url}; table '{TRAJECTORY_TABLE}' exists and is readable")
    except APIError as exc:
        if exc.code == "PGRST205":
            print(
                f"[check] connected to {url}; key is valid, but serving tables don't exist yet.\n"
                f"        One-time setup: `python -m app.pipeline.publish --schema` and paste "
                f"the SQL into the Supabase SQL editor."
            )
        else:
            print(f"[check] reached {url} but got {exc.code}: {exc.message}")


def push(url: str, service_key: str, payloads: dict[str, list[dict]]) -> None:
    from supabase import create_client

    client = create_client(url, service_key)
    for name, rows in payloads.items():
        for i in range(0, len(rows), BATCH):
            client.table(name).upsert(rows[i : i + BATCH]).execute()
        print(f"[push] {name}: upserted {len(rows):,} rows")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema", action="store_true", help="print one-time Supabase DDL")
    parser.add_argument("--local", action="store_true", help="export serving JSON to processed/")
    parser.add_argument("--push", action="store_true", help="upsert serving tables to Supabase")
    args = parser.parse_args()

    if args.schema:
        print(SCHEMA_SQL)
        return

    url, key, service_key = _env()

    if args.local or args.push:
        con = core.connect(read_only=True)
        payloads = _extract(con)
        con.close()
        if args.local:
            export_local(payloads)
        if args.push:
            if not (url and service_key):
                raise SystemExit(
                    "--push needs SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env "
                    "(Dashboard > Settings > API keys > service_role). The publishable "
                    "key cannot write."
                )
            push(url, service_key, payloads)
        return

    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY missing from backend/.env")
    check(url, key)


if __name__ == "__main__":
    main()
