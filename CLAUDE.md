# Canary — working notes for Claude

Live place-intelligence for SF: a DuckDB derived layer served by FastAPI, a React +
MapLibre frontend, and a data pipeline that stays on the workstation.

**`DEPLOY.md` is the deployment canon. Read it before any deploy, redeploy, restart, or
server change — not after.** What follows is only the subset that causes silent outages.

## Deploying

Production is `deploy@144.76.58.207:/home/deploy/canary` — a Hetzner EX44 **shared with
Pharos, a separate live business.** Code ships by `git pull`, not rsync.

```bash
SSH="ssh -i resources/claude_pharos_mel deploy@144.76.58.207"
git add -A && git commit && git push          # see "Secrets" first
$SSH 'cd /home/deploy/canary && git pull --ff-only && docker compose up -d'
```

Then verify — `127.0.0.1:443` is `pharos-caddy`, which holds the cert:

```bash
$SSH 'for p in / /api/catalog /assets/maplibre-gl-worker.mjs /assets/nope.js; do
  curl -s --resolve canarylayer.com:443:127.0.0.1 -o /dev/null \
  -w "%{http_code} %{content_type} $p\n" https://canarylayer.com$p; done'
```

## Three ways to break production invisibly

1. **`docker compose build` without reading DEPLOY.md gotcha 11.** Every commit since
   `bfbbc7c` gates the data routers behind `require_key`, which **fails closed** when
   `SUPABASE_SERVICE_KEY` is unset: every `/api/*` returns 401. All the map's fetches
   live inside `map.on('load')`, so this surfaces as a **blank map with no console
   error** — identical to the MapLibre asset bug, so you will debug the wrong thing.
   Production therefore runs **pinned images** (`canary-api:pregate-20260730`,
   `canary-web:landing-*`). `docker compose up -d` uses them as-is. Frontend-only
   deploys (`build web`) are safe and are how the landing page shipped. **Never reuse
   an image tag** — it overwrites your rollback.
   Rebuilding `api` also activates the commute mock, which reports **synthetic ETAs as
   real** when `STADIA_API_KEY` is blank. Today the API honestly returns
   `routing_unconfigured`. Keep it that way.
2. **Changing `SITE_ADDRESS` from `:80`.** `pharos-caddy` terminates TLS and proxies to
   `canary-web` over plain HTTP. A hostname here makes the inner Caddy race for its own
   cert behind a proxy that has one, and 308-loop.
3. **Adding a `ports:` block.** `pharos-caddy` owns host 80/443.

Also: `/assets/*.mjs` must serve as `text/javascript`, `/assets/*` must never fall back
to `index.html`, and both `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` must
exist. All three fail silently. They live in `frontend/Caddyfile` — **don't touch it.**

## Sharing the box with Pharos

`canary-api` is on `canary_internal` only and cannot reach any Pharos container. Only
`canary-web` joins `canary_edge`, whose sole other member is `pharos-caddy`. That one
hop is the entire seam.

**Do not touch** `/home/deploy/pharos*`, any `pharos-*` container, or the ~120 GB Docker
build cache (it's Pharos's; pruning silently slows their next production build). The
shared `Caddyfile` is edited by backup → `caddy validate` → `caddy reload`, **never** by
recreating the container. Server infrastructure is Freddy's domain; tell him about
changes. Full detail in `resources/HANDOVER_FOR_MEL.md` §11.

## Secrets

`resources/` holds a live SSH private key. It, `research/` and `*.pptx` are gitignored —
this repo is **public**. `git add -A` once nearly published that key. After staging,
check `git diff --cached --name-only` before committing, and never stage files belonging
to work you didn't do.

## Environment

Windows 11 + Git Bash: **no `rsync`** — use `scp`/`tar`. Python is
`backend/venv/Scripts/python.exe`. Both *servers* do have rsync, so for box-to-box
copies use `ssh -A` and let them talk directly.
