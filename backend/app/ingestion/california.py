"""Statewide California sources (verified endpoints, 2026-07-24).

One fetch function per source; each declares a SourceSpec. All produce L0 in the
standard dated-snapshot shape via base.Snapshot.

    python -m app.ingestion.california            # all
    python -m app.ingestion.california --only abc # one
    python -m app.ingestion.california --force
"""

import argparse
from datetime import date

import requests

from app.ingestion import base
from app.ingestion.base import SourceSpec

# California bounding box (minLon, minLat, maxLon, maxLat)
CA_BBOX = (-124.48, 32.53, -114.13, 42.01)

# --- CA ABC alcoholic-beverage licenses --------------------------------------
# Full daily dump of active licenses w/ premises addresses. Change derived by diffing
# consecutive daily dumps (and issue dates embedded) -> recurring_snapshot.
ABC = SourceSpec(
    key="ca_abc_licenses",
    name="California ABC — Active License List (daily export)",
    geography="california",
    temporal_shape="recurring_snapshot",
    cadence="daily",
    fmt="zip",
    license="California public record",
    homepage="https://www.abc.ca.gov/licensing/licensing-reports/",
    canonical_source="ca_abc",
    tier="T6.10",
    notes="Address-level; premises need geocoding. Diff dumps for license_issued/surrendered events.",
)
ABC_URL = "https://www.abc.ca.gov/wp-content/uploads/DailyExport-CSV.zip"


def fetch_abc(*, force: bool = False) -> None:
    as_of = base.http_last_modified(ABC_URL) or base.today()
    _run_single_file(ABC, ABC_URL, "DailyExport-CSV.zip", as_of, force=force)


# --- CDE CAASPP standardized test scores -------------------------------------
CAASPP = SourceSpec(
    key="ca_caaspp",
    name="CDE CAASPP Smarter Balanced test results",
    geography="california",
    temporal_shape="reference_layer",
    cadence="annual",
    fmt="zip",
    license="CDE public research file",
    homepage="https://caaspp-elpac.ets.org/caaspp/",
    canonical_source="ca_caaspp",
    tier="T1.2",
    notes="Caret-delimited CSV in zip. School/district/county/state rows; ELA+Math g3-8,11. "
    "Deliberately the ALL-STUDENTS file (subgroup 1), NOT the all-subgroups file, to honor "
    "design constraint #2 (no protected-class breakdowns). Entities file maps codes->schools.",
)
CAASPP_TEST_YEAR = 2024  # 2023-24 results; bump annually
CAASPP_FILES = {
    "sb_ca2024_1_csv_v1.zip": "https://caaspp-elpac.ets.org/caaspp/researchfiles/sb_ca2024_1_csv_v1.zip",
    "sb_ca2024entities_csv.zip": "https://caaspp-elpac.ets.org/caaspp/researchfiles/sb_ca2024entities_csv.zip",
}


def fetch_caaspp(*, force: bool = False) -> None:
    first_url = next(iter(CAASPP_FILES.values()))
    as_of = base.http_last_modified(first_url) or date(CAASPP_TEST_YEAR, 10, 1)
    as_of_str = as_of.isoformat()
    if not force and base.snapshot_exists(CAASPP.key, as_of_str):
        print(f"[current] {CAASPP.key}: already have snapshot as_of {as_of_str}")
        return
    print(f"[pull] {CAASPP.key} (test year {CAASPP_TEST_YEAR}) as_of {as_of_str}")
    snap = _new_snapshot(CAASPP, as_of_str)
    for name, url in CAASPP_FILES.items():
        snap.download(name, url)
    snap.finalize(extra={"test_year": CAASPP_TEST_YEAR})


