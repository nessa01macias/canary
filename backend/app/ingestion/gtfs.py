"""Cal-ITP statewide GTFS (data.ca.gov CKAN) — transit access + service frequency.

Statewide aggregation of every CA agency's GTFS, published monthly as flat CSV tables.
We grab the core tables needed for rail-station proximity (T4.2) and service
frequency/span (T4.3); the giant per-stop schedule (stop_times) and geometry (shapes)
are left for on-demand pulls. CKAN resource URLs 302-redirect to signed S3
(base.Snapshot.download follows redirects).

    python -m app.ingestion.gtfs
"""

import argparse

from app.ingestion import base
from app.ingestion.base import SourceSpec

PORTAL = "data.ca.gov"
PACKAGE = "cal-itp-gtfs-ingest-pipeline-dataset"

SPEC = SourceSpec(
    key="gtfs_ca_statewide_calitp",
    name="Cal-ITP statewide GTFS (core tables)",
    geography="california",
    temporal_shape="recurring_snapshot",
    cadence="monthly",
    fmt="csv",
    license="CC BY 4.0",
    homepage="https://data.ca.gov/dataset/cal-itp-gtfs-ingest-pipeline-dataset",
    canonical_source="gtfs_calitp",
    tier="T1.4/T4.2/T4.3",
    notes="Core tables only (stops/routes/trips/calendar/frequencies/agency/feed_info/gtfs_datasets). stop_times + shapes deferred (statewide = GB).",
)

# GTFS resource `name`s to pull (skip GB-scale stop_times/shapes/translations).
CORE_TABLES = {
    "agency", "stops", "routes", "trips", "calendar", "calendar_dates",
    "frequencies", "feed_info", "gtfs_datasets",
    "organizations_latest_with_caltrans_district",
}


def fetch(*, force: bool = False) -> None:
    pkg = base.ckan_package(PORTAL, PACKAGE)
    if not pkg:
        print(f"[error] {SPEC.key}: CKAN package_show failed")
        return
    as_of = base.ckan_as_of(pkg)
    if as_of is None:
        print(f"[skip] {SPEC.key}: no metadata_modified")
        return
    as_of_str = as_of.isoformat()
    if not force and base.snapshot_exists(SPEC.key, as_of_str):
        print(f"[current] {SPEC.key}: already have snapshot as_of {as_of_str}")
        return

    print(f"[pull] {SPEC.key} as_of {as_of_str}")
    snap = base.Snapshot(
        SPEC.key, as_of_str, geography=SPEC.geography,
        source_name=SPEC.name, license=SPEC.license, homepage=SPEC.homepage,
    )
    pulled = 0
    for r in pkg.get("resources", []):
        name = (r.get("name") or "").strip()
        url = r.get("url")
        if name in CORE_TABLES and url:
            snap.download(f"{name}.csv", url)
            pulled += 1
    snap.finalize(extra={"package": PACKAGE, "tables": sorted(CORE_TABLES), "pulled": pulled})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    fetch(force=args.force)


if __name__ == "__main__":
    main()
