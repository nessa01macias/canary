# Canary — Architecture

The shared picture of how the system fits together. Read this before changing how
data flows. Companion docs: [`CONTEXT.md`](CONTEXT.md) (the why), [`DATA_SOURCES.md`](DATA_SOURCES.md)
(where data comes from), [`DEPLOY.md`](DEPLOY.md) (how it ships),
[`RESEARCH.md`](RESEARCH.md) (the AI area benchmark: method + conclusions),
[`VALIDATION.md`](VALIDATION.md) (ground-truth validation of the trajectory signal),
[`BENCHMARK.md`](BENCHMARK.md) (benchmark results one-pager).

---

## The one rule

**The frontend does no database work.** It talks to exactly one thing — our own
backend, same-origin at `/api/*`. No database client, no DB credentials, no direct
third-party data fetches in the browser. The backend is the single gateway that
touches every data source.

The only client-side key is `VITE_MAPTILER_KEY` — a public, referrer-restricted
**map-tile CDN** key (the browser must fetch tiles from MapTiler's CDN directly).
It is not a database credential and exposes no data.

---

## The layered data model (from the pipeline docs)

```
L0  raw/<source>/<snapshot_date>/…   immutable source snapshots — the moat/archive
L1  staged/*.parquet                 typed, h3_9 + two-date stamps on every row
L2  canonical (DuckDB)               areas / places / events
L3  metrics (DuckDB, one long table) area × metric × period, with provenance
L4  serving (this repo's API)        reads L2/L3, serves JSON — regenerable
```

L0–L3 are built **off-box** (on a laptop) by the pipeline. Only the derived
artifact `canary.duckdb` ships to the server. `data/raw/` (the moat) never leaves
your machine — back it up separately.

---

## Runtime topology (what runs where)

```
┌─ web container ─────────┐   ┌─ api container ───────────────────────────────┐
│ Caddy                   │   │ FastAPI (uvicorn)                             │
│  • serves React static  │   │  ├─ app/api/routes.py   HTTP surface (/api/*) │
│  • proxies /api/* ──────┼──►│  ├─ app/api/db.py       DuckDB wrapper (reads)│
│    to api:8000          │   │  │     └─ /data/canary.duckdb  (mounted :ro)  │
│  • terminates TLS       │   │  └─ app/api/store.py    Supabase writer       │
└─────────────────────────┘   └───────────────────────────────┬──────────────┘
                                                               │ https (httpx)
                                                  ┌────────────▼───────────────┐
                                                  │ Supabase (managed Postgres)│
                                                  │ external — not in Docker   │
                                                  └────────────────────────────┘

  laptop (off-box):  ingestion → data/raw (moat)  →  pipeline → canary.duckdb
                     then: deploy/push-duckdb.sh  →  api container (atomic swap)
```

Two containers (`web`, `api`) defined in [`docker-compose.yml`](docker-compose.yml).
Supabase is a managed external service — **not** a container. DuckDB is **not** a
service and **not** a container (see below).

---

## The two data stores — and why they're different engines

| | **canary.duckdb** | **Supabase** |
|---|---|---|
| Engine | DuckDB — **embedded, in-process** (like SQLite) | Postgres — managed service |
| Role | analytical **reads**: 5M events, trajectories | user **data**: contributions, auth |
| Writes | never — mounted read-only (`:ro`) | concurrent, from users |
| Lives | a **file** inside the `api` container | external, reached over the network |
| Wrapper | [`app/api/db.py`](backend/app/api/db.py) | [`app/api/store.py`](backend/app/api/store.py) |
| Credentials | none (it's a local file) | server-side env only (`SUPABASE_*`) |

Why two engines, not one: DuckDB is unbeatable for read-only analytical scans but
can't take concurrent internet writes; Postgres handles concurrent writes + auth
but would choke running 5M-row window functions. Each does the half it's built for.

### DuckDB is embedded — the key mental model

There is **no DuckDB server** to connect to. `db.py` opens the `.duckdb` file
in-process via the `duckdb` Python library and runs SQL directly — zero network
hops. It is not its own container and not a compose service; it's a file
(`/data/canary.duckdb`) mounted read-only into the `api` container, path passed via
`CANARY_DUCKDB`.

`db.py` opens a **fresh read-only connection per request** and closes it. This (a)
never holds the file open, so the pipeline can rebuild/atomically swap it freely,
and (b) means each request picks up freshly-pushed data with no restart. Open cost
is ~ms.

---

## Request flows

**Read (map, report):**
`browser → GET /api/changes?bbox=… → routes.py → db.py → canary.duckdb → JSON`

**Write (the moat):**
`browser → POST /api/contributions → routes.py → store.py → Supabase (PostgREST) → 201`

Same-origin `/api/*` is proxied to FastAPI by the Vite dev server locally
([`vite.config.ts`](frontend/vite.config.ts)) and by Caddy in production
([`frontend/Caddyfile`](frontend/Caddyfile)) — so there's no CORS and no hardcoded
backend host in either environment.

### The API surface (the frozen contract — [`schemas.py`](backend/app/api/schemas.py))

| Endpoint | Store | Returns |
|---|---|---|
| `GET /api/changes` | DuckDB | located, dated, cited change events (map markers) |
| `GET /api/report` | DuckDB | address → k-ring → changes + trajectories + sources |
| `GET /api/trajectory` | DuckDB | one metric's slope + direction + series |
| `GET /api/catalog` | DuckDB | machine-readable capability list (agent-legible) |
| `POST /api/contributions` | Supabase | persists a user review (the moat) |

Everything is H3-native (global spine) and geography-agnostic — adding a metro
changes data, never the contract.

---

## Privacy / security posture

- **No DB creds in the browser.** All keys are server-side env on the `api`
  container. Verified: the built bundle contains no Supabase client or key.
- **Raw contributions never leave Supabase.** RLS allows INSERT but has no SELECT
  policy — nobody can read raw reviews back through the API. Only the k-anonymised
  (`n ≥ 3`) `resident_layer_agg` view is ever exported back into the pipeline.
- **No protected-class data anywhere**; facts carry citations, never quality
  labels (enforced in the schema, not just convention).

---

## How it scales (none needed now)

- **More traffic** → run N `api` replicas behind Caddy; each mounts its own copy of
  the read-only `canary.duckdb`. Read-only files replicate for free.
- **Fresh data** → already restart-free: per-request connections pick up the file
  the instant `push-duckdb.sh` atomically swaps it.
- **Lower p99 under load** → swap `db.py`'s per-request open for a small read-only
  connection pool. One change, isolated to the wrapper.
- **DB too big for one box** (hundreds of GB) → MotherDuck (hosted DuckDB) or shard
  by metro. Tens of GB stays comfortably on one cheap box.
- **User-data growth** → Supabase scales as managed Postgres; no app change.

---

## Ownership (parallel work, no collisions)

| Layer | Directory | Owned by |
|---|---|---|
| Ingestion (L0) | `backend/app/ingestion`, `data/raw` | data chat |
| Pipeline (L1–L3) | `backend/app/pipeline`, `canary.duckdb` | pipeline chat |
| Serving + user data (L4) | `backend/app/api`, `supabase/` | serving chat |
| Frontend | `frontend/` | product/design |
| Deploy | `docker-compose.yml`, `deploy/`, `*/Dockerfile`, `Caddyfile` | shared |

The chats meet at exactly one interface: the L3 `metrics` table (pipeline produces,
serving reads) and the frozen API contract (serving produces, frontend reads).
