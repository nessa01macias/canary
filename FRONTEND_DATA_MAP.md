# Frontend ⇄ Backend data map (audited 2026-07-25, rev 2)

What every frontend surface **requires**, and how the current backend provides it
(or doesn't yet). Companion docs: [`ARCHITECTURE.md`](ARCHITECTURE.md) (how data
flows), [`backend/FRONTEND_DATA_CONTRACT.md`](backend/FRONTEND_DATA_CONTRACT.md)
(the acquisition→staging contract: source → pattern → effort → what it unlocks).

**rev 2:** acquisition chat landed **29 L0 sources**; pipeline staged 311 + crime
splits (15 metrics now) and ships a precomputed `trajectory` table. The API reads
that table as the single source of truth, and `/api/report` now has the
`attributes` block (contract pattern 3). Most 🔴s below became 🟠s — the gap is
staging, not acquisition and not endpoints.

Status legend:
- 🟢 **wired** — flows end-to-end through `/api/*` today
- 🟡 **in DuckDB** — in metrics/events/trajectory tables; needs only an API field
- 🟠 **raw landed** — snapshot in `data/raw/`; needs its `stage()` step (pipeline lane)
- 🔵 **needs compute** — raw landed but requires a real compute layer (routing…)
- 🔴 **no source yet**

---

## 1. What the frontend renders today, and what feeds it

| Surface | Requires | Fed by | Status |
|---|---|---|---|
| Permit markers + detail drawer | enriched permits (change-story, stage, units, cost) | `GET /api/sf/permits` (DataSF live, server-side enrichment) | 🟢 |
| Neighborhood choropleth + descriptors | polygons + per-hood aggregates | `GET /api/sf/neighborhoods` | 🟢 |
| Pulsing improving/declining overlay | investment + crime trend | live permits + `trajectory` table (`pct_change`, rank-normalized) | 🟢 real |
| Preference **fit** overlay + best-fit list | per-hood score per chip | `GROUNDED_TAGS` over baked signals | 🟢 for **5** chips, rest ignored |
| "Review a neighborhood" (moat, write) | contribution write path | `POST /api/contributions` → Supabase (RLS) | 🟢 |
| Resident layer (moat, read) | k-anon review aggregates | `GET /api/resident-layer` (per-area + per-hex, n ≥ 3) — **endpoint live, no UI yet** | 🟡 UI gap |
| *(built, unused by UI)* address report | changes + trajectories + **attributes** for a point | `GET /api/report` — now includes the `attributes` block | 🟡 UI gap |
| *(built, unused by UI)* biz open/close markers | located place events | `GET /api/changes?category=business` | 🟡 UI gap |

**Baked per-neighborhood signals** (real, from the pipeline's `trajectory` table,
rank-normalized 0..1, `source_as_of` stamped): `intensity`, `crimeTrend`,
`bizOpenTrend`, `bizCloseTrend`, `evictionTrend`, `noiseTrend`.
Metrics staged but not yet surfaced as signals: `crime_enforcement`,
`crime_victim_reported`, `threeoneone_cases/cleaning/encampment/noise_specific`,
`permits_filed`, `permit_cost_issued_usd` — all one `TREND_METRICS` line away. 🟡

---

## 2. The onboarding chip catalog: requirement → provision

32 chips in `PREFERENCE_TIERS` (App.tsx). Only `GROUNDED_TAGS` chips rank the map;
the rest are **ignored, never faked**.

### Wired now 🟢 (5)
| Chip | Real signal |
|---|---|
| Low crime | `1 − crimeTrend` (crime_incidents, 12-vs-12mo) |
| Quiet | `1 − noiseTrend` (311 noise complaints — **new**, staged today) |
| Business openings | `bizOpenTrend` |
| Vacancy trend | `1 − vacancyRate` (REAL Prop-D roll since 2026-07-25: latest *complete* tax year, blanks excluded, no zero-fill; `vacancyRateRaw` ships alongside the rank so surfaces render rate+rank together. Known debt: the H3 spine uses Inside Airbnb boundaries vs the map's DataSF polygons — `/api/report` now returns `attributes_area` so the card badges which area the facts describe; unifying the spine on DataSF polygons is the real fix) |
| New construction | `intensity` (live permits) |

### One API-field away 🟡
| Chip / feature | Signal already in DuckDB |
|---|---|
| a "Stability" chip (doesn't exist yet) | `evictionTrend` — baked into properties, unconsumed |
| sharper safety split | `crime_victim_reported` vs `crime_enforcement` |
| street cleanliness / encampments | `threeoneone_cleaning` / `threeoneone_encampment` |

### Raw landed — needs its stage() step 🟠 (pipeline lane; order per contract)
| Chip | Source on disk | Contract effort |
|---|---|---|
| Fire risk | `calfire_fhsz` | tiny (reference join → report `attributes`) |
| Flood risk | `fema_nfhl_flood` | tiny (same) |
| Good schools | `ca_caaspp` + `datasf_sfusd_boundaries` | small |
| Parking | `datasf_rpp_zones` + `datasf_parking_meters` | tiny |
| Away from industry | `epa_tri_ca` | tiny |
| Rezoning | `datasf_planning_records` + `datasf_dev_pipeline` | small — **the forward layer / magic moment** |
| Liquor & cannabis | `ca_abc_licenses` + `ca_cannabis_retailers` | small (daily-cadence signal) |
| Tree canopy | `datasf_street_trees` | small |
| Road projects | `datasf_sfmta_projects` | small |
| Fast emergency response | `datasf_fire_ems_calls` (7.4M) | medium |
| Groceries & retail | `fsq_os_places` + `overture_places` | medium (snapshot diffs) |
| Renters vs owners / Age mix | `census_acs_ca` | small (tract→h3 crosswalk exists) |
| Low property tax | `datasf_assessor_rolls` | small |
| Transit access | `gtfs_ca_statewide_calitp` | medium (stop density/frequency) |
| Political lean | `ca_precinct_returns` | small — ⚠️ review vs design constraint #2 first |

### Needs a compute layer 🔵 / no source 🔴
| Chip | Why |
|---|---|
| Walkable 🔵 | `osm_california` landed (1.3GB) but needs a routing/score engine — defer |
| Short commute 🔴 | needs isochrone routing |
| Home prices 🔴 | Prop 13 → needs deeds/FHFA (already flagged unavailable in UI) |
| Clean air / rail noise 🔴 | no source |
| Broadband & cell 🔴 | FCC BDC pending |
| School bus / urgent care 🔴 | no source |

**Tally: 5 🟢 · 8 🟡 (signals in DB, unconsumed) · 15 🟠 (staging away) · 1 🔵 · 6 🔴.**

---

## 3. Standing recommendations

1. **The UI still overpromises** — many chips say `available: true` with nothing
   wired; picking only those changes nothing on the map. Kat's call: disable
   ("soon") or trim for the demo.
2. **Highest value per staging hour** (contract's order, endorsed): reference
   attributes (fire/flood/school/parking/TRI → report `attributes` block, which
   is **already live and auto-exposes new `areas` columns**) → planning/dev-pipeline
   (the magic moment) → ABC/cannabis daily diffs → FSQ backfill.
3. **Free UI wins, no new data:** render `/api/report` (magic-moment surface,
   still unconsumed), business open/close markers, a Stability chip off
   `evictionTrend`.
4. **The pattern for every new chip:** metric staged → one `TREND_METRICS` line
   (backend) → one `GROUNDED_TAGS` line (frontend). `crimeTrend` is the template.
