# Where the data comes from

Every number in Canary traces back to a public record. This page lists every
source we read, with the exact link, how often we pull it, and the license it
is published under, so that anyone can reproduce the acquisition layer. Nothing
is scraped from private platforms; everything below is published by a
government agency or under an open license.

*33 sources live, 1 planned. Generated from the*
*machine-readable registry (`backend/data/sources_registry.json`); regenerate*
*with `python scripts/gen_sources_md.py`.*

## San Francisco (city records)

| Source | What it provides | Updated | License | Link |
|---|---|---|---|---|
| DataSF: 311 Cases | noise/blight complaints | daily | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/vw6y-z8j6](https://data.sfgov.org/d/vw6y-z8j6) |
| DataSF: Assessor Historical Secured Property Tax Rolls | price/value (Prop 13: NOT market price) | monthly | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/wv5m-vpq2](https://data.sfgov.org/d/wv5m-vpq2) |
| DataSF: Building Permits | forward layer / construction | daily | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/i98e-djp9](https://data.sfgov.org/d/i98e-djp9) |
| DataSF: Eviction Notices | displacement / gentrification pressure | daily | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/5cei-gny5](https://data.sfgov.org/d/5cei-gny5) |
| DataSF: Fire/EMS Dispatched Calls for Service | emergency response times (received->on-scene) | daily | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/nuek-vuh3](https://data.sfgov.org/d/nuek-vuh3) |
| DataSF: Parking Meters | parking regime | irregular | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/8vzz-qzz9](https://data.sfgov.org/d/8vzz-qzz9) |
| DataSF: Planning Department Records - Projects (PPTS successor) | rezoning / change-of-use / entitlement applications | daily | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/qvu5-m3a2](https://data.sfgov.org/d/qvu5-m3a2) |
| DataSF: Police Incident Reports 2018-present | crime/safety | daily | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/wg3w-h783](https://data.sfgov.org/d/wg3w-h783) |
| DataSF: Registered Business Locations | business open/close churn (decades of backfill) | daily | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/g8m3-pdis](https://data.sfgov.org/d/g8m3-pdis) |
| DataSF: Residential Parking Permit Eligibility Parcels | permit-parking zones | irregular | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/i886-hxz9](https://data.sfgov.org/d/i886-hxz9) |
| DataSF: SF Development Pipeline | entitlement->construction pipeline w/ net units | quarterly | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/6jgi-cpb4](https://data.sfgov.org/d/6jgi-cpb4) |
| DataSF: SFMTA Projects - Polygons | approved transit + road diets/closures | irregular | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/6ibt-jpn7](https://data.sfgov.org/d/6ibt-jpn7) |
| DataSF: SFUSD School Attendance Areas 2024-25 | school attendance areas (bus eligibility, boundary snapshot) | annual | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/e6tr-sxwg](https://data.sfgov.org/d/e6tr-sxwg) |
| DataSF: Street Tree List | tree canopy city inventory | daily | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/tkzw-k3nq](https://data.sfgov.org/d/tkzw-k3nq) |
| DataSF: Taxable Commercial Spaces (Prop-D Vacancy Tax) | storefront vacancy signal (filed flag) | daily | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/rzkk-54yv](https://data.sfgov.org/d/rzkk-54yv) |
| DataSF: Zoning Map - Zoning Districts | parcel/adjacent zoning | daily | Open Data Commons PDDL / public domain (DataSF) | [data.sfgov.org/d/3i4a-hu95](https://data.sfgov.org/d/3i4a-hu95) |
| FEMA National Flood Hazard Layer — flood zones | ArcGIS REST layer 28 (S_FLD_HAZ_AR); bbox-filtered. FLD_ZONE field = zone code (AE/X/VE...). NFHL updates rolling, so as_of = capture date | continuous | US public (FEMA) | [www.fema.gov/flood-maps/national-flood-haz](https://www.fema.gov/flood-maps/national-flood-hazard-layer) |
| Foursquare OS Places — SF bbox extract | 2nd POI witness vs Overture (same SF bbox). date_created/date_closed native. Needs HF_TOKEN | monthly | Apache-2.0 | [huggingface.co/datasets/foursquare/fsq-os-](https://huggingface.co/datasets/foursquare/fsq-os-places) |
| Inside Airbnb — San Francisco | Quarterly snapshot; diff listings across snapshots for STR-density change; reviews.csv => review-velocity signal. Detailed tier has host PII (gitignored, never republished) | quarterly | Inside Airbnb (insideairbnb.com), CC BY 4.0 | [insideairbnb.com/san-francisco/](https://insideairbnb.com/san-francisco/) |
| Overture Maps Places — SF bbox extract | Built in app/ingestion/overture.py (other chat). DuckDB bbox pushdown; captures every release still on S3 (they get pruned) = backfill/churn history | monthly | CDLA Permissive 2.0 | [overturemaps.org](https://overturemaps.org) |
| SF local news — area claims (pilot) | CLAIMS tier, never metrics. Verbatim quote + URL per claim. NOT ratchet data (archives exist) | daily | fair-use excerpts w/ citation; never republished in full | [(multiple local outlets)]((multiple local outlets)) |

## California (statewide)

| Source | What it provides | Updated | License | Link |
|---|---|---|---|---|
| CA DCC — cannabis retailer licenses (statewide) | RetailerLocationSearch bbox API (no auth). Retailers only. issueDate/statusDate embedded => diff dumps for license events | daily | California public record | [search.cannabis.ca.gov/](https://search.cannabis.ca.gov/) |
| CA Statewide Database — precinct election returns (2024 General) | Precinct-level SOV, all 58 counties. G24=2024 General. Political composition (constraint 2 compliant: no protected-class) | per_election | Academic/public — cite Statewide Database (UC Berkeley) | [statewidedatabase.org/d20/g24.html](https://statewidedatabase.org/d20/g24.html) |
| CA public school sites 2024-25 (CDE GIS SchoolSites) | ArcGIS FeatureServer; CDSCode joins CAASPP scores -> coordinates. Filter Status='Active' at compute time | annual | CDE public record | [gis.data.ca.gov/datasets/CDEGIS::californi](https://gis.data.ca.gov/datasets/CDEGIS::california-public-schools-2024-25) |
| CAL FIRE Fire Hazard Severity Zones | services.gis.ca.gov REST; layers 0=SRA 1=LRA. This service = 2007/2011 vintage; CURRENT 2024/25 FHSZ is auth-gated on CAL FIRE Hub (GAP) | irregular | CAL FIRE — no distribution restrictions (attribute CAL FIRE) | [gis.data.cnra.ca.gov/](https://gis.data.cnra.ca.gov/) |
| CDE CAASPP Smarter Balanced test results | Caret-delimited CSV in zip. School/district/county/state rows; ELA+Math g3-8,11. Deliberately the ALL-STUDENTS file (subgroup 1), NOT the all-subgroups file, to honor design constraint #2 (no protected-class breakdowns). Entities file maps codes->schools | annual | CDE public research file | [caaspp-elpac.ets.org/caaspp/](https://caaspp-elpac.ets.org/caaspp/) |
| Cal-ITP statewide GTFS (core tables) | Core tables only (stops/routes/trips/calendar/frequencies/agency/feed_info/gtfs_datasets). stop_times + shapes deferred (statewide = GB) | monthly | CC BY 4.0 | [data.ca.gov/dataset/cal-itp-gtfs-ingest-pi](https://data.ca.gov/dataset/cal-itp-gtfs-ingest-pipeline-dataset) |
| California ABC — Active License List (daily export) | Address-level; premises need geocoding. Diff dumps for license_issued/surrendered events | daily | California public record | [www.abc.ca.gov/licensing/licensing-reports](https://www.abc.ca.gov/licensing/licensing-reports/) |
| Census ACS 5-year — California tracts (housing + tenure + turnover + age) | Needs free CENSUS_API_KEY. Vars chosen to avoid protected classes: value/tenure/age/turnover only (constraint #2) | annual | US public domain | [www.census.gov/data/developers/data-sets/a](https://www.census.gov/data/developers/data-sets/acs-5year.html) |
| Census TIGER/Line boundaries — California (places, tracts, county subdivisions, counties) | Places=incorporated cities+CDPs; tracts=ACS join geometry; cousub + county(national, filter STATEFP=06) => jurisdiction (county minus union of places = unincorporated) | annual | US public domain | [www.census.gov/geographies/mapping-files/t](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) |
| EPA TRI — Toxics Release Inventory facilities (California) | Envirofacts tri_facility (no key). facility_name + fac_latitude/longitude. The 'least-mapped nuisance' (industrial/odor); not in POI data | continuous | US public (EPA) | [www.epa.gov/toxics-release-inventory-tri-p](https://www.epa.gov/toxics-release-inventory-tri-program) |
| OpenStreetMap California extract (Geofabrik) | ~1.3GB. Substrate for computed walk/commute/sidewalk/airport-access variables. norcal/socal sub-extracts exist if the full state is too big | daily | ODbL 1.0 | [download.geofabrik.de/north-america/us/cal](https://download.geofabrik.de/north-america/us/california.html) |

## Federal

| Source | What it provides | Updated | License | Link |
|---|---|---|---|---|
| FHFA House Price Index — census tract (annual, national) | Repeat-sales tract HPI (BDL). THE open area-price target: validates trajectory->price. Filter STATE=06/tract FIPS downstream; join via census_tiger_ca tracts | annual | US public domain (FHFA) | [www.fhfa.gov/data/hpi/datasets](https://www.fhfa.gov/data/hpi/datasets) |

## Planned (not yet live)

- **511 SF Bay Area GTFS (+ GTFS-Realtime)**: Free api_key param. GTFS-RT is the one genuinely live (seconds-level) feed: service reliability ([link](https://511.org/open-data/transit))

## The rules the data lives by

- **Two dates on everything.** Every record carries the source's own
  publication date and the date we fetched it. "Fresh" is checkable, not a
  slogan.
- **Citations, never verdicts.** We publish what happened, with the record
  behind it. We never label a neighborhood "good" or "bad".
- **No protected-class data.** Race, ethnicity, and income are excluded from
  every metric and every model, everywhere, by design.
- **Complaints are complaints.** Report-based data (police reports, 311)
  measures reporting behavior as well as reality. Where the two diverge we say
  so; the corrections we have published about our own data are in the research
  note's appendix.
