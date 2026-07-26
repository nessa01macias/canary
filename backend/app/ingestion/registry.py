"""The source registry: every source Canary knows about, in one place.

Collects SourceSpecs from the implemented fetch modules, adds specs for sources whose
endpoints are verified but whose fetch() isn't built yet, and maps all of them against
the 6-tier variable taxonomy so gaps are explicit.

    python -m app.ingestion.registry            # print coverage report
    python -m app.ingestion.registry --export   # also write data/sources_registry.json

`implemented=True` means a working `python -m app.ingestion.<module>` fetch exists and
has produced (or can produce) L0. `implemented=False` = endpoint verified, fetch pending.
"""

import argparse
import json
from dataclasses import asdict

from app.ingestion import base, bayarea, california, census, datasf, federal, fhfa, fsq, gtfs, insideairbnb, news, osm, sanjose
from app.ingestion.base import SourceSpec

# --- implemented in this chat's modules (each exports SPEC/SPECS + fetch()) ---
IMPLEMENTED = [
    *datasf.SPECS,
    *california.SPECS,
    *census.SPECS,
    insideairbnb.SPEC,
    gtfs.SPEC,
    *federal.SPECS,
    fsq.SPEC,
    osm.SPEC,
    fhfa.SPEC,
    news.SPEC,  # pilot-stage: declared daily, scheduling gated on precision review
    *sanjose.SPECS,  # metro #2 (Bay Area fan-out — portal survey 2026-07-26)
    *bayarea.SPECS,  # Oakland + Berkeley + Palo Alto (same survey)
    *insideairbnb.BAY_SPECS,  # STR layer for the fan-out cities
]

# --- implemented by modules that don't export a SPEC (other chat's overture.py) ---
EXTERNAL = [
    SourceSpec(
        key="overture_places", name="Overture Maps Places — SF bbox extract",
        geography="san_francisco", temporal_shape="recurring_snapshot", cadence="monthly",
        fmt="parquet", license="CDLA Permissive 2.0",
        homepage="https://overturemaps.org",
        canonical_source="overture", tier="T4.4/T6.5/T6.6",
        notes="Built in app/ingestion/overture.py (other chat). DuckDB bbox pushdown; captures every release still on S3 (they get pruned) = backfill/churn history.",
    ),
]

# --- verified endpoints, fetch() not yet built -------------------------------
PLANNED = [
    SourceSpec(
        key="gtfs_511_bayarea", name="511 SF Bay Area GTFS (+ GTFS-Realtime)",
        geography="sf_bay", temporal_shape="reference_layer", cadence="continuous",
        fmt="gtfs_zip", license="511.org open terms",
        homepage="https://511.org/open-data/transit",
        canonical_source="gtfs_511", tier="T4.2/T4.3", requires_auth=True,
        notes="Free api_key param. GTFS-RT is the one genuinely live (seconds-level) feed: service reliability.",
    ),
]

ALL = IMPLEMENTED + EXTERNAL + PLANNED
_IMPLEMENTED_KEYS = {s.key for s in IMPLEMENTED} | {s.key for s in EXTERNAL}


