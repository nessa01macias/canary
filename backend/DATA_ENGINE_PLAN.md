# The Canary Data Engine — from hackathon ratchet to production pipeline

*2026-07-26. Answers six planning questions: what data we have, what models the past
supports, whether forecasting is honest yet, the news/agents layer, cadence, storage.
Internal doc (backend/ on purpose — root .md files get globbed into the public site).*

---

## 1. What we have, classified by modeling value

**A. Event streams with deep history — the modeling gold (~18M dated, located events)**
| series | span | rows | monthly panel depth |
|---|---|---|---|
| building permits | 1901→ | 1.29M | ~1,500 months (usable density ~1980→) |
| business registry | 1849→ | 364K | decades (interval entities: open/close) |
| fire/EMS calls | 2000→ | 7.4M | ~320 months |
| 311 cases | 2008→ | 8.8M | ~220 months |
| evictions | 1997→ | 48.7K | ~355 months (sparse per-hex; pool to nbhd) |
| crime incidents | 2018→ | 1.05M | ~90 months (schema break at 2018) |
| planning/entitlements | 1974→ | 54K | lifecycle entities (filed→decided) |

**B. Recurring snapshots accruing — diffable state (the young part of the moat)**
POI: Foursquare 20 monthly snapshots (2024-12→) + Overture (2026-06→, prunes its own
history — our copies are already irreplaceable). Daily: ABC liquor, DCC cannabis.
Prop-D vacancy roll (annual filings, daily-refreshed). Inside Airbnb (quarterly).

**C. Reference/context — features, not series**
Flood, fire hazard, schools+CAASPP, GTFS transit, trees, parking, TRI, ACS (tract),
TIGER, precincts, OSM (compute substrate). Slowly-varying; joined per area.

The unit of everything: **(h3_9 | neighborhood) × metric × month**, every row carrying
`source_as_of` → point-in-time-correct panels, leakage-free backtests by construction.

## 2. Models the past already supports (ranked by value ÷ risk)

1. **Trajectory v2 — changepoints + seasonality** (upgrade of the shipped slopes).
   STL-deseasonalize each area×metric series; Bayesian/CUSUM changepoint detection →
   "the noise regime on this block changed in Mar-2026," not just a slope. Kills
   summer-artifact false positives. *Data: ample. Effort: days. Risk: low.*
2. **Leading-indicator panel models — the forward layer's empirical teeth.**
   Panel regressions / event studies with area+month fixed effects on 1,114 hexes ×
   90–220 months: what happens to business openings 6/12/24mo after a permit cluster?
   Do liquor/cannabis licenses lead 311 noise? Do eviction spikes lead crime? Output:
   "areas like this, after events like this, historically did X" — cited, ranged.
   *Data: tens of thousands of area-months. Effort: 1–2 wks. This is the differentiator.*
3. **Count forecasting per area** (permits, 311, crime volumes; 3/6/12mo horizons).
   Gradient boosting / SARIMA with lags + calendar + leading indicators from (2);
   hierarchical pooling h3_9→h3_8→neighborhood for sparse cells. Ship ONLY with
   backtest receipts (walk-forward, point-in-time features). *Feasible now for dense
   series at neighborhood grain; hex grain via pooling.*
4. **Transition/regime classifier** (early-gentrification signature) — label
   historical transitions retrospectively, learn the early signature. ⚠️ Governance
   gate before building: outputs must stay factual-regime ("activity accelerating"),
   never a quality/desirability label; features audited (no protected classes or
   proxies — written rule, 24 CFR 100.85). *Defer until (2) exists.*

## 3. Forecasting: enough data? Honest answer per target

- **Event counts (permits/311/crime/EMS):** YES at neighborhood grain (90–320 months);
  hex grain needs pooling. Start here.
- **POI churn:** 20 months — trend yes, seasonal forecast models no (need 24–36).
  Accrues monthly; revisit spring 2027.
