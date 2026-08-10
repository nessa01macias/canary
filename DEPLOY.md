# Deploying Canary (living doc — updated 2026-07-29)

Internal working note, never shipped to the site. This is the deployment lane's canon:
live infra, the redeploy playbook, and every gotcha that cost real debugging time.
The Claude memory directory does not travel across laptops; this file does.

## Live infrastructure

- **https://canarylayer.com** (+ www) — Hetzner **CPX11** (2 vCPU / 2GB / 40GB, ~€12/mo
  with IPv4), Ubuntu 24.04, Hillsboro us-west. IP **5.78.144.35**. Repo dir: `/opt/canary`.
- DNS: Cloudflare, both A records **grey-cloud (DNS only)** — Caddy owns the Let's
  Encrypt cert and auto-renews. Never flip to orange-cloud without also setting
  Cloudflare SSL to Full (strict), or you get redirect/cert loops.
- Stack (`docker-compose.yml`):
  - `web` — Caddy: serves the Vite bundle, reverse-proxies `/api/*` → `api:8000`
    (prefix preserved), auto-HTTPS, gzip, **immutable cache on `/assets/*`**,
    **no-cache on HTML**, `.mjs` forced to `text/javascript`, `/assets/*` never falls
    back to index.html (missing asset = clean 404), JSON access logs → stdout
    (`docker compose logs web`).
  - `api` — FastAPI/uvicorn, non-root, slim image from **`backend/requirements-serve.txt`**,
    DuckDB opened read-only per request, H3 extension pre-baked at image build.
- Server data (mounted read-only into `api`):
  - `backend/data/canary.duckdb` — the compacted derived DB (only DB on the server)
  - `backend/data/processed/` — small artifacts read off disk (claims.json, freshness.json)
  - `backend/data/raw/overture_places/` — ~2MB slice for `/api/places/search`
- Server env (`/opt/canary/.env` — never in git, never overwritten by rsync):
  `SITE_ADDRESS` (apex + www), `VITE_MAPTILER_KEY`, `SUPABASE_URL`/`SUPABASE_KEY` (anon),
  optional slots wired in compose: `SUPABASE_SERVICE_KEY`, `ANTHROPIC/OPENAI/GEMINI_API_KEY`,
  `STADIA_API_KEY` (absent → `/api/commute` returns routing_unconfigured, UI shows "—").

## The routine: "commit, push, redeploy"

```bash
# 0) hygiene: review what's staged; never commit .env / *.duckdb / data/raw / data/logs
git status --short
git add -A && git commit && git push

# 1) code → server. --delete is REQUIRED (see gotcha 4); excludes protect .env + data.
rsync -a --delete --exclude .git --exclude 'backend/data' --exclude node_modules \
  --exclude venv --exclude '*.duckdb' --exclude .env ./ root@5.78.144.35:/opt/canary/

# 2) small data artifacts, only when they changed
rsync -a backend/data/processed/ root@5.78.144.35:/opt/canary/backend/data/processed/
rsync -a backend/data/raw/overture_places/ root@5.78.144.35:/opt/canary/backend/data/raw/overture_places/

# 3) DuckDB, only when the pipeline rebuilt it — COMPACT first (halves it), then atomic swap
backend/venv/bin/python -c "import duckdb; c=duckdb.connect(); \
  c.execute(\"ATTACH 'backend/data/canary.duckdb' AS src (READ_ONLY)\"); \
  c.execute(\"ATTACH 'backend/data/canary_compact.duckdb' AS dst\"); \
  c.execute('COPY FROM DATABASE src TO dst')"
rsync -a --partial backend/data/canary_compact.duckdb \
  root@5.78.144.35:/opt/canary/backend/data/canary.duckdb.tmp
ssh root@5.78.144.35 'mv -f /opt/canary/backend/data/canary.duckdb.tmp \
  /opt/canary/backend/data/canary.duckdb'
rm -f backend/data/canary_compact.duckdb

# 4) build FIRST (old site keeps serving = zero downtime), then swap, then verify
ssh root@5.78.144.35 'cd /opt/canary && docker compose build > /tmp/b.log 2>&1 \
  && docker compose up -d || tail -30 /tmp/b.log'
ssh root@5.78.144.35 'for p in / /api/catalog /api/sf/neighborhoods \
  /assets/maplibre-gl-worker.mjs /assets/maplibre-gl-shared.mjs; do \
  curl -s --resolve canarylayer.com:443:127.0.0.1 -o /dev/null -w "%{http_code}  $p\n" \
  https://canarylayer.com$p; done'
```

