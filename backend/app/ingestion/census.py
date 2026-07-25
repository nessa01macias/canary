"""US Census reference layers for California: TIGER boundaries + ACS 5-year.

These are the crosswalk inputs the areas builder (H3 spine) joins against.
TIGER is a straight download; ACS needs a free API key (CENSUS_API_KEY in .env) --
without it, fetch_acs() skips cleanly rather than failing.

    python -m app.ingestion.census
    python -m app.ingestion.census --only tiger
"""

import argparse
import os
from datetime import date

from dotenv import load_dotenv

from app.ingestion import base
from app.ingestion.base import SourceSpec

load_dotenv(base.BACKEND_DIR / ".env")

CA_FIPS = "06"

# --- TIGER/Line boundaries (California) --------------------------------------
TIGER = SourceSpec(
    key="census_tiger_ca",
    name="Census TIGER/Line boundaries — California (places, tracts, county subdivisions, counties)",
    geography="california",
    temporal_shape="reference_layer",
    cadence="annual",
    fmt="shapefile",
    license="US public domain",
    homepage="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html",
    canonical_source="census_tiger",
    tier="T2.5",
    notes="Places=incorporated cities+CDPs; tracts=ACS join geometry; cousub + county(national, filter STATEFP=06) => jurisdiction (county minus union of places = unincorporated).",
)
TIGER_VINTAGE = 2025
TIGER_FILES = {
    "tl_2025_06_place.zip": f"https://www2.census.gov/geo/tiger/TIGER{TIGER_VINTAGE}/PLACE/tl_{TIGER_VINTAGE}_06_place.zip",
    "tl_2025_06_tract.zip": f"https://www2.census.gov/geo/tiger/TIGER{TIGER_VINTAGE}/TRACT/tl_{TIGER_VINTAGE}_06_tract.zip",
    "tl_2025_06_cousub.zip": f"https://www2.census.gov/geo/tiger/TIGER{TIGER_VINTAGE}/COUSUB/tl_{TIGER_VINTAGE}_06_cousub.zip",
    "tl_2025_us_county.zip": f"https://www2.census.gov/geo/tiger/TIGER{TIGER_VINTAGE}/COUNTY/tl_{TIGER_VINTAGE}_us_county.zip",
}


def fetch_tiger(*, force: bool = False) -> None:
    tract_url = TIGER_FILES["tl_2025_06_tract.zip"]
    as_of = base.http_last_modified(tract_url) or date(TIGER_VINTAGE, 1, 1)
    as_of_str = as_of.isoformat()
    if not force and base.snapshot_exists(TIGER.key, as_of_str):
        print(f"[current] {TIGER.key}: already have snapshot as_of {as_of_str}")
        return
    print(f"[pull] {TIGER.key} (TIGER{TIGER_VINTAGE}) as_of {as_of_str}")
    snap = base.Snapshot(
        TIGER.key, as_of_str, geography=TIGER.geography,
        source_name=TIGER.name, license=TIGER.license, homepage=TIGER.homepage,
    )
    for name, url in TIGER_FILES.items():
        snap.download(name, url)
    snap.finalize(extra={"vintage": TIGER_VINTAGE, "state_fips": CA_FIPS})


# --- ACS 5-year (California tracts) ------------------------------------------
ACS = SourceSpec(
    key="census_acs_ca",
    name="Census ACS 5-year — California tracts (housing + tenure + turnover + age)",
    geography="california",
    temporal_shape="reference_layer",
    cadence="annual",
    fmt="csv",
    license="US public domain",
    homepage="https://www.census.gov/data/developers/data-sets/acs-5year.html",
    canonical_source="census_acs",
    tier="T5",
    requires_auth=True,
    notes="Needs free CENSUS_API_KEY. Vars chosen to avoid protected classes: value/tenure/age/turnover only (constraint #2).",
)
ACS_VINTAGE = 2023  # well-tested default; 2024 also available
ACS_VARS = {
    "B25077_001E": "median_home_value",
    "B25003_001E": "tenure_total",
    "B25003_002E": "tenure_owner",
    "B25003_003E": "tenure_renter",
    "B25035_001E": "median_year_structure_built",
    "B25039_001E": "median_year_moved_in",
    "B07003_001E": "geographic_mobility_total",
}


def fetch_acs(*, force: bool = False) -> None:
    key = os.environ.get("CENSUS_API_KEY")
    if not key:
        print(f"[skip] {ACS.key}: set CENSUS_API_KEY in .env to enable (free: https://api.census.gov/data/key_signup.html)")
        return
    import requests

    get_vars = "NAME," + ",".join(ACS_VARS)
    url = f"https://api.census.gov/data/{ACS_VINTAGE}/acs/acs5"
    params = {"get": get_vars, "for": "tract:*", "in": f"state:{CA_FIPS}", "key": key}
    resp = requests.get(url, params=params, headers=base.DEFAULT_HEADERS, timeout=120)
    resp.raise_for_status()
    rows = resp.json()

    as_of_str = f"{ACS_VINTAGE}-12-31"  # ACS vintage = end of the 5-year window
    if not force and base.snapshot_exists(ACS.key, as_of_str):
        print(f"[current] {ACS.key}: already have snapshot as_of {as_of_str}")
        return
    print(f"[pull] {ACS.key} (ACS5 {ACS_VINTAGE}) as_of {as_of_str}: {len(rows) - 1} tracts")
    snap = base.Snapshot(
        ACS.key, as_of_str, geography=ACS.geography,
        source_name=ACS.name, license=ACS.license, homepage=ACS.homepage,
    )
    snap.write_json("acs5_ca_tracts.json", rows, source_url=resp.url.split("&key=")[0])
    snap.finalize(extra={"vintage": ACS_VINTAGE, "variable_labels": ACS_VARS})


SPECS = [TIGER, ACS]
FETCHERS = {"tiger": fetch_tiger, "acs": fetch_acs}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=sorted(FETCHERS))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    fetchers = {args.only: FETCHERS[args.only]} if args.only else FETCHERS
    for name, fn in fetchers.items():
        try:
            fn(force=args.force)
        except Exception as exc:  # noqa: BLE001
            print(f"[error] {name}: {exc}")


if __name__ == "__main__":
    main()
