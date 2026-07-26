# The Canary Data Contract — ETL law for one city or the whole world

*2026-07-26. The constitution: what every layer must contain, what is MANDATORY,
and the rules that survive scaling from SF → cities → countries, where inputs get
arbitrarily messy. Companion: ARCHITECTURE.md (flow), DATA_ENGINE_PLAN.md (models),
data/sources_registry.json (the machine-readable source list — always current).*

---

## -1. What the user is paying attention to (the contract exists to serve THESE)

Every table, field, and rule below must serve at least one of the five user
questions; anything that serves none is out:

1. **"What's coming near this address?"** — the forward chain, INCLUDING its
   earliest tier: `announcement → permit → license → construction → opening`.
   An announced anchor tenant moves value before any record exists (receipt:
   each Starbucks entry ≈ +0.5% ZIP home prices, HBS/Luca — and movers use
   anchor-tenant proxies, per forum validation).
2. **"Is this area improving or declining?"** — trajectory, per dimension, cited.
3. **"What is it like now?"** — grounded attributes with as-of dates.
4. **"What do residents say?"** — contributed layer, k-anonymous.
5. **"Can I check that?"** — every displayed item traceable to its evidence in
   one click.

## 0. The one idea that makes world-scale possible

**The vocabulary is global; the mess is local.** Every jurisdiction on earth publishes
permits, business registrations, complaints, crimes, licenses — in a thousand formats,
languages, and coordinate systems. We never normalize the world into one schema by
force; we map each local source into a SMALL, FIXED set of canonical shapes and
vocabularies. New geography = new *mappings*. Schema changes = governance events
(rare, deliberate, reviewed).

Three canonical shapes cover everything that exists:
- **events** — things that happened at a time and place
- **places** — things that exist over an interval (open → closed)
- **areas** — the spatial spine (H3 hexes — already global, zero schema change for Tokyo)
plus **metrics** (the product: aggregates) and **claims** (news tier, quarantined).

## 1. The ETL, precisely

```
E  fetch()   source → L0 data/raw/<source>/<source_as_of>/…  (files EXACTLY as published)
T  stage()   L0 → L1 staged parquet   (typed, deduped, geocoded→h3, 3 timestamps)
T  build     L1 → L2 canonical        (events | places | areas)
L  metrics   L2 → L3 long table       (area × metric × period, cited)
L  publish   L3 → L4 serving          (DuckDB → Supabase/JSON → /api/*)
```

- **E never transforms.** Messiness is *preserved* at L0 (so re-cleaning is always
  possible), *killed* at L1, *forbidden* at L2+.
- **Everything below L0 is derived and rebuildable.** Full-rebuild-every-run until
  rebuilds hurt. L0 is the only irreplaceable layer.
- Every source declares a `SourceSpec` (key, geography, temporal_shape, cadence,
  fmt, license, tier) **before** its first fetch; the registry is the single source
  of truth; freshness is judged mechanically against it.

## 2. Sources (current: 33; the list lives in the registry, not here)

Classes, so the doc doesn't rot: **municipal spine** (permits, business registry,
311, crime, evictions, fire/EMS, planning, zoning, vacancy — per-city, the expansion
unit) · **state** (licenses, schools, hazards, elections) · **federal** (flood, TRI,
census, HPI) · **open geo** (Overture, FSQ, OSM, GTFS) · **web claims** (news) ·
**contributed** (resident layer). Enumerate live:
`python -m app.ingestion.registry` or `GET /api/catalog`.

## 3. The tables and what is MANDATORY

Design law: the mandatory set is small enough that every jurisdiction on earth can
satisfy it, and rich enough that the product works. Everything else goes to `attrs`
(JSON, schema-on-read). **A row missing a mandatory field is dropped at staging —
loudly** (counted in staging stats, never silent).

### events — MANDATORY
| field | rule |
|---|---|
| `event_id` | deterministic hash(source, record_key, event_type) — ours, never the source's |
| `source` | registry key (FK to SourceSpec) |
| `event_type` | from the CONTROLLED VOCABULARY (§4) — never a raw local string |
| `event_time` | DATE, local civil date of the jurisdiction. **No time → no event.** |
| `h3_9` | resolved location. **No location → no event.** |
| `source_as_of` | the snapshot's own date (what was knowable when) |
| `ingested_at` | when we fetched it |

OPTIONAL: `lat/lon`, `record_key`, `record_url` (strongly encouraged — per-fact
citation), `detail`, `value` + `value_ccy` (**mandatory-if-monetary** — USD dies at
the first non-US metro), `units_delta`, `attrs` JSON.

