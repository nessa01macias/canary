"""Bay Area fan-out beyond San José — Oakland + Berkeley (Socrata) and
Palo Alto (ArcGIS PermitViewer).

Portal survey receipts (verified live 2026-07-26, endpoints re-probed before
this module was written):
  - Oakland  (data.oaklandca.gov, Socrata): crime + 311 daily; zoning frozen
    2013; EVICTIONS FROZEN 2018 — grabbed once anyway: 2010s displacement
    history is moat, not staleness. Permits are NOT on the portal (Accela
    Citizen Access only — future scraping capability shared with Berkeley/PA).
  - Berkeley (data.cityofberkeley.info, Socrata): small but sharp — daily
    business licenses WITH APN + NAICS (churn signal) and daily 311; parcels/
    zoning static. No crime feed exists anywhere; permits are Accela-only.
  - Palo Alto: no open-data portal (Junar dead). ArcGIS Enterprise
    PermitViewer is the one machine-readable source, and it is THINNER than
    the survey suggested (verified against layer schema: no blobs, no related
    tables): one point per address + activity flags. It's an activity-PRESENCE
    layer — weekly snapshot DIFFS are the change signal (a new point = new
    permit activity at that address). Record detail (dates, descriptions)
    lives only in Accela Citizen Access — future scraping capability shared
    with Oakland + Berkeley.

Same Socrata mechanics as datasf.py, parameterized by domain — the vocabulary
is global, the portal is local.

    python -m app.ingestion.bayarea                          # all, skip unchanged
    python -m app.ingestion.bayarea --only oakland_crime
    python -m app.ingestion.bayarea --force
"""

import argparse
import csv
from dataclasses import dataclass

import requests

from app.ingestion import base

PA_GIS = "https://gis.cityofpaloalto.org/server/rest/services/PermitViewer/PermitViewer/MapServer"
ALAMEDA = "https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services"


@dataclass(frozen=True)
class SocrataDataset:
    city: str            # key prefix + geography, e.g. "oakland"
    slug: str
    domain: str
    resource_id: str
    name: str
    tier_note: str
    temporal_shape: base.TemporalShape
    canonical_source: str
    tier: str
    fmt: str = "csv"
    cadence: str = "daily"

    @property
    def key(self) -> str:
        return f"{self.city}_{self.slug}"


_OAK = "data.oaklandca.gov"
_BERK = "data.cityofberkeley.info"

# Resource IDs verified live 2026-07-26 (rowsUpdatedAt probed pre-write).
SOCRATA_DATASETS = [
    # --- Oakland ---
    SocrataDataset("oakland", "crime", _OAK, "ppgh-7dqv", "CrimeWatch Data",
                   "crime/safety (updated daily)", "event_stream", "oak_police", "T1.3"),
    SocrataDataset("oakland", "threeoneone", _OAK, "quth-gb8e", "OAK 311 Service Requests",
                   "noise/blight complaints", "event_stream", "oak_311", "T3.12"),
    # NO oakland evictions: the dataset named "Eviction Notices" (it5w-25xq) is
    # actually a 6-row eviction-RATE-by-race/ethnicity summary — rule #9
    # forbidden data, caught by content validation 2026-07-26. No real notices
    # dataset exists on the portal; SF stays unique for evictions.
    SocrataDataset("oakland", "parking_citations", _OAK, "58em-y96b", "Parking Citation Data",
                   "enforcement/activity signal (advances quarterly)",
                   "event_stream", "oak_citations", "T2.7", cadence="quarterly"),
    SocrataDataset("oakland", "zoning", _OAK, "sph3-urcs", "Zoning",
                   "parcel/adjacent zoning (static)", "reference_layer", "oak_zoning",
                   "T2.4", fmt="geojson", cadence="irregular"),
    # --- Berkeley ---
    SocrataDataset("berkeley", "business_licenses", _BERK, "rwnf-bu3w", "Business Licenses",
                   "daily licenses w/ APN + NAICS — business churn signal",
                   "recurring_snapshot", "berk_regbiz", "T6.5"),
    SocrataDataset("berkeley", "threeoneone", _BERK, "p88g-6gs2", "311 Cases",
                   "noise/blight complaints", "event_stream", "berk_311", "T3.12"),
    # NO berkeley parcels: the portal's asset (bhxd-e6up) is a hollow husk —
    # empty properties AND null geometry on every row, truncated at 1000, and
    # both export endpoints broken (content validation, 2026-07-26). The real
    # parcel/assessor backbone for Berkeley AND Oakland is Alameda County's
    # ArcGIS Hub (parcels 2026-07, assessor roll FY25-26) — future source.
    SocrataDataset("berkeley", "zoning", _BERK, "iknk-w4qw", "Zoning",
                   "parcel/adjacent zoning (static)", "reference_layer", "berk_zoning",
                   "T2.4", fmt="geojson", cadence="irregular"),
]

_LICENSE = "Open data per city portal terms (Socrata-hosted)"

