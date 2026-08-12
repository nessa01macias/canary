# Deploying Canary (living doc — updated 2026-08-12)

Internal working note, never shipped to the site. This is the deployment lane's canon:
live infra, the redeploy playbook, and every gotcha that cost real debugging time.
The Claude memory directory does not travel across laptops; this file does.

> **Moved hosts on 2026-08-12.** Canary no longer has its own server. It now shares the
> Hetzner EX44 that hosts Pharos, which killed the €12/mo CPX11 bill. The old box
> (`root@5.78.144.35`, `/opt/canary`) is gone. Everything below is the new lane.

## Live infrastructure

- **https://canarylayer.com** (+ www) — Hetzner **EX44 dedicated** (i5-13500 14c/20t,
  64GB RAM, 2×512GB NVMe RAID1), Falkenstein. IP **144.76.58.207**.
  Repo dir: **`/home/deploy/canary`**, user **`deploy`**, key `resources/claude_pharos_mel`.
  **This box also runs Pharos — a live revenue business. Read "Sharing the box" below
  before touching anything outside `/home/deploy/canary`.**
- DNS: Cloudflare, both A records **grey-cloud (DNS only)** — Caddy owns the Let's
  Encrypt cert and auto-renews. Never flip to orange-cloud without also setting
  Cloudflare SSL to Full (strict), or you get redirect/cert loops.
- Stack (`docker-compose.yml`) — **two containers, no published ports**:
  - `canary-web` — Caddy: serves the Vite bundle, reverse-proxies `/api/*` → `api:8000`
    (prefix preserved), gzip, **immutable cache on `/assets/*`**, **no-cache on HTML**,
    `.mjs` forced to `text/javascript`, `/assets/*` never falls back to index.html
    (missing asset = clean 404), JSON access logs → stdout (`docker compose logs web`).
    It no longer terminates TLS — `pharos-caddy` does that and proxies here.
  - `canary-api` — FastAPI/uvicorn, non-root (`canary` user), slim image from
    **`backend/requirements-serve.txt`**, DuckDB read-only per request, H3 pre-baked.
- Server data (mounted read-only into `api`, paths unchanged from the old box):
  - `backend/data/canary.duckdb` — the compacted derived DB (only DB on the server)
  - `backend/data/processed/` — only `claims.json` + `freshness.json` belong here;
    the rest of local `processed/` is benchmark intermediates that stay on the laptop
  - `backend/data/raw/overture_places/` — ~4MB slice for `/api/places/search`
- Server env (`/home/deploy/canary/.env`, chmod 600 — never in git):
  **`SITE_ADDRESS=:80`** (see gotcha 10), `VITE_MAPTILER_KEY`, `SUPABASE_URL`/`SUPABASE_KEY`
  (anon), optional slots wired in compose: `SUPABASE_SERVICE_KEY`,
  `ANTHROPIC/OPENAI/GEMINI_API_KEY`, `STADIA_API_KEY`.
- **Off-site archive**: `/home/deploy/canary-archive` (~18GB) is the copy of the raw
  archive that used to live on the CPX11. It duplicates the laptop's
  `backend/data/raw`, and it is the only off-site copy of it. Don't delete it casually.

## Sharing the box with Pharos

Canary and Pharos are separate businesses on one machine. The division is deliberate:

- **Networks.** `canary-api` is on `canary_internal` **only** and cannot resolve or reach
  any Pharos container — verified, and enforced by Docker not routing between bridges.
  Only `canary-web` joins `canary_edge`, whose sole other member is `pharos-caddy`.
  That one hop is the entire seam between the two projects.
- **Ceilings.** Both services carry `mem_limit`/`cpus` and 50m×5 log caps, so neither
  project can starve or disk-fill the other.