### places — MANDATORY
`place_key` (ours) · `source` · `source_id` (theirs, kept for lineage) · `h3_9` ·
`active_from` (or first_seen) · `from_precision` ∈ {exact, snapshot} ·
`source_as_of` · `ingested_at`.
OPTIONAL: `name`, `category` (controlled vocab), local category code, `active_to`
(**always a lower bound** — businesses die before deregistering), `attrs`.

### areas — MANDATORY
`h3_9` (PK) · `h3_8`, `h3_7` (free rollups) · `country` (ISO 3166-1) ·
`admin1` (state/region code) · `city_key` (our metro slug).
OPTIONAL: `display_name` (neighborhood — DISPLAY ONLY, never compute on it),
reference attributes (flood_zone, …), `attrs`.

### metrics — MANDATORY (the product; nothing ships without all of these)
`area_id` · `area_level` · `metric` (controlled vocabulary §4) · `period` (DATE) ·
`period_grain` · `value` · `source` · `source_as_of` · `computed_at` ·
`pipeline_version` (git sha). OPTIONAL: `n`.

### claims (news/LLM/announcement tier — epistemic tier CLAIM, see §4b)
MANDATORY:
| field | rule |
|---|---|
| `claim_id` | deterministic hash(url, quote) |
| `event_type` | controlled vocabulary — announcements use the `announced_*` family (§4) |
| `claim` + **`quote` (VERBATIM)** + `url` + `outlet` | the evidence, always |
| `location_precision` | ∈ {point, block, neighborhood, city} — **stated, never inflated** |
| location at its stated precision | h3_9 ONLY if precision ∈ {point, block}; else area name. **Assigning a hex to a neighborhood-level claim is manufactured precision and forbidden.** |
| `status` | lifecycle ∈ {claimed, corroborated, materialized, expired, refuted} |
| `expires_at` | default per event_type (e.g. announced_opening: 18mo) — stale "coming soon" never haunts the map |
| `fetched_at` | |

OPTIONAL: `event_time` (the announced/expected date), `corroborating_event_id`
(the permit/license/POI record that later confirms it — the SAME-EVENT link).

### predictions (when models ship)
MANDATORY: `area_id` · `metric` · `horizon` · `yhat` · `lo`,`hi` · `model_id` ·
`features_as_of` · `computed_at`. Forecasts are receipts too.

## 4. Controlled vocabularies (the globalization mechanism)

Two small, fixed lists, owned like code:

- **event_type** (~30): permit_filed / permit_issued / permit_completed /
  business_opened / business_closed / license_issued / license_surrendered /
  eviction_filed / crime_incident / complaint_noise / complaint_blight /
  complaint_other / planning_application / zoning_change / transit_project /
  place_opened / place_closed / … plus the **announced_*** family (tier-zero forward
  events, always epistemic tier CLAIM): announced_opening / announced_closure /
  announced_development / announced_transit / announced_policy. Each `announced_*`
  declares which record event_types corroborate it (announced_opening →
  license_issued | permit_filed | place_opened).
- **Effect-relevance registry:** value-moving event types carry direction and, where
  literature exists, the effect size with its citation (anchor-tenant opening:
  ≈+0.5% ZIP, HBS/Luca). This is what makes the news layer a *revaluation signal*,
  not clippings.
- **metric** (~25): permits_issued / units_approved_net / biz_openings /
  biz_closings / crime_incidents / crime_victim_reported / threeoneone_noise / … —
  each with a written definition, polarity, and propensity-check status.

**Rules:** a new city MAPS its local types into these (one mapping table per
source, versioned). Adding a vocabulary entry = a governance event: written
definition + polarity + citation semantics + review. If two cities' concepts
don't fit one entry, the entry is too coarse — split it deliberately, never
per-city fork it.

## 5. THE RULES (numbered; cite them in reviews)

1. **L0 is immutable and append-only.** Never edited, never deleted. Everything
   below is derived and rebuildable from it.
2. **Two dates on every artifact, three timestamps on every row**
   (`event_time` ≠ `source_as_of` ≠ `ingested_at`). Re-fetching never makes data
   newer; revisions are visible because both dates survive.
3. **No time, no row. No location, no row.** Staging drops them — loudly, with
   counts in staging stats. Silent loss is forbidden.
4. **Citation is structural.** Every metric row carries (source, source_as_of);
   every claim carries (quote, url). A fact that can't cite itself doesn't ship.
