"""Acquire Overture Maps Places for the SF bbox, one dated snapshot per release.

Overture publishes monthly GeoParquet releases on public S3 and PRUNES old ones from
the bucket (verified 2026-07-25: only 2026-06-17.0 and 2026-07-22.0 remain). Each
release we capture is therefore history a later entrant cannot re-download -- this
source is where the time-moat literally accrues, so run this every month without fail.

No bulk download: DuckDB queries the remote GeoParquet with bbox pushdown (~30s and
a few MB per release for SF). source_as_of = the release's own date tag.

POI churn from snapshot diffs needs care (supplier changes masquerade as open/close);
the pipeline holds Overture out of events/metrics until >= 3 releases accumulate and
a 2-consecutive-absence rule can apply. Acquisition still starts NOW for that reason.

Usage:
    python -m app.ingestion.overture            # capture every release still on S3
"""

from __future__ import annotations

import re
import tempfile
from pathlib import Path

import requests

from app.ingestion import base

BUCKET_URL = "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/"
S3_GLOB = "s3://overturemaps-us-west-2/release/{version}/theme=places/type=place/*"
LICENSE = "CDLA-Permissive-2.0 (Overture Maps places theme)"
HOMEPAGE = "https://overturemaps.org"

# City proper incl. Treasure Island; matches the pipeline's areas registry footprint.
BBOX = {"xmin": -122.55, "xmax": -122.35, "ymin": 37.70, "ymax": 37.84}


def list_releases() -> list[str]:
    resp = requests.get(
        BUCKET_URL,
        params={"list-type": "2", "prefix": "release/", "delimiter": "/"},
        timeout=30,
    )
    resp.raise_for_status()
    return re.findall(r"<Prefix>release/([^<]+)/</Prefix>", resp.text)


def ingest(version: str) -> None:
    as_of = version.split(".")[0]  # '2026-07-22.0' -> release date
    source = "overture_places"
    if base.snapshot_exists(source, as_of):
        print(f"[current] overture {version}: already have snapshot as_of {as_of}")
        return

    print(f"[pull] overture places {version} (SF bbox, remote GeoParquet query)")
    import duckdb

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir) / "places.parquet"
        con.execute(
            f"""
            COPY (
                SELECT
                    id                    AS gers_id,
                    names.primary         AS name,
                    categories.primary    AS category,
                    confidence,
                    sources[1].dataset    AS source_dataset,
                    bbox.xmin             AS lon,
                    bbox.ymin             AS lat
                FROM read_parquet('{S3_GLOB.format(version=version)}', hive_partitioning=1)
                WHERE bbox.xmin BETWEEN {BBOX["xmin"]} AND {BBOX["xmax"]}
                  AND bbox.ymin BETWEEN {BBOX["ymin"]} AND {BBOX["ymax"]}
            ) TO '{tmp}' (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )
        n = con.execute(f"SELECT count(*) FROM read_parquet('{tmp}')").fetchone()[0]

        snap = base.Snapshot(
            source,
            as_of,
            geography="san_francisco_bbox",
            source_name=f"Overture Maps places {version}",
            license=LICENSE,
            homepage=HOMEPAGE,
        )
        snap.write_bytes("places.parquet", tmp.read_bytes())
        snap.finalize(extra={"release": version, "bbox": BBOX, "row_count": n})
    con.close()


def main() -> None:
    releases = list_releases()
    print(f"Releases still on S3: {releases} (older ones are pruned by Overture -- "
          f"what we don't capture now is gone)")
    for version in releases:
        ingest(version)


if __name__ == "__main__":
    main()
