"""Federal layers. FEMA NFHL flood zones verified + wired (SF bbox).

Other federal sources (FCC BDC broadband, EPA AQS/TRI/FRS, FRA crossings, FAA noise,
HIFLD facilities, USFS WUI) still need endpoint verification -- the research pass for
them was cancelled, so they're intentionally NOT stubbed with guessed URLs here.

    python -m app.ingestion.federal            # FEMA NFHL, SF bbox
    python -m app.ingestion.federal --bbox ca  # FEMA NFHL, all California (large)
"""

import argparse

from app.ingestion import base
from app.ingestion.base import SourceSpec

# FEMA National Flood Hazard Layer -- MapServer layer 28 = flood hazard zones (S_FLD_HAZ_AR).
FEMA_NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28"
SF_BBOX = (-122.52, 37.70, -122.35, 37.83)
BAY_BBOX = (-122.55, 37.15, -121.70, 37.95)  # SF + Oakland/Berkeley + San Jose + Palo Alto
CA_BBOX = (-124.48, 32.53, -114.13, 42.01)

FEMA = SourceSpec(
    key="fema_nfhl_flood",
    name="FEMA National Flood Hazard Layer — flood zones",
    geography="bay_area",
    temporal_shape="reference_layer",
    cadence="continuous",  # NFHL updates rolling per-panel; as_of = capture date
    fmt="geojson",
    license="US public (FEMA)",
    homepage="https://www.fema.gov/flood-maps/national-flood-hazard-layer",
    canonical_source="fema_nfhl",
    tier="T2.1",
    notes="ArcGIS REST layer 28 (S_FLD_HAZ_AR); bbox-filtered. FLD_ZONE field = zone code (AE/X/VE...). NFHL updates rolling, so as_of = capture date.",
)


def fetch(*, bbox_name: str = "bay", force: bool = False) -> None:
    # Default widened sf -> bay for the Bay Area fan-out (2026-07-26); pre-dating
    # snapshots are SF-only — each snapshot's metadata records its own bbox.
    bbox = {"ca": CA_BBOX, "sf": SF_BBOX}.get(bbox_name, BAY_BBOX)
    as_of = base.today().isoformat()  # rolling-update service; capture date is the honest as_of
    if not force and base.snapshot_exists(FEMA.key, as_of):
        print(f"[current] {FEMA.key}: already captured today ({as_of})")
        return
    print(f"[pull] {FEMA.key} bbox={bbox_name} (filtering national NFHL to bbox)")
    fc = base.fetch_arcgis_geojson(FEMA_NFHL, bbox=bbox, out_fields="FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID")
    print(f"    {len(fc['features'])} flood-zone features in bbox")
    snap = base.Snapshot(
        FEMA.key, as_of, geography=FEMA.geography,
        source_name=FEMA.name, license=FEMA.license, homepage=FEMA.homepage,
    )
    snap.write_json("flood_zones.geojson", fc, source_url=FEMA_NFHL)
    snap.finalize(extra={"bbox": bbox, "bbox_name": bbox_name, "layer": "NFHL/28 S_FLD_HAZ_AR"})


# EPA TRI — Toxics Release Inventory facilities (the industrial-nuisance / odor signal).
# EPA Envirofacts REST, no key. ~5.1k CA facilities w/ lat/long.
EPA_TRI = SourceSpec(
    key="epa_tri_ca",
    name="EPA TRI — Toxics Release Inventory facilities (California)",
    geography="california",
    temporal_shape="reference_layer",
    cadence="continuous",  # rolling registry; as_of = capture date
    fmt="json",
    license="US public (EPA)",
    homepage="https://www.epa.gov/toxics-release-inventory-tri-program",
    canonical_source="epa_tri",
    tier="T3.5",
    notes="Envirofacts tri_facility (no key). facility_name + fac_latitude/longitude. The 'least-mapped nuisance' (industrial/odor); not in POI data.",
)
EPA_TRI_URL = "https://data.epa.gov/efservice/tri_facility/state_abbr/CA/rows/0:100000/JSON"


def fetch_epa_tri(*, force: bool = False) -> None:
    import requests

    as_of = base.today().isoformat()  # rolling registry; capture date is the honest as_of
    if not force and base.snapshot_exists(EPA_TRI.key, as_of):
        print(f"[current] {EPA_TRI.key}: already captured today ({as_of})")
        return
    print(f"[pull] {EPA_TRI.key} (Envirofacts, all CA TRI facilities)")
    resp = requests.get(EPA_TRI_URL, headers=base.DEFAULT_HEADERS, timeout=120)
    resp.raise_for_status()
    rows = resp.json()
    print(f"    {len(rows)} TRI facilities")
    snap = base.Snapshot(
        EPA_TRI.key, as_of, geography=EPA_TRI.geography,
        source_name=EPA_TRI.name, license=EPA_TRI.license, homepage=EPA_TRI.homepage,
    )
    snap.write_json("tri_facilities_ca.json", rows, source_url=EPA_TRI_URL)
    snap.finalize(extra={"n_facilities": len(rows)})


SPECS = [FEMA, EPA_TRI]
FETCHERS = {"fema": lambda force=False: fetch(force=force), "epa_tri": fetch_epa_tri}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=sorted(FETCHERS))
    parser.add_argument("--bbox", choices=["sf", "ca"], default="sf")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if args.only == "epa_tri":
        fetch_epa_tri(force=args.force)
    elif args.only == "fema":
        fetch(bbox_name=args.bbox, force=args.force)
    else:
        fetch(bbox_name=args.bbox, force=args.force)
        fetch_epa_tri(force=args.force)


if __name__ == "__main__":
    main()
