"""OpenStreetMap California extract (Geofabrik) — the compute-layer substrate.

Street/path network + sidewalks + POIs that power the DERIVED variables: walk/bike/
transit scores (T1.6), commute routing (T1.4/T4.1), sidewalk coverage (T3.10),
airport access (T4.8). We compute these ourselves from OSM rather than buy Walk Score.

~1.3GB .osm.pbf, rebuilt daily by Geofabrik. Reference layer: source_as_of = the
build's Last-Modified date.

    python -m app.ingestion.osm
"""

import argparse

from app.ingestion import base
from app.ingestion.base import SourceSpec

URL = "https://download.geofabrik.de/north-america/us/california-latest.osm.pbf"

SPEC = SourceSpec(
    key="osm_california",
    name="OpenStreetMap California extract (Geofabrik)",
    geography="california",
    temporal_shape="reference_layer",
    cadence="daily",
    fmt="osm_pbf",
    license="ODbL 1.0",
    homepage="https://download.geofabrik.de/north-america/us/california.html",
    canonical_source="osm",
    tier="T1.4/T1.6/T3.10/T4.1/T4.8",
    notes="~1.3GB. Substrate for computed walk/commute/sidewalk/airport-access variables. norcal/socal sub-extracts exist if the full state is too big.",
)


def fetch(*, force: bool = False) -> None:
    as_of = (base.http_last_modified(URL) or base.today()).isoformat()
    if not force and base.snapshot_exists(SPEC.key, as_of):
        print(f"[current] {SPEC.key}: already have snapshot as_of {as_of}")
        return
    print(f"[pull] {SPEC.key} as_of {as_of} (~1.3GB, this takes a while)")
    snap = base.Snapshot(
        SPEC.key, as_of, geography=SPEC.geography,
        source_name=SPEC.name, license=SPEC.license, homepage=SPEC.homepage,
    )
    snap.download("california-latest.osm.pbf", URL, timeout=1800)
    snap.finalize()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    fetch(force=args.force)


if __name__ == "__main__":
    main()