- **Prices — the missing target:** assessor is Prop-13-useless. Unlock order:
  1. **FHFA tract-level HPI** (free, annual, repeat-sales) — pull NOW (~30 min);
     immediately enables the receipt CONTEXT.md wants: *"do our 2023 trajectory
     metrics predict 2024–26 tract HPI better than a naive baseline?"*
  2. **Zillow ZHVI** (neighborhood, monthly, free download) — internal validation;
     license review before anything commercial.
  3. **County deed/transfer records** — the real property-level target; per-county
     ingestion project, schedule with metro #2.
- **Rule:** we forecast counts of public-record events and validate area price
  *direction*; we do not ship property price predictions until deeds exist.

## 4. The news layer (new acquisition class — agents)

**Why:** fills the unstructured gaps (T6.2 school-boundary politics, T6.7 CEQA
narratives, T6.9 CIP/bonds), gives the "why" cards narrative color, and creates
area-grain citable context no AI can currently retrieve (same aggregation gap the
benchmark proved for stats).

**Design (provenance-first, hallucination-hostile):**
- L0: `news_raw/<outlet>/<date>/` — article markdown + URL + content-hash via
  Firecrawl (search + scrape). Outlets: SF Chronicle/SFGate, SF Standard, Mission
  Local, Hoodline, SFist, Oaklandside/Berkeleyside (metro #2 prep), planning/board
  agendas.
- Extraction: LLM → structured rows `(area, event_type, event_time, claim_summary,
  verbatim_quote, url)`. **A news item is a CLAIM, not a record** — separate
  evidence tier, never mixed into metrics; rendered as "reported context" with
  outlet citation; verbatim quote stored for auditability.
- Area assignment: gazetteer (neighborhood names/aliases/landmarks) + geocoding of
  street mentions → h3.
- **Cadence:** daily light sweep (RSS/sitemaps of ~8 outlets, dedupe by hash, only
  extract new); weekly deep fan-out (parallel agents: 41 neighborhoods × query
  templates). Cost control: extraction only on new hashes; weekly cap.
- **Pilot before fan-out:** 3 neighborhoods (Mission, Bayview, Japantown — one loud,
  one industrial, one quiet) × 30 days backsearch → measure extraction precision +
  cost per usable claim. Scale only if precision > ~85% on human spot-check.

## 5. Cadence (mostly built — promote it)

Exists today: tiered refresh (daily/weekly/monthly/quarterly), as-of-probe dedupe,
launchd 07:00 with wake-catchup, attributes+pipeline+publish chained, freshness
manifest + `/api/freshness`. Additions:
1. **Move the runner off the laptop** — GitHub Actions cron (or the Hetzner box):
   checkout → restore raw/ from B2 → refresh → sync back → publish. Laptop becomes
   a dev cache, not the single point of failure.
2. **Alerting:** freshness manifest already computes overdue — add a check step that
   fails the run (→ email/Slack) when any `daily` source is >48h stale.
3. News tiers: daily sweep / weekly fan-out (above). GTFS-RT (真 live) only when a
   reliability feature ships.

## 6. Storage

- **Compute core stays DuckDB + Parquet** (laptop-scale through all-CA; Postgres only
  as L4 serving mirror — already the Supabase split).
- **B2/S3 becomes the PRIMARY raw store** (rclone hook already in refresh.sh; needs
  the one-time `canary-backup` remote). Growth math: weekly full archives ≈
  7GB/week ≈ 360GB/yr raw — fine, but add **zstd at rest** for rows.csv (~5–10×
  → ~50GB/yr; DuckDB reads .csv.zst natively).
- **Panels as products:** export the long metrics table + a training panel parquet
  per release; `pipeline_version` (git sha) on every row (already) + **model registry
  table**: `(model_id, trained_at, features_as_of, metrics_json)` and a
  **predictions table**: `(area, metric, horizon, yhat, lo, hi, model_id)` — forecasts
  become receipts, backtestable forever, same citation discipline as facts.
- News: new L0 class + `events(source='news', record_url=article)` claims tier.

## What this plan is FOR (the Canary mapping — read CONTEXT.md v5 first)

This is not generic data engineering; every output maps to the canon:

**Open-core split (existential — license design):**
- **Commons (open, free, complete):** cited events, computed historical trends,
  trajectory v2, the freshness manifest. Things that can't be wrong, only sourced.
- **Paid tier:** count forecasts + intervals, leading-indicator effect estimates,
  freshness SLAs, commercial API. A forecast is an opinion with error bars —
  opinions live behind the paywall so the commons stays the truth-teller.

**Buyer mapping (why each model exists):**
- Trajectory v2 + leading indicators → **buyer #1, AI answer engines** (the grounding
  feed; extends the benchmark story from "models are wrong" to "here's the corrected
  answer with receipts").
- Construction-pipeline + vacancy trajectory panels → **buyer #2, insurers** (the
  ZestyAI-adjacency feature set).
