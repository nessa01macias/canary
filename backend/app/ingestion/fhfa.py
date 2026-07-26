"""FHFA House Price Index at Census-tract level — the area price TARGET variable.

The missing half of the forecasting story: CA assessor rolls are Prop-13-capped
(useless as market price), but FHFA's tract-level annual HPI (Bogin-Doerner-Larson
repeat-sales index) is free, national, and goes back decades. This is what the
trajectory-features-predict-price validation runs against ("do our 2023 metrics
predict 2024-26 tract HPI better than a naive baseline?").

Annual release; national CSV (~90MB) snapshotted whole (CA filtering is staging's
job). US public domain.

    python -m app.ingestion.fhfa
"""

import argparse

from app.ingestion import base
from app.ingestion.base import SourceSpec

URL = "https://www.fhfa.gov/hpi/download/annual/hpi_at_tract.csv"
# FHFA (like CDE) serves errors to unknown UAs — use a browser-ish one.
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

SPEC = SourceSpec(
    key="fhfa_hpi_tract",
    name="FHFA House Price Index — census tract (annual, national)",
    geography="us",
    temporal_shape="reference_layer",
    cadence="annual",
    fmt="csv",
    license="US public domain (FHFA)",
    homepage="https://www.fhfa.gov/data/hpi/datasets",
    canonical_source="fhfa_hpi",
    tier="T1.1",
    notes="Repeat-sales tract HPI (BDL). THE open area-price target: validates trajectory->price. "
    "Filter STATE=06/tract FIPS downstream; join via census_tiger_ca tracts.",
)


def fetch(*, force: bool = False) -> None:
    as_of = base.http_last_modified(URL) or base.today()
    as_of_str = as_of.isoformat()
    if not force and base.snapshot_exists(SPEC.key, as_of_str):
        print(f"[current] {SPEC.key}: already have snapshot as_of {as_of_str}")
        return
    print(f"[pull] {SPEC.key} as_of {as_of_str} (~90MB national tract CSV)")
    snap = base.Snapshot(
        SPEC.key, as_of_str, geography=SPEC.geography,
        source_name=SPEC.name, license=SPEC.license, homepage=SPEC.homepage,
    )
    snap.download("hpi_at_tract.csv", URL, headers=HEADERS, timeout=600)
    snap.finalize()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    fetch(force=args.force)


if __name__ == "__main__":
    main()
