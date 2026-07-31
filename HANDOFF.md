# Handoff to the next chat (laptop switch)

**Internal working note. NEVER ships to the site** (the frontend only imports
ABOUT.md, RESEARCH.md, SOURCES.md). Written 2026-07-30 at the end of a long
session, so a fresh Claude Code chat on a new machine can continue with context.
The `.claude/` memory and the plan file do NOT travel with a laptop swap; this
file and the repo do. Read this plus **CONTEXT.md** (strategy canon) first.

To start the new chat: point it at this file ("read HANDOFF.md and CONTEXT.md").

---

## Who you're working with

Melany Macías, co-founder of Canary. She is a **software + AI engineer who also
runs GTM** — do not assume she is "just a developer," and do not assume the other
founder (Katerina) is the business person. Both founders sell. This was a real
friction point; respect it.

- **Pre-revenue and genuinely broke right now.** RULE: do not make any paid API
  calls (model calls, etc.) without asking her first. Local compute and free
  tiers are fine.
- **Writing style:** no em-dashes, no AI-coded staccato ("X. Y. Z." fragments).
  RESEARCH.md is academic register; ABOUT.md is plain human voice. Shipped prose
  should read like a person wrote it.
- **Prior startup (Pharos)** died of buyer poverty (marketed to authors/publishers
  who had no budget). This shapes every revenue discussion: screen for buyers who
  already pay. Do not pitch her an idea with no clear payer.
- **Deploy/commit discipline:** commits are local and fine; **never push or deploy
  without an explicit "deploy" / "push."** She corrected this explicitly.

## What Canary is (one paragraph)

"The change layer of the physical world": area-level trajectory (how a
neighborhood is changing, per dimension) + a forward layer (what construction is
already approved), computed from public records with a citation on every number.
One engine, two surfaces: a free consumer map + address reports, and a paid API
for AI apps / portals / institutions. Full strategy in **CONTEXT.md**. Design
constraints are non-negotiable (no commission revenue, no protected-class data,
facts-with-citations only, consumers never pay long-term, agent-legible from day
one).

## Lane split (avoid file collisions)

Two Claude chats work this repo in parallel:
- **Other chat:** `backend/app/ingestion`, `backend/data/raw`, originally
  `backend/app/api`. Also did the recent frontend refactor (`src/` reorganized
  into `components/ lib/ map/ styles/`; `App.css` split into `src/styles/*.css`).
- **This chat (you):** `backend/app/pipeline` downstream, the benchmark
  (`backend/app/benchmark`), the research paper + docs, the ForAgents page, and —
  as of this session — the **API auth work** (Melany moved the API lane here for
  that). If you keep touching `backend/app/api/*`, `main.py`, `db.py`, or the
  frontend `src/lib/*`, make sure the other chat is off those files.

## Where things stand (this session's work)

**1. AI benchmark v2 — DONE and canonical.** (commit `e12fbc5`, conclusions
`009b9ec`, sweep `db6ff4c`.) 136 checkable SF-neighborhood questions, frozen at
`d891dac` and independently verified against the city's own APIs *before* any
model ran (one bad item, q039, caught and dropped pre-run). Five frontier models
(Claude Fable 5, Grok 4.5, GPT-5.6 Sol, GPT-5 search, Perplexity sonar-pro).
Results: **unassisted 25-47%, grounded (one Canary response) 95-99%**, every
McNemar p between 1e-13 and 1e-27; confidently-wrong up to 89/135 (Grok).
**Key finding new at scale:** the temporal in-training-window control fell from
95% (v1 pilot) to **37%** — the deficit is *unpublished computation, not
recency*; live search scored lowest (25%). Cross-vendor judge panel kappa 0.95,
no self-preference. The v1 pilot (43q) is superseded but kept in git.
- Disclosed caveats (all in RESEARCH.md): OSF registration did NOT precede this
  run (git-freeze only; the OSF-registered run is the *next* regeneration); a
  mid-run network drop reduced two cells' coverage (reported over exact
  denominators); 3/2,443 verdicts unparsed-excluded.
- Harness: `backend/app/benchmark/` — `generate_v2.py`, `run.py` (has `--resume`
  for network recovery), `judge.py` (has `--repair` + 429/529 backoff), `panel.py`
  (`--agree`), `stats.py`. Env: `BENCH_FILE=benchmark_v2.json
  BENCH_RUNS=benchmark_runs_v2`. Figures: `scripts/gen_figures.py` (reads
  `BENCH_FILE`).
- **Any doc still showing "43 questions" or "37-49%" is stale** — those are the v1
  pilot numbers. Canonical is 136 / 25-47% / 95-99%. Enforced mechanically as of
  2026-07-31: `venv\Scripts\python.exe scripts/check_research_consistency.py` from
  `backend/` runs 37 checks of ABOUT/RESEARCH/BENCHMARK against the frozen
  artifacts (block table, per-block accuracies, verdict counts, panel,
  verification, stale-marker greps) and exits 1 on any drift. Run it after
  touching a shipped doc; add a check whenever you publish a new derived number.