# --- taxonomy coverage (ALL 49 variables from the 6-tier taxonomy) -----------
# status:
#   covered  = direct open source acquired (L0 on disk)
#   planned  = direct open source verified, fetch() pending
#   compute  = no direct dataset; DERIVED downstream from covered/planned inputs
#   catalog  = heavy raster, fetch-on-demand bbox-clip (never snapshotted)
#   gated    = exists but license/paywall blocks commons use
#   gap      = no open source identified yet / genuinely hard
TAXONOMY = {
    # Tier 1 — commoditized
    "T1.1 price/value": ("covered", "fhfa_hpi_tract (1975-2025, 7.8k CA tracts — the AREA price target); property-level still needs county deeds; assessor acquired but Prop-13-capped"),
    "T1.2 school quality": ("covered", "ca_caaspp"),
    "T1.3 crime/safety": ("covered", "datasf_crime (SF); other metros need each city's open data"),
    "T1.4 commute time": ("compute", "routing over osm_california + gtfs (planned inputs)"),
    "T1.5 property tax rate": ("covered", "datasf_assessor_rolls + county rate schedules"),
    "T1.6 walk/bike/transit score": ("compute", "recomputed from osm_california + gtfs; do NOT buy Walk Score"),
    # Tier 2 — hard binary filters
    "T2.1 flood zone": ("covered", "fema_nfhl_flood (SF bbox; --bbox ca for statewide)"),
    "T2.2 wildfire/WUI": ("covered", "calfire_fhsz (2011 vintage; current 2024/25 = gap); USFS WUI planned"),
    "T2.3 broadband": ("planned", "FCC BDC (federal agent verifying)"),
    "T2.4 parcel + adjacent zoning": ("covered", "datasf_zoning (SF); other metros = municipal GIS"),
    "T2.5 jurisdiction (city vs uninc.)": ("covered", "census_tiger_ca (places minus county = unincorporated)"),
    "T2.6 utilities septic/well/gas": ("gap", "per-county health/utility GIS; not yet sourced"),
    "T2.7 parking regime & permit zones": ("covered", "datasf_parking_meters (38.7k) + datasf_rpp_zones (83.5k parcels)"),
    "T2.8 cell coverage": ("planned", "FCC (federal agent)"),
    "T2.9 short-term rental rules": ("gap", "municipal code, hard to parse; insideairbnb gives ACTIVITY not the rules"),
    # Tier 3 — sensory
    "T3.1 aircraft noise": ("planned", "FAA contours / ADS-B (federal agent)"),
    "T3.2 road/traffic noise": ("compute", "model from DOT AADT + FHWA TNM (inputs planned)"),
    "T3.3 air quality/freeway": ("planned", "EPA AQS (federal agent) + PurpleAir"),
    "T3.4 freight rail/horn zones": ("planned", "FRA crossing inventory (federal agent)"),
    "T3.5 industrial/landfill/TRI": ("covered", "epa_tri_ca (5.1k CA toxic-release facilities w/ coords); FRS for landfill/wastewater still available if needed"),
    "T3.6 tree canopy": ("covered", "datasf_street_trees city inventory (198k); NLCD canopy-% raster remains catalog for continuous cover"),
    "T3.7 elevation/slope/view": ("catalog", "USGS 3DEP (TNM API / S3, bbox on demand)"),
    "T3.8 microclimate (fog/sun/heat)": ("catalog", "PRISM (endpoint verified) + Landsat thermal (STAC)"),
    "T3.9 light pollution": ("catalog", "VIIRS (EOG/NASA, needs free auth)"),
    "T3.10 sidewalks & lighting": ("planned", "osm_california (sidewalks); city lighting assets patchy"),
    "T3.11 siren corridors": ("compute", "derive from fire-station / facility locations (HIFLD, federal agent)"),
    "T3.12 noise ordinances vs 311": ("covered", "datasf_threeoneone (complaint layer); ordinance/legal layer = gap"),
    # Tier 4 — time geography
    "T4.1 door-to-door commute at peak": ("compute", "routing over osm + gtfs (= T1.4)"),
    "T4.2 rail station proximity": ("covered", "gtfs_ca_statewide_calitp (stops/routes/trips); gtfs_511 for RT"),
    "T4.3 service frequency/reliability": ("covered", "gtfs_ca_statewide_calitp (frequencies/calendar/trips); GTFS-RT reliability still planned (511)"),
    "T4.4 grocery/pharmacy access": ("covered", "overture_places + fsq_os_places (2 POI witnesses, SF bbox)"),
    "T4.5 urgent care/ER": ("planned", "HIFLD redundant w/ Overture POIs; use overture_places hospital category, or HIFLD for bed/trauma metadata"),
    "T4.6 chain-retail proxies": ("covered", "overture_places + fsq_os_places"),
    "T4.7 emergency response times": ("covered", "datasf_fire_ems_calls (received->on-scene timestamps, 2.9GB)"),
    "T4.8 airport access": ("compute", "routing to airport POIs (osm); no dataset"),
    "T4.9 school bus eligibility": ("covered", "datasf_sfusd_boundaries (58 attendance-area polygons; annual)"),
    # Tier 5 — composition
    "T5.1 political composition": ("covered", "ca_precinct_returns"),
    "T5.2 tenure & turnover rate": ("covered", "census_acs_ca (9,129 CA tracts)"),
    "T5.3 age mix": ("covered", "census_acs_ca (9,129 CA tracts)"),
    # Tier 6 — the forward layer (the differentiator)
    "T6.1 approved construction/view-light": ("covered", "datasf_permits + datasf_dev_pipeline (1.9k projects, net units); view/light loss also needs 3DEP terrain (catalog)"),
    "T6.2 school boundary changes": ("gap", "board agendas (unstructured); datasf_sfusd_boundaries gives the snapshot, diffing annual snapshots catches changes but not the proposal process"),
    "T6.3 rezoning/upzoning applications": ("covered", "datasf_planning_records (54k entitlement/land-use records, daily)"),
    "T6.4 approved transit": ("covered", "datasf_sfmta_projects (98 project polygons); regional capital plans still manual"),
    "T6.5 business open/close velocity": ("covered", "datasf_business_locations + overture_places + fsq_os_places (3-way churn cross-validation)"),
    "T6.6 storefront vacancy trend": ("covered", "datasf_commercial_vacancy (Prop-D vacancy-tax roll, 21.9k spaces)"),
    "T6.7 large entitlements (CEQA/EIR)": ("planned", "CEQAnet (CA OPR/LCI) -- NO api/bulk exists; scrape sitemap->SCH record pages (Firecrawl)"),
    "T6.8 road diets/closures/works": ("covered", "datasf_sfmta_projects (shared w/ T6.4)"),
    "T6.9 CIP + passed bond measures": ("gap", "city budget/capital-plan docs (unstructured PDFs); needs extraction"),
    "T6.10 liquor & cannabis licenses": ("covered", "ca_abc_licenses (liquor, daily) + ca_cannabis_retailers (1.9k, daily API)"),
}


