# Supabase — the user-data mailbox (the moat)

The READ side (permits, crime, trajectories) is served by FastAPI + `canary.duckdb`.
Supabase's **only** job is user data: the give-to-get contributions that build the
resident layer no one else can license.

## Setup / updates

Run [`schema.sql`](schema.sql) in the dashboard → **SQL Editor** → Run. It's
idempotent — re-run it whenever this file changes. (Last addition:
`resident_layer_by_area` view — required by `GET /api/resident-layer`.)

Server-side env (the `api` container / `backend/.env` — never the frontend):
```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_KEY=sb_publishable_...        # enough to INSERT + read the k-anon views
SUPABASE_SERVICE_KEY=...               # optional, only for raw-data aggregation/export
```

## What's protected (enforced by RLS, not app code)

| Object | anon can read | anon can write |
|---|---|---|
| `contributions` (raw reviews) | **no** — never leaves Supabase | insert only |
| `profiles` | own row only | own row only |
| `resident_layer_agg` (per-hex, k≥3) | yes — k-anonymised | no |
| `resident_layer_by_area` (per-area, k≥3) | yes — k-anonymised | no |

The k ≥ 3 floor means no area's numbers can identify an individual contributor.
The backend serves these views via `GET /api/resident-layer`; the monthly export
back into `data/raw/user_contributions/<date>/` reads the same views.