**2. Research note v2 — shipped to the frontend.** RESEARCH.md is the paper (arXiv
styling via `frontend/src/styles/docs-paper.css`, margin stamp says "v2"). Two
figures with Wilson-CI whiskers in `frontend/public/research/`. The v2
pre-registration is **PROTOCOL_V2.md** (SF-only, 150-target design; the next
OSF-registered regeneration completes it with replicates, contamination stratum,
human baseline, Gemini, open-weights).

**3. "For AI apps" page (ForAgents) — rebuilt.** (`53a6816`, `ea807ea`.)
`frontend/src/components/ForAgents.tsx`. Endpoint-picker UX (report / trajectory /
ask), a corner **copy icon that copies each endpoint as agent-ready markdown**.
Audience is AI apps/agents ONLY (not pricing/institutional — that's outreach
material, see the ICP tiers Melany pasted in chat, not page copy). Placeholder CTA
email `hello@canary-placeholder.example` still needs replacing before deploy.

**4. API Phase 1 — gating DONE, not yet live.** (commit `bfbbc7c`.) The API had
*zero* auth; the Bearer token on the site did nothing and the advertised
`/api/mcp` did not exist. Now:
- `api_keys` + `api_usage` tables in `supabase/schema.sql` (RLS service-role only;
  sha256 hash stored, plaintext shown once).
- `backend/app/api/auth.py`: `require_key` dependency, 60s in-process key cache,
  per-key rate limit, fail-closed.
- Two tiers: anon/publishable key (frontend build, Origin-locked by CORS) +
  partner secret keys. `main.py` mounts `require_key` on all data routers
  (`/health` open) and locks CORS to canarylayer.com + dev.
- Frontend: `src/lib/api.ts` `apiFetch` injects `X-API-Key`; all 12 `/api`
  fetchers routed through it; `VITE_CANARY_ANON_KEY`.
- CLI: `backend/scripts/issue_api_key.py` (issue/revoke; its hash matches the
  verifier — checked).
- Removed the false `/api/mcp` claim from ForAgents (returns with Phase 3).
- Verified: `/health` 200, data endpoints 401 without a key, frontend builds.

**API Phases 2-3 (pending, no paid calls needed):**
- **Phase 2:** durable per-key metering + daily quota. `api_usage` table already
  exists. Add `store.record_usage(prefix, endpoint)` fire-and-forget; quota check
  in `require_key`; fold the `/ask` IP throttle into the per-key path.
- **Phase 3:** a real `/api/mcp` streamable MCP server (tools: area_report,
  area_trajectory, list_metrics) calling the same `db.py` functions; require a
  key; check `requirements.txt` for the `mcp` SDK. Restore the ForAgents MCP claim
  when it lands.

## Melany's open manual steps (hers, not yours)

- **Before the API gating can go live** (do in this order or the live map 401s):
  (1) run the new `api_keys`/`api_usage` DDL in the Supabase SQL editor; (2)
  ensure `SUPABASE_SERVICE_KEY` is set on the backend server; (3) issue the anon
  key (`cd backend && venv\Scripts\python.exe scripts/issue_api_key.py --label
  "web app" --tier anon`) and set it as `VITE_CANARY_ANON_KEY` in the build; (4)
  issue partner keys as needed. Deploy backend + frontend together after that.
- Grade the judge audit CSV: `backend/data/processed/benchmark_audit_sample.csv`
  (37 rows, fill `human_agrees` y/n) → becomes the judge's published error bar.
- Create an OSF account so the *next* benchmark regeneration can be pre-registered
  before any query.
- Replace the ForAgents placeholder email before public deploy.
- Redeploy canarylayer.com when ready (currently shows pre-v2 numbers; see the
  canary-deployment memory / DEPLOY.md for the playbook).

## Environment gotchas

- **The dev machine is now Windows 11** (migrated 2026-07-31 from the RELEX
  MacBook — see "Machine migration" below). Paths in older notes that read
  `./venv/bin/python` or `/Users/melany.macias/...` are Mac-era; translate them.
- Python: from `backend/`, run **`venv\Scripts\python.exe …`** (Windows) — the Mac
  `./venv/bin/python` does not exist here. Bare `python` is the system 3.14, not
  the venv, so always use the explicit venv path. Benchmark modules run via
  `-m app.benchmark.x`; standalone scripts (issue_api_key, gen_figures, verify_*)
  run as `venv\Scripts\python.exe scripts/x.py` from backend/.
- Pipeline: `make pipeline` (raw → staged parquet → canary.duckdb). The Makefile
  auto-selects the right interpreter per platform. GNU make 4.4.1 is installed via
  winget (`ezwinports.make`); if `make` is missing from a fresh shell it is a PATH
  refresh, not a missing install. The API holds read-only DuckDB connections;
  heavy pipeline writes and the API can contend.
