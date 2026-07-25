# Trajectory Signal Validation v0 — San Francisco, July 2026

**What this is.** Test #1 from CONTEXT.md: is area trajectory computable from open data,
and does it match ground truth? This is the first pass: 7 neighborhoods with documented
2020-26 arcs, checked against the pipeline's per-dimension trajectory (trailing 12 months
vs the 12 before, z-scored against all SF neighborhoods).

**Method discipline.** Every claim has two layers: the *computed signal* (from
`canary.duckdb`, DataSF snapshots as_of 2026-07-24) and the *receipt* (the underlying
records themselves — permit numbers, business names, category decompositions). A signal
without a receipt is not cited. External narratives below are widely documented; press
citations should be attached (marked `[cite]`) before any external use.

**Reproduce:** `cd backend && make pipeline`, then the queries in `app/pipeline/trajectory.py`
and the receipts queries in this doc's git history.

---

## Case results

| Neighborhood | Dimension | Computed | Receipt (our data) | External narrative | Verdict |
|---|---|---|---|---|---|
| Treasure Island | permits_issued | +38%, z+1.0 | $79.4M 6-story **150-unit** residential (issued 2026-07-01); $40M **100% affordable, 100 units** (2026-01-05); $31M new construction; 20,000 yd³ grading | Multi-phase island redevelopment program, ~8,000 homes planned `[cite]` | **CONFIRMED** |
| Lakeshore | permits_issued | +156%, z+4.9 | Top permits: $6.5M golf maintenance building, $5M gatehouse, $1M parking expansion — **0 housing units** | Initially attributed to Stonestown redevelopment (~3,500 homes) — **wrong**: those permits aren't in the issued record yet | **CORRECTED** — signal real (capex surge), first narrative attribution false; caught by receipts |
| Tenderloin | crime_incidents | +11%, z+2.5 (city −8%) | Decomposition: Drug Offense 1,790→2,824 (+58%), Warrant +35%, **Assault flat** (1,109→1,134) | 2025-26 TL drug-market enforcement crackdowns `[cite]` | **CONSISTENT** — but the correct claim is "enforcement surged," not "crime surged" |
| Mission | biz_openings | −19%, z−1.3 | Named closures on record (retail, salons, labs — e.g. Beli SF, Boutique Salud Y Vida) | Documented Valencia St retail churn/closure wave `[cite]` | **CONSISTENT** |
| Financial District/South Beach | biz net churn | +235 net (city's top) | 1,666 opens vs 1,431 closes | Downtown recovery push, return-to-office `[cite]` | **CONSISTENT** |
| Bayview Hunters Point | permits_issued, biz net | −21.6% permits; −18 net biz (city's bottom) | — | Long-documented underinvestment pressure `[cite]` | **CONSISTENT** |
| Japantown | biz_openings | +38%, z+2.9 | Opened NAICS: mental-health practitioners (621330 ×7), physicians, restaurants | **No documented story found** | **LEAD** — model-surfaced, unverified; this category is the product |

**Scorecard: 1 confirmed with hard receipts, 4 consistent, 1 corrected, 1 lead.**

## The two most important findings are the two failures

1. **The Lakeshore correction.** The magnitude signal (+156%, z+4.9) was real, but the
   obvious narrative I attached to it was wrong — the spend is golf-course capex, not
   the famous mall redevelopment. Two lessons baked into the design now:
   (a) never ship a z-score without its underlying records — the receipt discipline is
   what separates us from vibes; (b) the per-dimension design already contained the
   tell: `units_approved_net` for Lakeshore was ~0. A composite "improving!" score
   would have laundered the error.

2. **The Tenderloin mechanism — now resolved in the pipeline.** Police incident data
   measures *police activity* in proactive categories (drugs, warrants) and *victim
   reports* in others (assault, burglary). The category mapping
   (`app/pipeline/crime_categories.py`) splits the metric, and the split **inverts the
   headline**: Tenderloin `crime_victim_reported` **−8.0%** vs `crime_enforcement`
   **+43.6%** (citywide: −18.7% vs +29.7%). A product reporting "Tenderloin crime +11%"
   would have been wrong in the direction that matters to a resident — and this is
   precisely the kind of error AI assistants answering from vibes will make, which
   makes it a prime 50-question-benchmark item. User-facing crime trends use
   `crime_victim_reported` only.

## Known limitations of v0

- **Business close-date lag**: registry closes trail reality; recent `biz_closings` undercount (openings are timely).
- **311 loaded post-v0** (8.79M cases, 2008→now): encampment complaints −31.7%, street
  cleaning −8.2%. The headline noise number (+61.9%) **failed its propensity check**:
  a hard step-change in 2026-03, concentrated in the `other_excessive_noise` catch-all
  (+145%) and the Mobile channel (+139% vs Phone +15%) — an app-flow change, not louder
  streets. The refined `threeoneone_noise_specific` metric (catch-all excluded) shows
  **+25.9%**, still elevated but honest. Third instance of the same lesson (biz close-lag,
  enforcement-vs-victim, now this): every 311/report-based metric measures *reporting*,
  and the pipeline must carry a propensity check before a trend ships.
- **Single snapshot**: no revision history yet; `source_as_of` discipline is in place, revisions accumulate from here.
- **Neighborhood grain**: 37 areas is coarse; hex-level (res 9) trajectories exist in the db but need per-hex volume gates before they're claim-worthy.
- Crime dataset starts 2018 (schema break); pre-2018 stitching not done.

## What would settle it further (in order)

1. **Forward predictions, written down now** (out-of-sample, check ~Jan 2027):
   - Treasure Island `units_approved_net` stays top-3 citywide (build-out continues).
   - Stonestown-driven Lakeshore residential permits appear in the issued record within 12 months (units_approved_net spikes).
   - Tenderloin drug-offense counts fall back toward baseline if/when the operation winds down, while assault stays flat — distinguishing enforcement pulse from underlying change.
2. **Price cross-check**: regress our 2023-24 trajectory dimensions against 2024-26 FHFA tract-level HPI once ingested (leakage-free via `source_as_of`).
3. **The 50-question AI benchmark**: these receipts are checkable facts; draft questions directly from them ("How many housing units were approved on Treasure Island in the last 12 months?") and score ChatGPT/Gemini/Perplexity against the record.

---
*Generated 2026-07-25 from pipeline snapshot 2026-07-24; per-dimension only — no composite
neighborhood scores, by design constraint (facts with citations, no quality labels).*