PA_SPEC = base.SourceSpec(
    key="paloalto_permitviewer",
    name="Palo Alto PermitViewer (planning/building/enforcement points)",
    geography="palo_alto",
    temporal_shape="recurring_snapshot",
    cadence="weekly",
    fmt="geojson",
    license="Public ArcGIS service (City of Palo Alto GIS)",
    homepage=PA_GIS,
    canonical_source="pa_permits",
    tier="T6.1",
    notes="Only machine-readable Palo Alto source (portal dead). Address points "
          "+ activity flags ONLY (no record detail — that's Accela). Snapshot "
          "diffs are the change signal.",
)

SPECS = [
    *(
        base.SourceSpec(
            key=d.key,
            name=f"{d.city.title()} open data: {d.name}",
            geography=d.city,
            temporal_shape=d.temporal_shape,
            cadence=d.cadence,
            fmt=d.fmt,
            license=_LICENSE,
            homepage=f"https://{d.domain}/d/{d.resource_id}",
            canonical_source=d.canonical_source,
            tier=d.tier,
            notes=d.tier_note,
        )
        for d in SOCRATA_DATASETS
    ),
    PA_SPEC,
]


def ingest_socrata(ds: SocrataDataset, *, force: bool = False) -> None:
    as_of = base.socrata_as_of(ds.domain, ds.resource_id)
    if as_of is None:
        print(f"[skip] {ds.key}: could not determine source_as_of")
        return
    as_of_str = as_of.isoformat()
    if not force and base.snapshot_exists(ds.key, as_of_str):
        print(f"[current] {ds.key}: already have snapshot as_of {as_of_str}")
        return

    print(f"[pull] {ds.key} ({ds.name}) as_of {as_of_str}")
    snap = base.Snapshot(
        ds.key, as_of_str, geography=ds.city,
        source_name=f"{ds.city.title()} open data: {ds.name}",
        license=_LICENSE, homepage=f"https://{ds.domain}/d/{ds.resource_id}",
    )
    if ds.fmt == "geojson":
        snap.download("rows.geojson", base.socrata_bulk_geojson_url(ds.domain, ds.resource_id))
    else:
        snap.download("rows.csv", base.socrata_bulk_csv_url(ds.domain, ds.resource_id))
    snap.finalize(extra={"resource_id": ds.resource_id, "tier_note": ds.tier_note,
                         "temporal_shape": ds.temporal_shape})


PA_LAYERS = {0: "planning", 1: "building", 2: "enforcement"}


def ingest_paloalto(force: bool = False) -> None:
    # No portal metadata to probe; the layer's lastEditDate is the honest as_of
    # (falls back to today — the capture date — if the server doesn't expose it).
    as_of = base.arcgis_layer_as_of(f"{PA_GIS}/1") or base.today()
    as_of_str = as_of.isoformat()
    if not force and base.snapshot_exists(PA_SPEC.key, as_of_str):
        print(f"[current] {PA_SPEC.key}: already have snapshot as_of {as_of_str}")
        return

    print(f"[pull] {PA_SPEC.key} as_of {as_of_str}")
    snap = base.Snapshot(
        PA_SPEC.key, as_of_str, geography=PA_SPEC.geography,
        source_name=PA_SPEC.name, license=PA_SPEC.license, homepage=PA_GIS,
    )
    for lyr, name in PA_LAYERS.items():
        # Small pages + long timeout: the city's ArcGIS Enterprise is slow
        # serving the permit-history blob fields (1000/page read-times-out).
        fc = base.fetch_arcgis_geojson(f"{PA_GIS}/{lyr}", page_size=200, timeout=300)
        snap.write_json(f"{name}.geojson", fc)
        print(f"    layer {lyr} ({name}): {len(fc.get('features', []))} features")
    snap.finalize(extra={"layers": PA_LAYERS, "temporal_shape": PA_SPEC.temporal_shape})


# --------------------------------------------------------------------------- #
#  Alameda County (ArcGIS Hub) — the parcel/assessor backbone for Oakland AND
#  Berkeley (neither city publishes parcels/values; the county does, well).
#  Verified live 2026-07-26: parcels 489,766 polygons (2026-07); secured tax
#  roll FY2025-26 = 472,690 rows (FY2019-20..2024-25 exist as backfill);
#  ownership transfers = 187,908 SALES EVENTS; sheriff crime (unincorporated +
#  contract cities — Oakland PD is a separate feed we already pull).
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class ArcgisDataset:
    key: str
    layer_url: str
    name: str
    tier_note: str
    temporal_shape: base.TemporalShape
    canonical_source: str
    tier: str
    kind: str            # 'layer' (has geometry -> geojson) | 'table' (f=json -> csv)
    cadence: str


