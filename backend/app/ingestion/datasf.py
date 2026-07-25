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


# Resource IDs verified in DATA_SOURCES.md (2026-07-25). Ordered roughly by trajectory value.
DATASETS = [
    Dataset("permits", "i98e-djp9", "Building Permits", "Tier 6.1 forward layer / construction"),
    Dataset("business_locations", "g8m3-pdis", "Registered Business Locations", "Tier 6.5 business open/close churn"),
    Dataset("evictions", "5cei-gny5", "Eviction Notices", "displacement / gentrification pressure"),
    Dataset("crime", "wg3w-h783", "Police Incident Reports 2018-present", "Tier 1.3 crime/safety"),
    Dataset("threeoneone", "vw6y-z8j6", "311 Cases", "Tier 3.12 noise/blight complaints"),
    Dataset("zoning", "3i4a-hu95", "Zoning Map - Zoning Districts", "Tier 2.4 parcel/adjacent zoning"),
    Dataset("assessor_rolls", "wv5m-vpq2", "Assessor Historical Secured Property Tax Rolls", "Tier 1.1 price/value"),
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
    snap.download("rows.csv", base.socrata_bulk_csv_url(DOMAIN, ds.resource_id))
    snap.finalize(extra={"resource_id": ds.resource_id, "tier_note": ds.tier_note})


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