- **What NOT to touch**: anything under `/home/deploy/pharos` or `/home/deploy/pharos-admin`,
  any `pharos-*` container, and the ~120GB Docker build cache (it's Pharos's; pruning it
  silently slows Freddy's next production build). Server infra is Freddy's domain.
- **The shared edge**: `pharos-caddy` terminates TLS for `canarylayer.com` and proxies to
  `canary-web:80`. Its config is `/home/deploy/pharos/Caddyfile` — untracked in Freddy's
  repo, bind-mounted read-only, and hot-reloadable. **Back it up (`Caddyfile.bak-<stamp>`,
  the house convention), `caddy validate`, then `caddy reload`** — never recreate the
  container, which would take Pharos down. A failed validate/reload leaves the running
  config untouched, so a bad block cannot break Pharos.

## Where the data actually lives

The move to a shared box changed the data story, so be precise about it. Nothing here
is served from the laptop, and nothing large is rebuilt on the server.

| Artifact | Size | Laptop | EX44 | Notes |
|---|---|---|---|---|
| `backend/data/raw/` — the raw archive | ~17 GB | **yes, primary** | as `/home/deploy/canary-archive` | 59 source dirs. Partially non-refetchable. |
| `canary.duckdb` — derived layer | 900 MB local / **443 MB compacted** | yes | yes, compacted only | The only DB on the server. |
| `claims.json`, `freshness.json` | ~60 KB | yes | yes | The only two files from `processed/` that belong on the server. |
| `overture_places/` | ~4 MB | yes | yes | Backs `/api/places/search`. |
| Everything else in `processed/` | ~17 MB | yes | **no** | Benchmark runs and intermediates. Server has no use for them. |
| User contributions | — | no | no | Supabase, external to both. |

Two consequences worth internalising:

- **The archive now has two copies**, laptop and EX44, and they were verified identical
  (58 dirs, 454 files) at the 2026-08-12 migration. That is the off-site backup the old
  R2-vs-B2 debate was about, and it costs €0 because the disk was already paid for. It
  is not automatically synced — re-run the copy after a big capture if you want it current.
- **The server is disposable; the data is not.** The EX44 holds nothing that could not be
  rebuilt from git plus the laptop — *except* that it is now the second copy of the
  archive. Losing the box costs a rebuild. Losing every copy of `data/raw` costs the moat.

Disk is not a constraint: ~265 GB free, plus ~120 GB of reclaimable Docker build cache
behind that. The archive could grow many times over before this matters. **Don't prune
that build cache** — it's Pharos's, and clearing it silently slows Freddy's next build.

## The routine: "commit, push, redeploy"

Code now travels by **git**, not rsync/tar — the server is a real clone. `SSH=...` is
just shorthand for the connection below.

```bash
SSH="ssh -i resources/claude_pharos_mel deploy@144.76.58.207"

# 0) hygiene: review what's staged; never commit .env / *.duckdb / data/raw / data/logs
#    resources/, research/ and *.pptx are gitignored — keep it that way (gotcha 12).
git status --short
git add -A && git commit && git push

# 1) code → server
$SSH 'cd /home/deploy/canary && git pull --ff-only'

# 2) small data artifacts, only when they changed. ONLY these two files.
scp -i resources/claude_pharos_mel \
  backend/data/processed/claims.json backend/data/processed/freshness.json \
  deploy@144.76.58.207:/home/deploy/canary/backend/data/processed/

# 3) DuckDB, only when the pipeline rebuilt it — COMPACT first (halves it), then atomic swap
backend/venv/Scripts/python.exe -c "import duckdb; c=duckdb.connect(); \
  c.execute(\"ATTACH 'backend/data/canary.duckdb' AS src (READ_ONLY)\"); \
  c.execute(\"ATTACH 'backend/data/canary_compact.duckdb' AS dst\"); \
  c.execute('COPY FROM DATABASE src TO dst')"
scp -i resources/claude_pharos_mel backend/data/canary_compact.duckdb \
  deploy@144.76.58.207:/home/deploy/canary/backend/data/canary.duckdb.tmp
$SSH 'mv -f /home/deploy/canary/backend/data/canary.duckdb.tmp \
  /home/deploy/canary/backend/data/canary.duckdb && \
  chmod a+r /home/deploy/canary/backend/data/canary.duckdb'
rm -f backend/data/canary_compact.duckdb

# 4) restart. READ GOTCHA 11 BEFORE ADDING --build OR `docker compose build`.
$SSH 'cd /home/deploy/canary && docker compose up -d'

# 5) verify (127.0.0.1:443 is pharos-caddy, which holds the cert)
$SSH 'for p in / /api/catalog /api/sf/neighborhoods \
  /assets/maplibre-gl-worker.mjs /assets/maplibre-gl-shared.mjs /assets/nope.js; do \
  curl -s --resolve canarylayer.com:443:127.0.0.1 -o /dev/null \
  -w "%{http_code}  %{content_type}  $p\n" https://canarylayer.com$p; done'
```

Sharper than the curl above, because it skips TLS and the outer proxy and asks the inner
Caddy directly — use it to localise a fault to the image vs the shared edge:

```bash
$SSH 'docker run --rm --network canary_edge curlimages/curl -sS -D- -o /dev/null \
  http://canary-web/assets/maplibre-gl-worker.mjs'
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
4. **Ghost files are now git's problem, not yours.** *(Retired 2026-08-12.)* This used to
   read "`rsync --delete` always", because without it locally-deleted `.tsx` files ghosted
   on the server, `tsc -b` type-checked them, and the build failed on code that no longer
   existed. `git pull` deletes removed files by construction, so the whole class is gone.
5. **No rsync on the Windows dev machine.** Git Bash ships `tar`, `ssh` and `scp` but not
   `rsync`. This no longer affects code (git handles that) — it only matters for the data
   pushes, which use `scp`. Note the **servers** both have rsync: for box-to-box copies,
   `ssh -A` from the laptop and let them talk directly rather than relaying 18GB through
   a home connection twice.
6. **Frontend-only deploys are safe and sometimes required.** The `web` image needs
   only `frontend/` and root `*.md` (Dockerfile copies nothing from `backend/`), so
   you can ship docs and UI without touching the API: `docker compose build web &&
   docker compose up -d web`. This is still the right move while the API-gating
   prerequisites are outstanding (gotcha 11) — a full rebuild would activate
   `require_key` and 401 the live map. Done this way 2026-07-31: prose and figures both
   v2 on prod, `api` untouched.
7. **The work laptop lies about prod (RELEX).** On VPN the domain is blocked outright
   (ERR_CONNECTION_CLOSED). Off VPN, corporate SSL inspection (issuer "Retail Logistics
   Excellence - Forward Trust CA") breaks curl/openssl from the laptop. Only trust
   server-side checks: `curl --resolve canarylayer.com:443:127.0.0.1 ...`. The
   user-level truth test is a phone on cellular.
8. **Headless ground truth on the server.** `docker run zenika/alpine-chrome` against
   the site (chmod 777 the output dir first — Chrome runs non-root). `--screenshot`
   fires at DOM load, far too early for the map; add `--virtual-time-budget`. Run it on
   the `canary_edge` network against `http://canary-web/` — no DNS or TLS needed.
   Caveat learned 2026-08-12: the documented "definitive signal" of `/api/sf/*` hits in
   the api log did **not** fire under this harness even on a fully-rendering map, so it
   is not a reliable pass/fail on its own. **Look at the screenshot.** A rendered
   basemap + UI is the real evidence; a 7KB all-white PNG is the failure.
9. **No schedulers on the work laptop** (RELEX security flagged the launchd ratchet
   2026-07-29; removed). Until an off-laptop runner exists, refresh manually:
   `cd backend && ./venv/bin/python -m app.ingestion.refresh` — staleness is visible at
   `/api/freshness`.
10. **`SITE_ADDRESS` must be `:80` on this host — never the domain.** `pharos-caddy`
    terminates TLS and proxies to `canary-web` over plain HTTP. Set a hostname here and
    the inner Caddy enables auto-HTTPS, races for its own cert behind a proxy that
    already has one, and 308-redirects `:80`→`:443` into a loop. Relatedly: **never add
    a `ports:` block to Canary's compose** — `pharos-caddy` owns host 80/443.
11. **The API gate will 401 the whole site if you rebuild carelessly.** Every commit
    from `bfbbc7c` onward wraps the data routers in `Depends(require_key)`. With
    `SUPABASE_SERVICE_KEY` unset it fails **closed**: every `/api/*` returns 401, and
    since all the map's fetches live inside `map.on('load')`, you get a blank map with
    **no console error** — indistinguishable from gotcha 1, different cause.
    Production therefore runs **pinned pre-gate images** (`canary-api:pregate-20260730`,
    `canary-web:75df17b`), transplanted during the 2026-08-12 host move. `docker compose
    up -d` uses them as-is. Before you ever `--build`, either set
    `CANARY_DEV_OPEN_API=1` in `.env` (restores today's open behaviour) or issue real
    keys (`backend/scripts/issue_api_key.py` + `SUPABASE_SERVICE_KEY`) **and** add
    `VITE_CANARY_ANON_KEY` as a build arg to the `web` service — it is not plumbed in
    today, so the bundle would ship an empty key even after keys exist.
    Rebuilding from `master` also ships the landing page and the commute mock, which
    reports **synthetic ETAs as real** whenever `STADIA_API_KEY` is blank (the provider
    default is `"mock"`). Ship those deliberately, never as a migration side effect.
12. **`git add -A` nearly published an SSH key.** `resources/` holds the live Pharos
    private key and was untracked but unignored until 2026-08-12. `resources/`,
    `research/` and `*.pptx` are now in `.gitignore` — if you ever see them in
    `git status`, stop and fix the ignore rules before committing.

## Costs and backups

- Total burn: domain ~$11/yr, plus Canary's share of a box that already existed. The
  €12/mo CPX11 is gone as of 2026-08-12 — **that was the entire point of the move.**
- `backend/data/raw` is ~17 GB and partially non-refetchable. It now has a second copy at
  `/home/deploy/canary-archive` on the EX44 (~18 GB, free — the box has ~280 GB spare).
  That is the off-site backup the old R2-vs-B2 debate was about; it costs nothing because
  the disk is already paid for. The archive is the company: losing a server loses
  nothing, losing every copy of the data folder loses the moat.

## First-deploy-from-scratch (server rebuild)

On the shared EX44 there is no bootstrap step — Docker, the firewall and the edge proxy
already exist. Rebuilding Canary from nothing is: `git clone` to `/home/deploy/canary`,
`scp` the `.env` (chmod 600, `SITE_ADDRESS=:80`), push the DuckDB and the two `processed/`
files, `docker network create canary_edge && docker network connect canary_edge
pharos-caddy`, `docker compose up -d`, then append the `canarylayer.com` block to
`/home/deploy/pharos/Caddyfile` and `caddy validate && caddy reload`.
The old single-box walkthrough (`deploy/bootstrap-server.sh`, 2GB swap for small-box
builds, Caddy self-provisioning its own cert) is in this file's git history.