ALAMEDA_DATASETS = [
    ArcgisDataset("alameda_parcels", f"{ALAMEDA}/Parcels/FeatureServer/0",
                  "Parcel Boundaries", "APN -> geometry join target for Oakland + Berkeley",
                  "reference_layer", "alco_parcels", "T1.1", "layer", "irregular"),
    ArcgisDataset("alameda_tax_roll",
                  f"{ALAMEDA}/Assessor_Office_Secured_Tax_Roll_2025_to_2026/FeatureServer/0",
                  "Assessor Secured Tax Roll FY2025-26",
                  "assessed values (Prop 13: NOT market price); FY19-20..24-25 available as backfill",
                  "reference_layer", "alco_assessor", "T1.1", "table", "annual"),
    ArcgisDataset("alameda_ownership_transfers",
                  f"{ALAMEDA}/Assessor_Office_Ownership_Transfer_List/FeatureServer/0",
                  "Ownership Transfer List", "property SALES events for Oakland + Berkeley",
                  "event_stream", "alco_transfers", "T1.2", "table", "monthly"),
    ArcgisDataset("alameda_sheriff_crime",
                  f"{ALAMEDA}/Crime_Reports_Jul2022_Present/FeatureServer/2",
                  "Sheriff Crime Reports (Jul 2022 - present)",
                  "unincorporated + contract cities only (Oakland PD feed is separate); 2012-2022 archive exists",
                  "event_stream", "alco_sheriff", "T1.3", "layer", "weekly"),
]

ALAMEDA_SPECS = [
    base.SourceSpec(
        key=d.key,
        name=f"Alameda County hub: {d.name}",
        geography="alameda_county",
        temporal_shape=d.temporal_shape,
        cadence=d.cadence,
        fmt="geojson" if d.kind == "layer" else "csv",
        license="Public (Alameda County ArcGIS Hub)",
        homepage="https://data.acgov.org",
        canonical_source=d.canonical_source,
        tier=d.tier,
        notes=d.tier_note,
    )
    for d in ALAMEDA_DATASETS
]
SPECS = SPECS + ALAMEDA_SPECS


def _fetch_arcgis_table(layer_url: str, *, page_size: int = 2000, timeout: int = 120) -> list[dict]:
    """Page an ArcGIS TABLE (no geometry — f=geojson would error) via f=json."""
    import time

    rows: list[dict] = []
    offset = 0
    while True:
        d = None
        for attempt in range(5):  # backoff must outlive minute-scale DNS outages
            try:
                resp = requests.get(
                    layer_url.rstrip("/") + "/query",
                    params={"where": "1=1", "outFields": "*", "f": "json",
                            "resultOffset": offset, "resultRecordCount": page_size},
                    headers=base.DEFAULT_HEADERS, timeout=timeout,
                )
                resp.raise_for_status()
                d = resp.json()
                break
            except (requests.RequestException, ValueError):
                if attempt == 4:
                    raise
                time.sleep(10 * (2 ** attempt))
        if "error" in d:
            raise RuntimeError(f"ArcGIS error: {d['error']}")
        feats = d.get("features", [])
        rows.extend(f["attributes"] for f in feats)
        if len(feats) < page_size:
            return rows
        offset += len(feats)


def ingest_alameda(ds: ArcgisDataset, *, force: bool = False) -> None:
    as_of = base.arcgis_layer_as_of(ds.layer_url) or base.today()
    as_of_str = as_of.isoformat()
    if not force and base.snapshot_exists(ds.key, as_of_str):
        print(f"[current] {ds.key}: already have snapshot as_of {as_of_str}")
        return
    print(f"[pull] {ds.key} ({ds.name}) as_of {as_of_str}")
    snap = base.Snapshot(
        ds.key, as_of_str, geography="alameda_county",
        source_name=f"Alameda County hub: {ds.name}",
        license="Public (Alameda County ArcGIS Hub)", homepage="https://data.acgov.org",
    )
    if ds.kind == "layer":
        fc = base.fetch_arcgis_geojson(ds.layer_url, page_size=1000, timeout=180)
        snap.write_json("features.geojson", fc, source_url=ds.layer_url)
        print(f"    {len(fc.get('features', []))} features")
    else:
        rows = _fetch_arcgis_table(ds.layer_url)
        out = snap.dir / "rows.csv"
        with out.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        snap.record_file("rows.csv", url=ds.layer_url)
        print(f"    {len(rows):,} rows")
    snap.finalize(extra={"layer_url": ds.layer_url, "kind": ds.kind,
                         "tier_note": ds.tier_note, "temporal_shape": ds.temporal_shape})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="ingest only this key (e.g. oakland_crime, paloalto_permitviewer)")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    keys = [d.key for d in SOCRATA_DATASETS] + [PA_SPEC.key] + [d.key for d in ALAMEDA_DATASETS]
    if args.only and args.only not in keys:
        raise SystemExit(f"No key {args.only!r}. Options: {keys}")

    for d in SOCRATA_DATASETS:
        if args.only in (None, d.key):
            ingest_socrata(d, force=args.force)
    if args.only in (None, PA_SPEC.key):
        ingest_paloalto(force=args.force)
    for d in ALAMEDA_DATASETS:
        if args.only in (None, d.key):
            ingest_alameda(d, force=args.force)


if __name__ == "__main__":
    main()