def to_registry() -> dict:
    return {
        "generated_at": base.now_iso(),
        "sources": [
            {**asdict(s), "implemented": s.key in _IMPLEMENTED_KEYS} for s in ALL
        ],
        "taxonomy_coverage": {
            k: {"status": v[0], "source": v[1]} for k, v in TAXONOMY.items()
        },
    }


def print_report() -> None:
    print(f"SOURCES: {len(ALL)} total ({len(IMPLEMENTED)} implemented, {len(PLANNED)} planned)\n")
    for s in ALL:
        flag = "✔ built" if s.key in _IMPLEMENTED_KEYS else "· planned"
        auth = " [needs auth]" if s.requires_auth else ""
        print(f"  {flag:10} {s.key:26} {s.temporal_shape:18} {s.cadence:10} {s.geography}{auth}")

    from collections import Counter
    status_counts = Counter(v[0] for v in TAXONOMY.values())
    print(f"\nTAXONOMY COVERAGE ({len(TAXONOMY)} variables):")
    for status in ("covered", "compute", "planned", "catalog", "gated", "gap"):
        if status in status_counts:
            print(f"  {status:9}: {status_counts[status]}")
    print("\n  GAPS (no open source wired yet):")
    for k, (status, note) in TAXONOMY.items():
        if status == "gap":
            print(f"    - {k}: {note}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--export", action="store_true", help="write data/sources_registry.json")
    args = parser.parse_args()
    print_report()
    if args.export:
        out = base.DATA_DIR / "sources_registry.json"
        out.write_text(json.dumps(to_registry(), indent=2))
        print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
