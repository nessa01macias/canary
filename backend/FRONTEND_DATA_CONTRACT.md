# Frontend ↔ Data connection map (2026-07-25)

**The key fact: the API is already metric-generic.** `/api/trajectory?metric=X`,
`/api/report`, and `/api/catalog` read the L3 `metrics` table by name — new data needs
**zero new endpoints** in most cases. The gap is *staging*: 24 of 29 acquired sources are
L0-only (raw snapshots), and only 5 are staged into `canary.duckdb`, so the API can't see
them yet. **Connecting new data to the frontend = writing its `stage()` step, not new APIs.**

Chain: `L0 raw (acquisition chat, DONE) → stage() → events/places/areas → metrics (pipeline
chat) → existing API → frontend (Kat)`.

## What the frontend consumes today

| Frontend surface | Endpoint | Backed by | Uses new data? |
|---|---|---|---|
| Map pins (recent permits) | `GET /api/sf/permits` | live DataSF proxy | n/a (live by design) |
| Neighborhood trajectory overlay | `GET /api/sf/neighborhoods` | live DataSF aggregate | should later read L3 instead |
| Contribute form | `POST /api/contributions` | write-only | schema reshape flagged (see memory) |
| (built, unused by UI yet) | `GET /api/report`, `/api/trajectory`, `/api/catalog`, `/api/changes` | canary.duckdb L3 | **this is where new data lands** |

`REPORT_METRICS` today: units_approved_net, permits_issued, biz_openings, biz_closings,
crime_incidents, evictions_filed — all from the 5 staged DataSF sources.

## Three connection patterns (pick per source, by temporal_shape)

1. **event_stream → metric rows** — stage to `events`, count per (h3_9, month) → appears in
   `/api/catalog` automatically, `/api/trajectory` works immediately.
2. **recurring_snapshot → interval entities + derived events** — diff releases → place
   open/close events → metrics (same as pattern 1 after the diff).
3. **reference_layer → `areas` columns** — one spatial join per version; served as address/
   area *attributes* in `/api/report` (not time series). Needs a small `attributes` block
   added to the report response — the one genuinely new API surface.

## New L0 sources → what they unlock on the frontend, and how

| L0 source (ready now) | Pattern | Frontend feature it unlocks | Staging effort |
|---|---|---|---|
| datasf_planning_records (54k) | 1 | "Rezoning/entitlement filed 200m away" in report + map pins | small (CSV → events) |
| datasf_dev_pipeline | 2 | "1,200 units approved nearby, breaking ground next year" | small |
| datasf_commercial_vacancy | 2 | storefront-vacancy trend per neighborhood | small |
| datasf_fire_ems_calls (7.4M) | 1 | response-time metric per area | medium (big file) |
| ca_abc_licenses + ca_cannabis_retailers | 2 (daily diffs) | "3 liquor licenses filed on this block" (nightlife leading indicator) | small; needs geocoding (ABC) |
| fsq_os_places (+ backfill to 2024-12) | 2 | POI churn 2nd witness; grocery/pharmacy access attribute | medium |
| overture_places (2 releases) | 2 | POI churn 1st witness (pipeline chat already owns this) | theirs |
| fema_nfhl_flood | 3 | flood-zone attribute in address report | tiny |
| calfire_fhsz | 3 | fire-hazard attribute | tiny |
| datasf_sfusd_boundaries | 3 | school attendance area attribute | tiny |
| datasf_rpp_zones / parking_meters | 3 | parking-regime attribute | tiny |
| census_acs_ca (tracts) | 3 | denominators (per-capita rates); tenure/turnover attributes | small (tract→h3 crosswalk exists) |
| gtfs_ca_statewide_calitp | 3 + compute | transit access attribute (stop density / frequency) | medium |
| epa_tri_ca | 3 | industrial-facility proximity attribute | tiny |
| osm_california (1.3GB) | compute | walkability/sidewalk scores → attribute | large (routing engine — later) |
| insideairbnb | 2 | STR density/velocity per neighborhood | small |
| ca_precinct_returns, ca_caaspp, census_tiger_ca | 3 | school scores attribute; boundaries/crosswalks | small |

## Recommended order (max frontend value per staging hour)

1. **Reference-layer attributes** (flood, fire hazard, school area, parking, TRI proximity) —
   tiny joins, and the address report immediately gets its "hard binary filters" section.
2. **planning_records + dev_pipeline** — the forward layer IS the differentiator; report gets
   "what's approved to be built near this address" (the #1 forum fear, the magic moment).
3. **ABC/cannabis daily diffs** — first *daily-cadence* change signal on the map.
4. **FSQ backfill diffs** — 18 months of POI churn history → trajectory depth.
5. OSM compute layer — defer (needs a routing engine; biggest lift, attribute-only payoff).

Lane note: staging is the pipeline chat's lane. This doc + `data/sources_registry.json`
(machine-readable, has temporal_shape per source) are the contract. Every L0 snapshot has
`metadata.json` with source_as_of/fetched_at/sha256 — provenance flows into `metrics.source_as_of`
so every frontend fact stays citable (design constraint #3/#7).