- FHFA/ZHVI validation receipt → **buyer #3, RE data licensing/AVMs** ("our forward
  features beat backward comps" is the pitch; the receipt is the proof).
- Count forecasts → developers/land (#4), later.

**Revenue surface: NOT decided — and the engine doesn't care.** (Canon check: the
$29 report was a working draft Melany was never sold on; founder confirmed 2026-07-26
it's not being built now. Do not resurrect it as "the plan.") Every model output
lands in the same L3/prediction tables, so whichever surface eventually charges —
report, API feed, MCP, licensing — reads identically. What items 3+5 buy regardless:
the magic-moment sentence *"this permit cluster, in areas like this, historically
meant X within 24 months"* — usable in outreach demos today, sellable through any
surface later. The build order ARMS the H3/H4 outreach (v5's #1 action); it never
postpones it.

**The Canary-only model (add to the list): resident-layer calibration.** Contributions
were designed to land as (area, metric, period, direction) — they are ground-truth
LABELS for exactly our known biases (311 = reporting propensity, registry close-lag,
POI supplier churn). Propensity-correction models trained on contributions are a
workstream nobody else can run, because nobody else has the labels. Blocked only on
contribution volume — design is done, gate is live.

**Honesty note on news:** unlike everything else here, news is NOT ratchet data —
archives exist, a 2028 competitor can backfill it. Its value is gap-filling (T6.2/
T6.9), narrative color, and agent-legible context. It must not borrow the moat
argument in any pitch.

**Standing discipline from the canon, applied to models:** every report-based metric
gets a propensity check before shipping (crime = victim-reported vs enforcement;
311 = the Mar-2026 app-flow artifact); no composite quality scores ever; no
protected-class features or proxies (written governance rule, 24 CFR 100.85).

## Build order (value ÷ effort, lanes)

| # | what | lane | effort |
|---|---|---|---|
| 1 | FHFA HPI pull (+ ZHVI internal) — the forecast target | acquisition | ~½ day |
| 2 | Runner off-laptop (Actions/Hetzner + B2 primary + alerting) | acquisition/ops | 1 day |
| 3 | Trajectory v2 (deseasonalize + changepoints) | pipeline | days |
| 4 | News pilot (3 nbhds, precision+cost gate) → then fan-out | acquisition+agents | 2–3 days |
| 5 | Leading-indicator panel study (permits→biz, licenses→noise) | pipeline/modeling | 1–2 wks |
| 6 | Count forecasts w/ walk-forward receipts | modeling | 1 wk after 5 |
| 7 | HPI validation receipt ("2023 metrics → 2024-26 HPI") | modeling | days after 1 |
| 8 | Transition classifier (post governance gate) | modeling | later |

Standing rule inherited from v1: every new artifact carries `source_as_of` +
`fetched_at`; news claims additionally carry verbatim quote + URL. Nothing ships
without its receipt.
