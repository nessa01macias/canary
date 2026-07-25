"""Acquire the SF municipal open-data spine as full, dated archives.

DataSF is Socrata-hosted; each dataset exposes its own freshness via rowsUpdatedAt
(the city's ETL timestamp -- confirmed daily for the core signals in DATA_SOURCES.md).
We snapshot the FULL dataset (bulk CSV export), naming the snapshot dir by that
source_as_of date, so:
  - re-running daily is idempotent (a new dir appears only when the city advances the data)
  - history accumulates for trajectory computation

This is the backend ARCHIVE engine (full datasets, dated, for diffing over time) --
distinct from the frontend's live 300-row display fetch of the same permits endpoint.

Usage:
    python -m app.ingestion.datasf                # all datasets, skip unchanged
    python -m app.ingestion.datasf --only permits # one dataset
    python -m app.ingestion.datasf --force        # re-pull even if as_of unchanged
"""

import argparse
from dataclasses import dataclass

from app.ingestion import base

DOMAIN = "data.sfgov.org"
LICENSE = "Open Data Commons PDDL / public domain (DataSF)"


@dataclass(frozen=True)
class Dataset:
    slug: str
    resource_id: str
    name: str
    tier_note: str
    temporal_shape: base.TemporalShape
    canonical_source: str
    tier: str
    fmt: str = "csv"  # 'csv' for tabular/event, 'geojson' for polygon reference layers
    cadence: str = "daily"


# Resource IDs verified 2026-07-25 (DATA_SOURCES.md + forward-layer research pass).
# Ordered roughly by trajectory value; the forward layer (Tier 6) is the differentiator.
DATASETS = [
    # --- original spine ---
    Dataset("permits", "i98e-djp9", "Building Permits", "forward layer / construction", "event_stream", "sf_permits", "T6.1"),
    Dataset("business_locations", "g8m3-pdis", "Registered Business Locations", "business open/close churn (decades of backfill)", "recurring_snapshot", "sf_regbiz", "T6.5"),
    Dataset("evictions", "5cei-gny5", "Eviction Notices", "displacement / gentrification pressure", "event_stream", "sf_evictions", "T6"),
    Dataset("crime", "wg3w-h783", "Police Incident Reports 2018-present", "crime/safety", "event_stream", "sf_police", "T1.3"),
    Dataset("threeoneone", "vw6y-z8j6", "311 Cases", "noise/blight complaints", "event_stream", "sf_311", "T3.12"),
    Dataset("zoning", "3i4a-hu95", "Zoning Map - Zoning Districts", "parcel/adjacent zoning", "reference_layer", "sf_zoning", "T2.4", fmt="geojson"),
    Dataset("assessor_rolls", "wv5m-vpq2", "Assessor Historical Secured Property Tax Rolls", "price/value (Prop 13: NOT market price)", "reference_layer", "sf_assessor", "T1.1", cadence="monthly"),
    # --- forward layer (Tier 6) ---
    Dataset("dev_pipeline", "6jgi-cpb4", "SF Development Pipeline", "entitlement->construction pipeline w/ net units", "recurring_snapshot", "sf_dev_pipeline", "T6.1", cadence="quarterly"),
    Dataset("planning_records", "qvu5-m3a2", "Planning Department Records - Projects (PPTS successor)", "rezoning / change-of-use / entitlement applications", "event_stream", "sf_planning", "T6.3"),
    Dataset("commercial_vacancy", "rzkk-54yv", "Taxable Commercial Spaces (Prop-D Vacancy Tax)", "storefront vacancy signal (filed flag)", "recurring_snapshot", "sf_vacancy", "T6.6"),
    Dataset("sfmta_projects", "6ibt-jpn7", "SFMTA Projects - Polygons", "approved transit + road diets/closures", "reference_layer", "sf_transit_projects", "T6.4", fmt="geojson", cadence="irregular"),
    # --- missing dimensions ---
    Dataset("fire_ems_calls", "nuek-vuh3", "Fire/EMS Dispatched Calls for Service", "emergency response times (received->on-scene)", "event_stream", "sf_fire_ems", "T4.7"),
    Dataset("parking_meters", "8vzz-qzz9", "Parking Meters", "parking regime", "reference_layer", "sf_parking_meters", "T2.7", cadence="irregular"),
    Dataset("rpp_zones", "i886-hxz9", "Residential Parking Permit Eligibility Parcels", "permit-parking zones", "reference_layer", "sf_rpp", "T2.7", fmt="geojson", cadence="irregular"),
    Dataset("street_trees", "tkzw-k3nq", "Street Tree List", "tree canopy city inventory", "reference_layer", "sf_trees", "T3.6"),
    Dataset("sfusd_boundaries", "e6tr-sxwg", "SFUSD School Attendance Areas 2024-25", "school attendance areas (bus eligibility, boundary snapshot)", "reference_layer", "sf_school_boundaries", "T4.9", fmt="geojson", cadence="annual"),
]

SPECS = [
    base.SourceSpec(
        key=f"datasf_{d.slug}",
        name=f"DataSF: {d.name}",
        geography="san_francisco",
        temporal_shape=d.temporal_shape,
        cadence=d.cadence,
        fmt=d.fmt,
        license=LICENSE,
        homepage=f"https://{DOMAIN}/d/{d.resource_id}",
        canonical_source=d.canonical_source,
        tier=d.tier,
        notes=d.tier_note,
    )
    for d in DATASETS
]


def ingest(ds: Dataset, *, force: bool = False) -> None:
    as_of = base.socrata_as_of(DOMAIN, ds.resource_id)
    if as_of is None:
        print(f"[skip] {ds.slug}: could not determine source_as_of (metadata probe failed)")
        return
    as_of_str = as_of.isoformat()
    source = f"datasf_{ds.slug}"

    if not force and base.snapshot_exists(source, as_of_str):
        print(f"[current] {ds.slug}: already have snapshot as_of {as_of_str}")
        return

    print(f"[pull] {ds.slug} ({ds.name}) as_of {as_of_str}")
    snap = base.Snapshot(
        source,
        as_of_str,
        geography="san_francisco",
        source_name=f"DataSF: {ds.name}",
        license=LICENSE,
        homepage=f"https://{DOMAIN}/d/{ds.resource_id}",
    )
    if ds.fmt == "geojson":
        snap.download("rows.geojson", base.socrata_bulk_geojson_url(DOMAIN, ds.resource_id))
    else:
        snap.download("rows.csv", base.socrata_bulk_csv_url(DOMAIN, ds.resource_id))
    snap.finalize(extra={"resource_id": ds.resource_id, "tier_note": ds.tier_note, "temporal_shape": ds.temporal_shape})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="ingest only this dataset slug")
    parser.add_argument("--force", action="store_true", help="re-pull even if source_as_of unchanged")
    args = parser.parse_args()

    datasets = DATASETS
    if args.only:
        datasets = [d for d in DATASETS if d.slug == args.only]
        if not datasets:
            raise SystemExit(f"No dataset slug {args.only!r}. Options: {[d.slug for d in DATASETS]}")

    for ds in datasets:
        ingest(ds, force=args.force)


if __name__ == "__main__":
    main()