# --- CAL FIRE Fire Hazard Severity Zones -------------------------------------
FHSZ = SourceSpec(
    key="calfire_fhsz",
    name="CAL FIRE Fire Hazard Severity Zones",
    geography="california",
    temporal_shape="reference_layer",
    cadence="irregular",
    fmt="geojson",
    license="CAL FIRE — no distribution restrictions (attribute CAL FIRE)",
    homepage="https://gis.data.cnra.ca.gov/",
    canonical_source="calfire_fhsz",
    tier="T2.2",
    notes="services.gis.ca.gov REST; layers 0=SRA 1=LRA. This service = 2007/2011 vintage; CURRENT 2024/25 FHSZ is auth-gated on CAL FIRE Hub (GAP).",
)
FHSZ_BASE = "https://services.gis.ca.gov/arcgis/rest/services/Environment/Fire_Severity_Zones/MapServer"
FHSZ_LAYERS = {0: "fhsz_sra.geojson", 1: "fhsz_lra.geojson"}
FHSZ_VINTAGE_FALLBACK = date(2011, 1, 1)


def fetch_fhsz(*, force: bool = False) -> None:
    as_of = base.arcgis_layer_as_of(f"{FHSZ_BASE}/0") or FHSZ_VINTAGE_FALLBACK
    as_of_str = as_of.isoformat()
    if not force and base.snapshot_exists(FHSZ.key, as_of_str):
        print(f"[current] {FHSZ.key}: already have snapshot as_of {as_of_str}")
        return
    print(f"[pull] {FHSZ.key} as_of {as_of_str}")
    snap = _new_snapshot(FHSZ, as_of_str)
    for layer, fname in FHSZ_LAYERS.items():
        layer_url = f"{FHSZ_BASE}/{layer}"
        n = base.arcgis_count(layer_url)
        print(f"    layer {layer}: {n} features")
        fc = base.fetch_arcgis_geojson(layer_url)
        snap.write_json(fname, fc, source_url=layer_url)
    snap.finalize(extra={"vintage_note": "2007 SRA / 2011 LRA; current-vintage FHSZ is a known gap"})


# --- CA precinct-level election returns (Statewide Database, UC Berkeley) -----
PRECINCT = SourceSpec(
    key="ca_precinct_returns",
    name="CA Statewide Database — precinct election returns (2024 General)",
    geography="california",
    temporal_shape="reference_layer",
    cadence="per_election",
    fmt="zip",
    license="Academic/public — cite Statewide Database (UC Berkeley)",
    homepage="https://statewidedatabase.org/d20/g24.html",
    canonical_source="ca_precinct",
    tier="T5",
    notes="Precinct-level SOV, all 58 counties. G24=2024 General. Political composition (constraint 2 compliant: no protected-class).",
)
PRECINCT_ELECTION = "G24"
PRECINCT_FILES = {
    "state_g24_sov_data_by_g24_svprec.zip": "https://statewidedatabase.org/pub/data/G24/state/state_g24_sov_data_by_g24_svprec.zip",
    "G24_SOV_statewide_codebook.csv": "https://statewidedatabase.org/pub/data/G24/G24_SOV_statewide_codebook.csv",
}


def fetch_precinct(*, force: bool = False) -> None:
    first_url = next(iter(PRECINCT_FILES.values()))
    as_of = base.http_last_modified(first_url) or date(2024, 11, 5)
    as_of_str = as_of.isoformat()
    if not force and base.snapshot_exists(PRECINCT.key, as_of_str):
        print(f"[current] {PRECINCT.key}: already have snapshot as_of {as_of_str}")
        return
    print(f"[pull] {PRECINCT.key} ({PRECINCT_ELECTION}) as_of {as_of_str}")
    snap = _new_snapshot(PRECINCT, as_of_str)
    for name, url in PRECINCT_FILES.items():
        snap.download(name, url)
    snap.finalize(extra={"election": PRECINCT_ELECTION})