Ordering rule for combined code+DB deploys: build images while the DB uploads, but only
`up -d` AFTER the DB swap — new code must never run against a DB missing its tables.

## Gotchas (each cost hours — do not re-learn)

1. **MapLibre v6 blank map.** The render worker `/assets/maplibre-gl-worker.mjs` AND its
   import `/assets/maplibre-gl-shared.mjs` must exist in `dist/assets/`
   (frontend/Dockerfile copies both from the maplibre-gl package). Missing either →
   the worker dies silently → the map never fires `load` → every data fetch (they all
   live inside `map.on('load')`) never runs → blank map, stuck "Loading…", NO console
   error. Diagnose via the Caddy access-log waterfall, not the console.
2. **Slim serve image.** `api` installs `backend/requirements-serve.txt`, NOT
   requirements.txt (the supabase SDK conflicts with the pinned websockets). Any new
   third-party import under `backend/app/api/` or `main.py` must be added there, or the
   container crash-loops with ModuleNotFoundError and every endpoint 502s.
3. **Web build context = repo root** (not `./frontend`): Docs.tsx imports repo-root
   `../../*.md`. The Dockerfile globs `COPY *.md /app/` — never list docs explicitly
   (an explicit list broke the build the day ABOUT.md appeared).
4. **`rsync --delete` always.** Without it, locally-deleted .tsx files ghost on the
   server, `tsc -b` type-checks them, and the build fails on code that no longer exists.
5. **No rsync on the Windows dev machine.** Git Bash ships `tar`, `ssh` and `scp` but
   not `rsync`, so every rsync line in the routine above fails with "command not
   found". Use tar over ssh instead, and remember it has no `--delete`, so if you
   deleted files locally you must remove the ghosts on the server by hand (gotcha 4
   still applies):
   ```bash
   tar czf - --exclude='frontend/node_modules' --exclude='frontend/dist' \
     frontend ABOUT.md RESEARCH.md SOURCES.md BENCHMARK.md \
     | ssh root@5.78.144.35 'cd /opt/canary && tar xzf -'
   ```
6. **Frontend-only deploys are safe and sometimes required.** The `web` image needs
   only `frontend/` and root `*.md` (Dockerfile copies nothing from `backend/`), so
   you can ship docs and UI without touching the API: sync those paths, then
   `docker compose build web && docker compose up -d web`. This is the correct move
   while the API-gating prerequisites are outstanding, since a full deploy would
   activate `require_key` and 401 the live map. Done this way 2026-07-31: prose and
   figures are now both v2 on prod, `api` container untouched.
7. **The work laptop lies about prod (RELEX).** On VPN the domain is blocked outright
   (ERR_CONNECTION_CLOSED). Off VPN, corporate SSL inspection (issuer "Retail Logistics
   Excellence - Forward Trust CA") breaks curl/openssl from the laptop. Only trust
   server-side checks: `curl --resolve canarylayer.com:443:127.0.0.1 ...`. The
   user-level truth test is a phone on cellular.
8. **Headless ground truth on the server.** `docker run zenika/alpine-chrome` against
   the live site (chmod 777 the output dir first — Chrome runs non-root). `--screenshot`
   fires at DOM load, far too early for the map; add `--virtual-time-budget`. The
   definitive "map works" signal is `/api/sf/*` hits appearing in the api logs — those
   only fire after the map fully renders.
9. **No schedulers on the work laptop** (RELEX security flagged the launchd ratchet
   2026-07-29; removed). Until an off-laptop runner exists, refresh manually:
   `cd backend && ./venv/bin/python -m app.ingestion.refresh` — staleness is visible at
   `/api/freshness`.

## Costs and backups

- Total burn: Hetzner ~€12/mo + domain ~$11/yr. Nothing else.
- `backend/data/raw` is now **~16 GB** and partially non-refetchable — it exceeds R2's
  10GB free tier, so the "free backup later" plan needs revisiting (Hetzner Object
  Storage ~€5/mo/TB, or B2). The archive is the company; losing the server loses
  nothing, losing the laptop's data folder loses the moat.

## First-deploy-from-scratch (server rebuild)

`deploy/bootstrap-server.sh` (Docker + compose + ufw + 2GB swap for small-box builds),
push DB, rsync code, scp the root `.env`, `docker compose up -d --build`. DNS grey-cloud
A records → Caddy self-provisions the cert. Details of the original walkthrough are in
git history of this file.
