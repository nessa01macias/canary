# Deploying Canary

## The one thing to understand first: what ships and what doesn't

`backend/data/` is ~3.5 GB, but it is three different things with opposite needs:

| Path | Size | What it is | Ships to server? |
|------|------|-----------|------------------|
| `data/raw/` | ~3.2 GB | Immutable source snapshots — **the archive/moat** | **No.** Stays on your laptop. |
| `data/staged/` | ~94 MB | Intermediate parquet (pipeline internals) | No. |
| `data/canary.duckdb` | ~208 MB | Derived metrics/events the API serves | **Yes — this is the only data on the server.** |

The pipeline (ingestion + build) runs **off-box** (your laptop). The server only ever
holds the derived DuckDB, so a tiny/cheap instance handles it comfortably.

```
laptop:  ingestion -> data/raw (moat, kept local)
                   -> pipeline -> canary.duckdb --push--> server
server:  Caddy (React static + /api proxy)  +  FastAPI (reads canary.duckdb :ro)
```

## Server size

A Hetzner **CX22** (2 vCPU / 4 GB / 40 GB, ~€4/mo) is plenty: serving a 208 MB
read-only DuckDB plus a static bundle is negligible load. Location: whichever is
closest to you/users (Falkenstein is fine). Image: Ubuntu 24.04 or 26.04. Add your
SSH key at create time.

## First deploy (once)

From the **Hetzner console**, create the server (above) with your SSH key.

Then, from your laptop:

```bash
# 1. Prepare the server (installs Docker + Compose + firewall).
ssh root@<server-ip> 'bash -s' < deploy/bootstrap-server.sh

# 2. Push the derived DB (must exist before compose can mount it).
#    Build it first if needed:  cd backend && python -m app.pipeline.build
CANARY_HOST=root@<server-ip> ./deploy/push-duckdb.sh

# 3. Copy the repo (code only — .dockerignore keeps data/ out) and env.
rsync -avz --exclude .git --exclude 'backend/data' --exclude node_modules \
      --exclude venv ./ root@<server-ip>:/opt/canary/
scp .env.example root@<server-ip>:/opt/canary/.env   # then edit values on the server

# 4. Bring it up.
ssh root@<server-ip> 'cd /opt/canary && docker compose up -d --build'
```

Visit `http://<server-ip>` — the map should load.

## Add a domain + HTTPS (when ready)

1. Point an A record at the server IP.
2. On the server, set `SITE_ADDRESS=canary.yourdomain.com` in `/opt/canary/.env`.
3. `docker compose up -d` — Caddy provisions a Let's Encrypt cert automatically.

## Routine: ship fresh data

After running the pipeline locally, one command republishes:

```bash
CANARY_HOST=root@<server-ip> CANARY_RESTART=1 ./deploy/push-duckdb.sh
```

Atomic (rsync to temp + remote `mv`), so the API never reads a half-written file.

## Redeploy code

```bash
rsync -avz --exclude .git --exclude 'backend/data' --exclude node_modules \
      --exclude venv ./ root@<server-ip>:/opt/canary/
ssh root@<server-ip> 'cd /opt/canary && docker compose up -d --build'
```

## Notes / current state

- The frontend fetches SF permits **directly from `data.sfgov.org`** client-side
  (`frontend/src/sfPermits.ts`) and needs no backend to render today. Caddy proxies
  `/api/*` to FastAPI, so DuckDB-backed endpoints work same-origin the moment they
  land in `backend/app/main.py` — no CORS, no config change.
- `canary.duckdb` is mounted **read-only**. Serving code must open it read-only
  (`duckdb.connect(path, read_only=True)`); it never mutates the served DB.
- `MAPTILER` key is a client key inlined at build time — safe to be public, but keep
  it referrer-restricted in the MapTiler dashboard.
- Backups: the moat is `data/raw` on your laptop — that is the thing to back up
  (Time Machine / an external drive / object storage later). Losing the server loses
  nothing you can't rebuild by re-running the pipeline and re-pushing.
