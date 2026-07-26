"""Foursquare OS Places — BAY AREA bbox extract via DuckDB authed HF read.

The second POI witness alongside Overture: where both sources agree an area is
churning (openings/closings), that agreement is the confidence signal the pipeline's
signal-quality test wants. FSQ ships date_created/date_closed natively, so open/close
is directly readable (noisy, but doesn't need cross-release diffing like Overture).

Scope history: extracts before 2026-07-26 are SF-only (the original bbox matched
overture.py for witness comparison — SF comparisons still work: SF ⊂ Bay). The
bbox was widened for the Bay Area fan-out; each snapshot's metadata records its
own bbox. Overture stays SF until its module widens too (pipeline lane).
Gated dataset -> needs HF_TOKEN in .env (never written to L0 metadata).

    python -m app.ingestion.fsq
    python -m app.ingestion.fsq --backfill   # re-extract every release at current bbox
"""

import argparse
import os

import duckdb
import requests
from dotenv import load_dotenv

from app.ingestion import base
from app.ingestion.base import SourceSpec

load_dotenv(base.BACKEND_DIR / ".env")

# Bay Area: SF + Oakland + Berkeley + San Jose + Palo Alto (and everything between).
BBOX = {"xmin": -122.55, "xmax": -121.70, "ymin": 37.15, "ymax": 37.95}
HF_REPO = "foursquare/fsq-os-places"
TREE_API = f"https://huggingface.co/api/datasets/{HF_REPO}/tree/main/release"
HF_GLOB = "hf://datasets/{repo}/release/dt={dt}/places/parquet/*.parquet"

SPEC = SourceSpec(
    key="fsq_os_places",
    name="Foursquare OS Places — Bay Area bbox extract",
    geography="bay_area",
    temporal_shape="recurring_snapshot",
    cadence="monthly",
    fmt="parquet",
    license="Apache-2.0",
    homepage="https://huggingface.co/datasets/foursquare/fsq-os-places",
    canonical_source="fsq",
    tier="T4.4/T6.5",
    requires_auth=True,
    notes="2nd POI witness vs Overture. Bay bbox since 2026-07-26 (pre-dating snapshots are SF-only; per-snapshot bbox in metadata). Needs HF_TOKEN.",
)


def discover_dts(token: str) -> list[str]:
    resp = requests.get(TREE_API, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    resp.raise_for_status()
    dts = sorted(p["path"].split("dt=")[-1] for p in resp.json() if "dt=" in p.get("path", ""))
    if not dts:
        raise RuntimeError("No dt= release partitions found on HF")
    return dts


def _ingest_dt(dt: str, token: str, *, force: bool = False) -> None:
    if not force and base.snapshot_exists(SPEC.key, dt):
        print(f"[current] {SPEC.key} {dt}: already have snapshot")
        return
    snap = base.Snapshot(
        SPEC.key, dt, geography=SPEC.geography,
        source_name=SPEC.name, license=SPEC.license, homepage=SPEC.homepage,
    )
    # Filename kept from the SF era on purpose: readers glob places_sf.parquet
    # across ALL snapshots (nbhd_attributes.py); scope lives in metadata.bbox.
    out_path = snap.dir / "places_sf.parquet"
    src = HF_GLOB.format(repo=HF_REPO, dt=dt)
    print(f"[pull] {SPEC.key} release {dt}, Bay Area bbox (scanning parquet parts...)")
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
    print(f"    {dt}: {n} places ({n_open} open)")
    snap.record_file("places_sf.parquet", url=f"hf://datasets/{HF_REPO}/release/dt={dt}")
    snap.finalize(extra={"release_dt": dt, "bbox": BBOX, "bbox_scope": "bay_area",
                         "n_places": n, "n_open": n_open})


def fetch(*, force: bool = False, backfill: bool = False) -> None:
    token = os.environ.get("HF_TOKEN")
    if not token:
        print(f"[skip] {SPEC.key}: set HF_TOKEN in .env (https://huggingface.co/settings/tokens)")
        return
    dts = discover_dts(token)
    targets = dts if backfill else [dts[-1]]
    print(f"[fsq] {'backfilling all' if backfill else 'latest'}: {targets}")
    for dt in targets:
        try:
            _ingest_dt(dt, token, force=force)
        except Exception as exc:  # noqa: BLE001 - one bad release shouldn't halt the backfill
            print(f"[error] {SPEC.key} {dt}: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--backfill", action="store_true", help="pull every dt= partition (POI history)")
    args = parser.parse_args()
    fetch(force=args.force, backfill=args.backfill)


if __name__ == "__main__":
    main()
