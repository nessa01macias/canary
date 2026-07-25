# DATA SOURCES — SF-first (research pass, 2026-07-25)

Where the change-layer inputs (permits, zoning, POI churn, licenses, 311, reviews) actually
come from, for San Francisco specifically, plus what comparable products (Localize.city,
Local Logic, Opportunity Atlas) build on. Firecrawl was used to research this page itself;
most of the sources below are **structured APIs**, not scrape targets — Firecrawl is the
right tool for the marketing/methodology pages, not for pulling the underlying data.

## 1. City of San Francisco — DataSF (Socrata / SODA API)

Base pattern for every dataset below: `https://data.sfgov.org/resource/{id}.json`
(add `?$limit=50000&$$app_token=...` for volume; an app token is free, registration only,
raises the anonymous rate limit). CSV/GeoJSON export also available per dataset.

| Dataset | Resource ID | Why it matters |
|---|---|---|
| Building Permits | `i98e-djp9` | The core "what's approved to be built" signal — DBI permit tracking system, addenda/routing/inspection status included. |
| 311 Cases | `vw6y-z8j6` | Noise, blight, street conditions — proxy for neighborhood friction/velocity. |
| Registered Business Locations | `g8m3-pdis` | Business open/close churn (SF's own version of the Overture/FSQ POI-diff signal), pulled daily. |
| Eviction Notices | `5cei-gny5` | SF Rent Board filings since 1997 — displacement/gentrification-pressure signal, exactly the kind of "regret" data the forum mining flagged. |
| Police Incident Reports (2018–present) | `wg3w-h783` | Crime trend — historical series (2003–2018) is a separate dataset (`tmnf-yvry`) if backfill depth matters. |
| Zoning Map — Zoning Districts | `3i4a-hu95` | Current zoning designation per parcel; `Historic Zoning Maps` (`ekvb-kch8`) if we need rezoning-over-time. |
| Assessor Historical Secured Property Tax Rolls | `wv5m-vpq2` | Parcel-level property values/characteristics back to 2007 — SF's rough equivalent of NYC's ACRIS. |

Other useful entry points:
- **SF Planning Housing Dashboard** (sfplanning.org/san-francisco-housing-dashboard) — pre-aggregated construction/entitlement activity, good for sanity-checking our own numbers.
- **"Permits in My Neighborhood"** (sfplanning.org/resource/permits-my-neighborhood) — the exact "what's approved near this address" UI Localize.city and our future-layer thesis are both aimed at; worth a UX teardown.
- **data.sfgov.org** is Socrata-hosted, so the same SODA query patterns work for every dataset on the portal — a single small client can hit all of them.

## 2. Multi-jurisdiction commercial permit data

- **Shovels.ai** — already the plan per CONTEXT.md. Covers **2,450+ jurisdictions, ~85% of US population** (updated from the ~2,000-jurisdiction figure in the earlier handoff — check current plan pricing at `docs.shovels.ai/docs/knowledge-base/getting-started/pricing-structure` before committing budget). Buys us permit data outside SF for free when we expand metros, at the cost of DataSF's free-and-direct advantage inside SF.
- Recommendation: use **DataSF directly for SF** (free, no rate-limit-driven cost, and DataSF is the ground truth Shovels itself normalizes from) and reserve Shovels for the second metro, where a from-scratch scrape isn't worth building.

## 3. POI / business churn (the Overture / Foursquare layer)

- **Overture Maps Places** — released monthly as cloud-native GeoParquet on S3 (`registry.opendata.aws/overture/`); `pip install overturemaps` gives a CLI for bounding-box download (`overturemaps download --bbox=...`). No auth needed. This is the "monthly diff" mechanism the thesis leans on.
- **Foursquare OS Places** — `huggingface.co/datasets/foursquare/fsq-os-places`, dated releases (`dt=2026-07-09/...`), Apache 2.0, downloadable as Parquet by region or queried via a limited API (50 POIs/request). Cross-referencing Overture vs. FSQ open/close timestamps for the same SF POIs is a cheap way to validate our own churn signal before trusting it.

## 4. What the comparables actually run on

- **Localize.city (NYC)** — built on NYC's own open-data equivalents of the above: **DOB** (Dept. of Buildings — permits, violations, complaints; NYC's version of `i98e-djp9`), **ACRIS** (Automated City Register Information System — property records/deeds back to 1966; NYC's version of the Assessor rolls), and **311**. Confirms the pattern: every metro has a DOB-equivalent + a recorder-equivalent + 311, and the "expansion cost" is mapping each new city's portal to the same schema, not finding new categories of data.
- **Local Logic** — explicitly a **public + proprietary + partner** blend, "100 billion+ location data points" across POIs, schools (US/Canada split, sourced differently per country), demographics (Census-derived), and 18 hand-designed "location scores." No trajectory/change signal in their public docs — confirms the CONTEXT.md read that they sell packaged *state*, not *change*.
- **Opportunity Atlas** — NOT a scrape-replicable source. Built by Opportunity Insights (Chetty et al.) from **restricted-access Census/IRS administrative tax records** inside a Federal Statistical Research Data Center; the public site only serves pre-aggregated tract-level outputs. Useful as methodology precedent and as a possible enrichment layer (their public data can be joined in), but not as a data-collection pattern to copy — that pipeline isn't ours to rebuild.

## 5. Freshness reality-check (confirmed against live metadata, 2026-07-25)

Pulled `https://data.sfgov.org/api/views/{id}.json` for each DataSF dataset above — that
endpoint returns `rowsUpdatedAt`, the timestamp of the city's own last ETL run, so this is
not a guess:

| Dataset | Last updated (city's own pipeline) | Real cadence |
|---|---|---|
| Building Permits | 2026-07-24 | **Daily** |
| 311 Cases | 2026-07-24 | **Daily** |
| Eviction Notices | 2026-07-24 | **Daily** |
| Police Incident Reports | 2026-07-24 | **Daily** |
| Registered Business Locations | 2026-07-24 | **Daily** |
| Zoning Districts | 2026-07-24 | **Daily** (re-published even though it rarely changes) |
| Assessor Tax Rolls | 2026-06-26 | **~Monthly/annual** (property tax rolls are set periodically, not daily, by nature) |

**Takeaway: SF's core change-layer signals are already daily-fresh at the source.** The job
isn't to make them fresher than the city — it's to poll daily and never let our copy lag
behind theirs. That's a solved problem (below), not an open one.

## 6. Livability layers: walkability, crime rate, schools, parks, transit, climate

These are the categories flagged as missing. Each has a very different natural freshness —
forcing all of them to be "live" would be manufacturing false freshness on data that doesn't
actually change day to day (a park doesn't move; a school rating updates once a year with
test scores). The useful distinction is *live where the real world is live, stable where the
real world is stable*:

| Category | Best source | Real cadence | Notes |
|---|---|---|---|
| **Walkability** | Compute it ourselves from Overture/FSQ POI density + OSM street network (open-source isochrone routing, e.g. Valhalla) | **As fresh as our own POI pull (monthly)** | Walk Score's own API is commercial and, underneath, just a function of POI proximity — we already have the POI layer, so buying it back from them is redundant. EPA's National Walkability Index exists as a free national dataset but is a periodic government release (years between updates, block-group level) — fine as a cross-check, not as the primary signal. |
| **Crime rate/trend** | SFPD Incident Reports (`wg3w-h783`, daily, see above) normalized by Census population denominators | **Daily** raw incidents; trend computed by us | Don't buy a third-party "crime score" (CAP Index, CrimeGrade) — those are themselves derived, static/annual, and proprietary. Raw incidents + our own rolling-window trend computation is fresher and is literally the "trajectory not snapshot" thesis applied to crime. |
| **Schools** | CA Dept of Education / data.ca.gov "California Public Schools" dataset (enrollment, free) for facts; NCES Common Core of Data (free, national, annual) for locations/IDs | **Annual** (tied to the school year / CALPADS reporting cycle — cannot be faster, ratings are a once-a-year artifact) | GreatSchools' API is **paid** ($52.50/mo base, $0.003/call beyond 15k) and is the only place to get their 1–10 rating and reviews — CDE/NCES give facts and enrollment for free but not a consumer-friendly "rating." Attendance boundaries (which school an address feeds into) come from NCES SABS, but the national survey is stale (last full round 2015–16) — SFUSD's own current boundary files are the reliable source for SF specifically. |
| **Parks** | SF Rec & Park Properties (`gtr9-ntp6`, DataSF) for SF; Trust for Public Land ParkServe (national, free downloads at tpl.org/park-data-downloads) for the 10-minute-walk-to-a-park metric elsewhere | **Static/slow** (park inventories change on the order of years, when a new park opens — an event, not a cadence) | This is a backbone/reference layer by nature. Update it opportunistically (e.g. quarterly), not daily — trying to poll it more often buys nothing. |
| **Transit access** | 511.org SF Bay Open Data Portal — bulk GTFS (static schedule) **and GTFS-Realtime** (trip updates, vehicle positions, service alerts) | **GTFS-Realtime is genuinely live (seconds-level)**; static GTFS is updated on each schedule change | This is the one category where "live" is literally true and free, no paid API needed. If a "transit access / service reliability" feature ships, this is the source. |
| **Climate/flood risk** | First Street Foundation API (`docs.firststreet.org/api`) | **Periodic model releases** (paid, licensed — this is the same First Street data Zillow added then removed after agent pushback, per CONTEXT.md) | Treat as optional/enterprise-tier enrichment, not a v1 dependency — it's commercial, and CONTEXT.md already flags the political sensitivity of negative area data with portals. |
| **Demographics (denominators only, never output)** | US Census ACS API (`census.gov/data/developers`), tract/block-group level | **Annual** (1-year and 5-year rolling estimates) | Per CONTEXT.md's design constraints, this is calibration/denominator input only (e.g., turning raw crime counts into a per-capita rate) — race/ethnicity/income must never appear in outputs. |

## 6b. Short-term rentals (Airbnb) — don't scrape airbnb.com, use the existing proxies

Checked directly: Airbnb's Platform Rules (`airbnb.com/help/article/2908`, section 11.1) explicitly
say **"Do not scrape... Do not use bots, crawlers, scrapers"** — a hard ToS prohibition, and
Airbnb has pursued legal action against scrapers before. Not worth building against directly,
especially with compliant alternatives sitting right there:

| Source | What it gives | Cadence | Terms |
|---|---|---|---|
| **Inside Airbnb** (`insideairbnb.com`) | Per-listing detail (price, room type, host, lat/long, neighbourhood), full booking calendar, and review-level data (review dates → **review velocity**, which is already on CONTEXT.md's signal list) for SF | **Quarterly snapshot** (latest: 2026-06-14) — a direct file download, not a live scrape | Data itself is **CC BY 4.0** (free, last 12 months). It's an activist project (housing/community advocacy) — their community guidelines ask requestors not to re-scrape their site, not to republish raw listings, and to attribute. Fine for computing **derived features** (STR density per neighborhood, trend) for our own model; treat "republish the raw rows in our commons" as out of scope without talking to them first — it cuts against their stated mission and they screen archived-data requests by intended use. |
| **AirDNA** (`airdna.co`) | Licensed occupancy/ADR/revenue estimates, has its own API (`apidocs.airdna.co`) | Reportedly frequent (their business) | Commercial, paid ($34–150+/mo consumer tiers; enterprise API pricing separate) — the "just pay for it, ToS-compliant" option if Inside Airbnb's quarterly cadence or non-commercial framing is too limiting. |
| SF's own STR registry (`api.sfgov.org`, Office of Short-Term Rentals) | Registered-host verification | N/A | **Checked and ruled out**: the API's terms restrict use to *"verifying Registered Short-Term Rentals"* by hosting platforms (i.e., it's how Airbnb/VRBO check a listing's registration is legit) — not a general-purpose open dataset. No public "list of registered STRs" dataset exists on DataSF the way there is for businesses. |

Recommendation: Inside Airbnb for v1 (free, real per-listing/review data, matches the
project's open-commons instincts) — pulled quarterly alongside the other slow/backbone
layers, used to compute an STR-density/velocity feature rather than re-published raw.

## 7. Still open

- Reddit/forum mining is blocked at the Firecrawl level (see `backend/app/scraping/sources.py`) — unresolved if forum mining resumes priority.
- Review velocity (Yelp/Google) — API access terms not yet checked; likely the hardest source to get cleanly (ToS bans on ML training per CONTEXT.md legal-stack note).
- Archive-backfill depth (Wayback Machine for Overture/FSQ history pre-2023/2024) — CONTEXT.md's open question, not addressed by this pass.

## Suggested next step

Three different ingestion cadences, not one pipeline:

1. **Daily job — the actual "live" layer**: a `datasf.py` client (plain `requests`/SODA API,
   not Firecrawl — these already return clean JSON) pulling Permits, 311, Evictions, Crime,
   Business Locations, incrementally via SODA's `$where=updated_at > :last_run` filters so
   each run only fetches what changed. This is where "as updated as possible" is genuinely
   true and free.
2. **Monthly job**: Overture Places + Foursquare OS Places pulls, diffed against the prior
   month to compute POI open/close churn — and our own walkability score recomputed from
   the refreshed POI layer.
3. **Slow/backbone layer, refreshed opportunistically (quarterly or on demand)**: schools,
   parks, zoning reference boundaries, Census denominators — these change in the real world
   on the order of months to years, so polling them daily would be simulating freshness that
   doesn't exist.

Say the word and I'll build #1 first — it's the piece that makes the trajectory thesis real.

---

# ACQUISITION STATUS (2026-07-25) — California first

Machine-readable source of truth: **`backend/data/sources_registry.json`** (regenerate with
`python -m app.ingestion.registry --export`). This section is the human companion.

## Fetch protocol (how the engine is organized)
Every source is one module under `backend/app/ingestion/` exposing a `SourceSpec` and a
`fetch()`. `fetch()` produces **L0**: `data/raw/<key>/<source_as_of>/` + `metadata.json`
(two-date rule: `source_as_of` = the source's own freshness, `fetched_at` = our pull) +
an append to `data/raw/manifest.jsonl`, with sha256 per file. Re-running is idempotent and
date-driven — a new snapshot dir appears only when the source itself advances. `stage()`
(L0 → L1 parquet, H3 assignment, row-level `event_time`/`source_as_of`/`ingested_at`) is the
mapping/processing layer's job, not the fetch layer's. Shared machinery: `app/ingestion/base.py`
(Snapshot, ArcGIS-REST paginated GeoJSON, Socrata, CKAN, freshness probes).

## Acquired (on disk now, all dated)
| key | geography | temporal shape | as_of | note |
|---|---|---|---|---|
| datasf_permits | SF | event_stream | 2026-07-24 | 672MB — forward layer / construction |
| datasf_business_locations | SF | recurring_snapshot | 2026-07-24 | 113MB — biz churn, decades of backfill |
| datasf_crime | SF | event_stream | 2026-07-24 | 416MB |
| datasf_threeoneone | SF | event_stream | 2026-07-24 | multi-GB (since 2008) |
| datasf_evictions / zoning / assessor_rolls | SF | mixed | 2026-07-24 | assessor is Prop-13-capped (NOT market price) |
| ca_abc_licenses | CA | recurring_snapshot | 2026-07-24 | **daily** — liquor licenses, address-level |
| ca_caaspp | CA | reference_layer | 2024-10-09 | all-students file only (constraint #2: no protected-class subgroups) |
| calfire_fhsz | CA | reference_layer | 2011-01-01 | 2007/2011 vintage; **current 2024/25 FHSZ is a gap** (auth-gated) |
| ca_precinct_returns | CA | reference_layer | 2025-11-19 | 2024 General, precinct-level |
| census_tiger_ca | CA | reference_layer | 2025-09-22 | places+tracts+cousub+county → areas-builder crosswalk |
| insideairbnb | SF | recurring_snapshot | 2026-06-14 | quarterly; STR density + review velocity |

## Verified, fetch pending (planned in registry)
Overture Places (bbox extract via DuckDB, monthly, backfill loop = archive answer) · OSM
California (Geofabrik, daily, 1.32GB) · Foursquare OS Places (needs free HF token) · Cal-ITP
statewide GTFS (data.ca.gov CKAN) · 511 Bay Area GTFS + GTFS-RT (needs free api_key).
**Federal cluster (FEMA NFHL flood, FCC BDC broadband, EPA AQS/TRI/FRS, FRA crossings, FAA
noise, HIFLD facilities, USFS WUI)** — endpoints being verified; wire after.

## Needs a free key/token before it can run
- `census_acs_ca` → `CENSUS_API_KEY` in `.env` (tenure/turnover/age/value; no protected classes)
- `fsq_os_places` → Hugging Face token · `gtfs_511_bayarea` → 511.org api_key

## Forecasting target variable (for the property-value vision) — the real open-data pinch
Trajectory *features* are well-covered above. The *target* for a price model is the gap,
because Prop 13 makes CA assessor rolls useless as market price. Open paths to ground truth:
- **County deed/transfer records** — actual sale prices, public record, clunky per-county portals (property-level; ingest per committed metro).
- **FHFA House Price Index** — open, tract-level, repeat-sales, annual — good for validating area-level trajectory→price.
- **Zillow ZHVI** — free download, **license needs checking for commercial use**.
MLS and rent series stay gated. Fair-housing guardrail (24 CFR 100.85): forecast features
must carry no protected-class data or proxies — enforce as written model governance.

## True gaps (no open source wired yet)
utilities septic/well/gas (per-county health GIS) · parking regime (SF has datasets, not added) ·
STR *rules* vs activity (municipal code) · road/traffic noise (compute from DOT AADT + FHWA TNM).
Catalog-only rasters (fetch on demand, bbox-clip, never snapshot): NLCD canopy, USGS 3DEP,
PRISM, VIIRS, Landsat thermal.

## Ops (flagged by the architecture, not yet done)
`data/raw/` is the irreplaceable moat (the ratchet) and is gitignored — **back it up
off-laptop** (rclone → B2/S3; a few GB, pennies). A dead laptop should cost a rebuild, not
the accumulated history.