- Two dependency pins are Windows-adjusted in `requirements.txt`: `uvloop` is
  Unix-only and now carries a `sys_platform != 'win32'` marker (uvicorn falls back
  to the asyncio loop, no functional loss), and `websockets` was loosened from
  `==16.1.1` to `>=12,<17` because the hard pin was unsatisfiable alongside the
  supabase SDK. Do not re-pin either without testing on Windows.
- Never ship internal docs to the site: CONTEXT.md, DEPLOY.md, DATA_SOURCES.md,
  PROTOCOL_V2.md, this file. Only ABOUT/RESEARCH/SOURCES are imported by Docs.tsx.
- Scheduler rule, corrected 2026-07-31: the no-persistence ban was specific to the
  **RELEX-managed MacBook**, where corporate security flagged a launchd job. This
  Windows machine is personal, so local automation is not a security problem here.
  Off-laptop (Hetzner box / GitHub Actions) is still the better home for the
  refresh runner, for uptime reasons rather than policy ones.

## Canonical references (all travel with the repo)

- **CONTEXT.md** — strategy canon (thesis, hypothesis ledger, competitors,
  naming). Read before strategic suggestions.
- **RESEARCH.md** — the v2 paper. **PROTOCOL_V2.md** — v2 pre-registration.
- **BENCHMARK.md** — results snapshot. **ABOUT.md** / **SOURCES.md** — shipped
  public docs.
- **DATA_CONTRACT.md**, **DATA_ENGINE_PLAN.md** — pipeline/data contracts (other
  chat's).
- Competitors to watch: mireye.com (YC, hazard/terrain API+MCP, "Plug into the
  earth" dev page), VOYGR (YC, place-level venue freshness). Both adjacent, not
  head-on; Canary's differentiator is the *change* layer + bitemporal dates.

---

# Deployment lane (appended by the deployment chat, 2026-07-29)

The deployment chat owns everything around shipping canarylayer.com: the Hetzner box,
Docker/Caddy, DNS, the redeploy routine, and prod debugging. Its full canon is
**DEPLOY.md** (rewritten 2026-07-29 to current truth — live infra, the
commit-push-redeploy playbook, and all seven hard-won gotchas: MapLibre worker chunks,
the slim serve image, repo-root build context, rsync --delete ghosts, the RELEX
network lying about prod, headless-Chrome ground truth, no-schedulers-on-laptop).
Read DEPLOY.md before any deploy on the new machine.

## ✅ Machine migration — COMPLETE (2026-07-31)

The move off the RELEX MacBook is done. Kept here as the record of what was
carried and where it now lives; the checklist itself no longer needs doing.

1. **SSH key** — `id_ed25519` (+ .pub) now at `C:\Users\PC\.ssh\`, verified against
   root@5.78.144.35. Still the only key the server trusts; Hetzner web console is
   the fallback if it is ever lost.
2. **The three gitignored env files** — restored to `.env`, `backend/.env`,
   `frontend/.env`. All real keys live here and none are in git.
3. **`backend/data/`** — recovered from `/opt/canary-archive/data` on the Hetzner
   box (18 GB: 17 GB raw + `canary.duckdb` + `staged/` + `processed/`), which is
   where the old laptop had staged it. That server copy is the only off-laptop
   backup of the raw archive; do not delete it until a real backup exists.
4. **Dev environment** — `backend/venv` rebuilt (see the Windows dependency notes
   under "Environment gotchas"), `frontend` `npm ci` clean, production build green,
   GNU make installed.
5. The migration bundle that carried the secrets (`canary-migration/`) was verified
   byte-for-byte against every restored file and then deleted. `.gitignore` still
   blocks that path so a future bundle cannot be committed by accident.

## State at handoff (deployment lane, 2026-07-29)

- Server runs the **Jul 26** build + DB; commits since (ForAgents rebuild, **API
  gating `bfbbc7c`**) are NOT deployed. **Verified live 2026-07-31 and worse than
  it looks:** the JS bundle carries the *v1* paper (43 questions, Claude 49% →
  100%) while `/research/*.svg` serves the *v2* figures (25-47% → 95-99%), because
  Docs.tsx inlines the markdown at build time but `frontend/public/` is served
  statically. Prose ships on a rebuild; figures ship the moment the directory
  syncs, so the two halves of the paper can drift on production. The public
  Research tab is currently self-contradicting and should not be sent to anyone
  until a rebuild lands. The API-gating deploy has manual
  prerequisites — see "Melany's open manual steps" above; deploying backend+frontend
  without them 401s the live map.
- Server containers healthy; `STADIA_API_KEY` not set on the server (commute shows "—").
- Open deployment threads: off-laptop pipeline runner (Hetzner cron or GH Actions) to
  replace the dead laptop ratchet; raw-archive backup (16GB now exceeds the R2 free
  tier — Hetzner Object Storage or B2 when funded); `/api/explain` LLM endpoint (env
  slots wired server-side, endpoint not built — cache + rate-limit it when it lands).
