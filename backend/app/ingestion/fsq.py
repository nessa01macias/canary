"""Foursquare OS Places — SF bbox extract via DuckDB authed HF read.

The second POI witness alongside Overture: where both sources agree an area is
churning (openings/closings), that agreement is the confidence signal the pipeline's
signal-quality test wants. FSQ ships date_created/date_closed natively, so open/close
is directly readable (noisy, but doesn't need cross-release diffing like Overture).

SF bbox matches app/ingestion/overture.py exactly so the two are directly comparable.
Gated dataset -> needs HF_TOKEN in .env (never written to L0 metadata).

    python -m app.ingestion.fsq
"""

import argparse
import os

import duckdb
import requests
from dotenv import load_dotenv

from app.ingestion import base
from app.ingestion.base import SourceSpec

load_dotenv(base.BACKEND_DIR / ".env")

# Same SF bbox as overture.py (city proper incl. Treasure Island) for witness comparison.
BBOX = {"xmin": -122.55, "xmax": -122.35, "ymin": 37.70, "ymax": 37.84}
HF_REPO = "foursquare/fsq-os-places"
TREE_API = f"https://huggingface.co/api/datasets/{HF_REPO}/tree/main/release"
HF_GLOB = "hf://datasets/{repo}/release/dt={dt}/places/parquet/*.parquet"

SPEC = SourceSpec(
    key="fsq_os_places",
    name="Foursquare OS Places — SF bbox extract",
    geography="san_francisco",
    temporal_shape="recurring_snapshot",
    cadence="monthly",
    fmt="parquet",
    license="Apache-2.0",
    homepage="https://huggingface.co/datasets/foursquare/fsq-os-places",
    canonical_source="fsq",
    tier="T4.4/T6.5",
    requires_auth=True,
    notes="2nd POI witness vs Overture (same SF bbox). date_created/date_closed native. Needs HF_TOKEN.",
)


def discover_latest_dt(token: str) -> str:
    resp = requests.get(TREE_API, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    resp.raise_for_status()
    dts = sorted(p["path"].split("dt=")[-1] for p in resp.json() if "dt=" in p.get("path", ""))
    if not dts:
        raise RuntimeError("No dt= release partitions found on HF")
    return dts[-1]


def fetch(*, force: bool = False) -> None:
    token = os.environ.get("HF_TOKEN")
    if not token:
        print(f"[skip] {SPEC.key}: set HF_TOKEN in .env (https://huggingface.co/settings/tokens)")
        return

    dt = discover_latest_dt(token)
    if not force and base.snapshot_exists(SPEC.key, dt):
        print(f"[current] {SPEC.key}: already have snapshot for release {dt}")
        return

    snap = base.Snapshot(
        SPEC.key, dt, geography=SPEC.geography,
        source_name=SPEC.name, license=SPEC.license, homepage=SPEC.homepage,
    )
    out_path = snap.dir / "places_sf.parquet"
    src = HF_GLOB.format(repo=HF_REPO, dt=dt)

    print(f"[pull] {SPEC.key} release {dt}, SF bbox (scanning all parquet parts...)")
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET enable_progress_bar=false;")
    con.execute(f"CREATE SECRET (TYPE huggingface, TOKEN '{token}');")
    con.execute(
        f"""
        COPY (
            SELECT fsq_place_id, name, latitude AS lat, longitude AS lon,
                   fsq_category_labels, date_created, date_refreshed, date_closed
            FROM read_parquet('{src}')
            WHERE longitude BETWEEN {BBOX['xmin']} AND {BBOX['xmax']}
              AND latitude  BETWEEN {BBOX['ymin']} AND {BBOX['ymax']}
        ) TO '{out_path}' (FORMAT PARQUET, COMPRESSION ZSTD);
        """
    )
    n = con.execute(f"SELECT count(*) FROM read_parquet('{out_path}')").fetchone()[0]
    n_open = con.execute(
        f"SELECT count(*) FROM read_parquet('{out_path}') WHERE date_closed IS NULL"
    ).fetchone()[0]
    con.close()
    print(f"    {n} places ({n_open} currently open)")
    snap.record_file("places_sf.parquet", url=f"hf://datasets/{HF_REPO}/release/dt={dt}")
    snap.finalize(extra={"release_dt": dt, "bbox": BBOX, "n_places": n, "n_open": n_open})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    fetch(force=args.force)


if __name__ == "__main__":
    main()