5. **The vocabulary is global; the mapping is local.** New geography adds mappings,
   never schema. Schema/vocabulary changes are governance events.
6. **Local IDs never become our keys.** `source_id` is kept for lineage;
   canonical keys are deterministic hashes we own.
7. **Never trust source semantics.** Every report-based metric passes a propensity
   check before shipping (the 311 lesson). Every end/close date is a lower bound
   (the registry lesson). Every local category gets a mapping review (the POI
   supplier-churn lesson: require absence in 2 consecutive releases before
   emitting place_closed).
8. **Compute on hexes; display names are cosmetic.** Political polygons
   (neighborhoods) are crosswalks for humans, never units of computation. H3 is
   the same in Helsinki and Lagos — this is what makes the world addable.
9. **Forbidden data:** no race/ethnicity/income or proxies in any table, ever
   (constraint #2, 24 CFR 100.85). No composite quality scores in metrics
   (facts, never verdicts).
10. **Epistemic tiers are law: RECORD > CLAIM > CONTRIBUTED.** Every user-facing
    item wears its tier. Claims never aggregate into metrics AS FACTS — but they
    are first-class *forward events* with a strict promotion state machine:
    `claimed → corroborated` (a record event links via corroborating_event_id) `→
    materialized` (opening/completion observed) or `→ expired/refuted`. Promotion
    requires evidence, never vibes; the UI may show a `claimed` item only with its
    tier visible ("announced — unverified").
13. **No manufactured precision.** Every located row states its
    `location_precision`; a row may only join aggregations at or above its own
    precision (a neighborhood-level claim can appear on a neighborhood, never on
    a hex). Fake precision is lying with coordinates.
14. **One real-world event, many evidences.** The same development appears as an
    announcement, a permit, a license, a POI change — these are LINKED
    (same-event resolution), not shown as four things. The user sees one story
    with an evidence trail; lead-time between tiers is itself a signal we keep
    (how many months does news lead permits? → outlet credibility scoring).
15. **Independent location signals must AGREE.** A located claim carries two
    derivations of "where": the text's area attribution and the geocoded pin —
    they must concur on the H3 spine before the pin is kept. Disagreement
    demotes to the coarser truth AND flags for human review (either signal can
    be the wrong one). This is what catches the world's name collisions —
    San Jose's Japantown, the 700 block of Mission STREET (downtown, not the
    Mission), every city's Chinatown — and geocoder fuzzy-relocations
    (a geocode biased toward the home city must ECHO the input street back).
    Both failure modes occurred on day one of the pilot; neither survived the
    guard. Same epistemics as corroboration: agreement earns precision.
11. **License before fetch.** No source enters L0 without a recorded license;
    redistribution/share-alike flags are checked before anything is published.
    Monetary values carry currency; dates are local civil dates; coordinates are
    WGS84 by the time they leave staging.
12. **Freshness is proven, not claimed.** Every source's currency is probed from
    the source itself; `/api/freshness` publishes it; overdue is judged
    mechanically against declared cadence + pull tier.

## 6. Adding a city (the repeatable playbook — target: days, not months)

1. **Find the three universal primitives** every jurisdiction has: the
   permits/buildings authority, the recorder/assessor, the complaints line
   (311-equivalent) — plus police and licensing. (The Localize lesson: they always
   exist; only the portal differs.)
2. Write `SourceSpec`s + `fetch()` per source (protocol exists; most portals are
   Socrata/CKAN/ArcGIS — helpers already built).
3. Write the **mapping tables**: local event types → canonical vocabulary; local
   place categories → canonical categories.
4. Write `stage()` per source (pure function, L0→L1).
5. Extend the areas spine: city bbox → H3 cells + admin crosswalk (boundaries from
   the census bureau equivalent or OSM). No schema change — new rows only.
6. Run **propensity checks** on every report-based metric before it's enabled in
   the product for that city.
7. Assign pull tiers; export the registry. Metrics, serving, API, frontend need
   **zero changes** — routes are already geography-agnostic (bbox or H3 in, cited
   facts out).
8. **Onboard the claims tier** (tier zero of the forward chain): local outlet
   list (general press + the RE trade press), area labels + their spine-name
   aliases (the rule-#15 agreement guard ABSTAINS for unmapped areas — mapping
   them is what arms it), and the city name in the geocoder bias + prompt guard
   ("City of X only" — every metro has a Chinatown that isn't yours). The
   guards themselves are generic; only these parameters are local.

The definition of success for metro #2: no file outside `app/ingestion/` +
mapping tables + areas rows needed to change.
