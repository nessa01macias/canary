"""Acquire the San Jose municipal spine as full, dated archives — metro #2.

data.sanjoseca.gov is CKAN (OpenGov-hosted), not Socrata: freshness comes from
the package's metadata_modified (base.ckan_as_of), and one dataset may span
several resources (yearly CSVs for 311 / police calls) — we take every resource
matching the dataset's format, so backfill years ride along automatically.

Portal survey receipts (verified live 2026-07-26): San Jose is the only Bay Area
city besides SF with the full core trio updating daily — building permits,
planning permits, 311, police calls-for-service — hence metro #2 (contract §6).
Not on the portal: business licenses, evictions (SF stays unique there).

IRREPLACEABLE: last-30-days-planning-permits is a ROLLING WINDOW — the source
serves only the last month, so the daily capture IS the archive (same class as
the ABC daily dumps; listed in scripts/refresh.sh IRREPLACEABLE).

    python -m app.ingestion.sanjose                       # all, skip unchanged
    python -m app.ingestion.sanjose --only permits_active
    python -m app.ingestion.sanjose --force
"""

import argparse
import re
from dataclasses import dataclass

import requests

from app.ingestion import base

DOMAIN = "data.sanjoseca.gov"
LICENSE = "Open Data Commons PDDL (City of San José open data)"


@dataclass(frozen=True)
class Dataset:
    slug: str
    package: str  # CKAN package name
    name: str
    tier_note: str
    temporal_shape: base.TemporalShape
    canonical_source: str
    tier: str
    fmt: str = "csv"  # resource format filter: 'csv' | 'geojson'
    cadence: str = "daily"


# Package names verified against the live CKAN catalog 2026-07-26.
DATASETS = [
    Dataset("permits_active", "active-building-permits", "Active Building Permits",
            "forward layer / construction (APN, work description, issue date)",
            "recurring_snapshot", "sj_permits", "T6.1"),
    Dataset("permits_expired", "expired-building-permits", "Expired Building Permits",
            "permit lifecycle completion side (pairs with actives for diffing)",
            "recurring_snapshot", "sj_permits", "T6.1"),
    Dataset("planning_30d", "last-30-days-planning-permits", "Last 30 Days Planning Permits",
            "entitlement applications — ROLLING 30-DAY WINDOW, daily capture is the archive",
            "event_stream", "sj_planning", "T6.3"),
    Dataset("threeoneone", "311-service-request-data", "311 Service Requests (yearly files)",
            "noise/blight complaints, 2017-present", "event_stream", "sj_311", "T3.12"),
    Dataset("police_calls", "police-calls-for-service", "Police Calls for Service (yearly files)",
            "crime/safety, 2016-present", "event_stream", "sj_police", "T1.3"),
    Dataset("zoning", "zoning-districts", "Zoning Districts",
            "parcel/adjacent zoning", "reference_layer", "sj_zoning", "T2.4",
            fmt="geojson", cadence="irregular"),
    # Location spine: the permit CSVs ship BLANK gx_location — but 62% of rows
    # carry an APN, and the city publishes its own parcel + address layers.
    # APN -> parcel centroid is how permits get coordinates (staging-side join).
    Dataset("parcels", "parcels", "Parcels",
            "APN -> geometry join target for locating permits", "reference_layer",
            "sj_parcels", "T1.1", fmt="geojson", cadence="irregular"),
    Dataset("addresses", "address", "Address Points",
            "address point layer (secondary location join)", "reference_layer",
            "sj_addresses", "T1.1", fmt="geojson", cadence="irregular"),
]

SPECS = [
    base.SourceSpec(
        key=f"sanjose_{d.slug}",
        name=f"San José open data: {d.name}",
        geography="san_jose",
        temporal_shape=d.temporal_shape,
        cadence=d.cadence,
        fmt=d.fmt,
        license=LICENSE,
        homepage=f"https://{DOMAIN}/dataset/{d.package}",
        canonical_source=d.canonical_source,
        tier=d.tier,
        notes=d.tier_note,
    )
    for d in DATASETS
]


def _package(pkg: str) -> dict:
    resp = requests.get(
        f"https://{DOMAIN}/api/3/action/package_show",
        params={"id": pkg},
        headers=base.DEFAULT_HEADERS,
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success"):
        raise RuntimeError(f"CKAN package_show failed for {pkg}")
    return data["result"]


def _fname(resource_name: str, ext: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", resource_name.lower()).strip("_") + f".{ext}"


def ingest(ds: Dataset, *, force: bool = False) -> None:
    try:
        pkg = _package(ds.package)
    except (requests.RequestException, RuntimeError) as exc:
        print(f"[skip] {ds.slug}: CKAN probe failed ({exc})")
        return
    as_of = base.ckan_as_of(pkg)
    if as_of is None:
        print(f"[skip] {ds.slug}: could not determine source_as_of")
        return
    as_of_str = as_of.isoformat()
    source = f"sanjose_{ds.slug}"

    if not force and base.snapshot_exists(source, as_of_str):
        print(f"[current] {ds.slug}: already have snapshot as_of {as_of_str}")
        return

    resources = [r for r in pkg["resources"] if (r.get("format") or "").lower() == ds.fmt]
    if not resources:
        print(f"[skip] {ds.slug}: no {ds.fmt} resources in package (formats: "
              f"{sorted({r.get('format') for r in pkg['resources']})})")
        return

    print(f"[pull] {ds.slug} ({ds.name}) as_of {as_of_str} — {len(resources)} file(s)")
    snap = base.Snapshot(
        source,
        as_of_str,
        geography="san_jose",
        source_name=f"San José open data: {ds.name}",
        license=LICENSE,
        homepage=f"https://{DOMAIN}/dataset/{ds.package}",
    )
    for r in resources:
        snap.download(_fname(r["name"], ds.fmt), r["url"])
    snap.finalize(extra={
        "package": ds.package,
        "tier_note": ds.tier_note,
        "temporal_shape": ds.temporal_shape,
        "resources": [{"name": r["name"], "last_modified": r.get("last_modified")} for r in resources],
    })


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