# --- CA DCC cannabis retailer licenses ---------------------------------------
# Undocumented public JSON API behind search.cannabis.ca.gov (no auth, updated daily).
# RetailerLocationSearch(bbox) is the working endpoint (the generic /Search is server-broken).
# Retailers only -- the area-relevant subset (storefront/nightlife signal, T6.10).
CANNABIS = SourceSpec(
    key="ca_cannabis_retailers",
    name="CA DCC — cannabis retailer licenses (statewide)",
    geography="california",
    temporal_shape="recurring_snapshot",
    cadence="daily",
    fmt="json",
    license="California public record",
    homepage="https://search.cannabis.ca.gov/",
    canonical_source="ca_dcc",
    tier="T6.10",
    notes="RetailerLocationSearch bbox API (no auth). Retailers only. issueDate/statusDate embedded => diff dumps for license events.",
)
CANNABIS_URL = "https://as-dcc-pub-cann-w-p-002.azurewebsites.net/licenses/RetailerLocationSearch"


def fetch_cannabis(*, force: bool = False) -> None:
    as_of = base.today()  # live API, updated daily; no snapshot date exposed
    as_of_str = as_of.isoformat()
    if not force and base.snapshot_exists(CANNABIS.key, as_of_str):
        print(f"[current] {CANNABIS.key}: already have snapshot as_of {as_of_str}")
        return
    lon_min, lat_min, lon_max, lat_max = CA_BBOX
    params = {
        "minLatitude": lat_min, "maxLatitude": lat_max,
        "minLongitude": lon_min, "maxLongitude": lon_max,
        "pageSize": 250,
    }
    # The API paginates (250/page); walk every page or the dataset silently truncates.
    records: list = []
    page = 1
    while True:
        resp = requests.get(
            CANNABIS_URL, params={**params, "pageNumber": page},
            headers=base.DEFAULT_HEADERS, timeout=90,
        )
        resp.raise_for_status()
        payload = resp.json()
        records.extend(payload.get("data") or [])
        meta = payload.get("metadata", {})
        if not meta.get("hasNext"):
            break
        page += 1
    total = meta.get("totalCount")
    print(f"[pull] {CANNABIS.key} as_of {as_of_str}: {len(records)} of {total} retailer licenses ({page} pages)")
    snap = _new_snapshot(CANNABIS, as_of_str)
    snap.write_json(
        "dcc_retailers_ca.json",
        {"metadata": {**meta, "pages_fetched": page}, "data": records},
        source_url=CANNABIS_URL,
    )
    snap.finalize(extra={"total_count": total, "rows": len(records), "bbox": CA_BBOX, "note": "retailers only; live daily API; paginated"})


# --- shared helpers ----------------------------------------------------------

SPECS = [ABC, CAASPP, FHSZ, PRECINCT, CANNABIS]
FETCHERS = {
    "abc": fetch_abc,
    "caaspp": fetch_caaspp,
    "fhsz": fetch_fhsz,
    "precinct": fetch_precinct,
    "cannabis": fetch_cannabis,
}


def _new_snapshot(spec: SourceSpec, as_of_str: str) -> base.Snapshot:
    return base.Snapshot(
        spec.key,
        as_of_str,
        geography=spec.geography,
        source_name=spec.name,
        license=spec.license,
        homepage=spec.homepage,
    )


def _run_single_file(spec: SourceSpec, url: str, fname: str, as_of: date, *, force: bool) -> None:
    as_of_str = as_of.isoformat()
    if not force and base.snapshot_exists(spec.key, as_of_str):
        print(f"[current] {spec.key}: already have snapshot as_of {as_of_str}")
        return
    print(f"[pull] {spec.key} as_of {as_of_str}")
    snap = _new_snapshot(spec, as_of_str)
    snap.download(fname, url)
    snap.finalize()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=sorted(FETCHERS))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    fetchers = {args.only: FETCHERS[args.only]} if args.only else FETCHERS
    for name, fn in fetchers.items():
        try:
            fn(force=args.force)
        except Exception as exc:  # noqa: BLE001 - one source failing shouldn't halt the rest
            print(f"[error] {name}: {exc}")


if __name__ == "__main__":
    main()
