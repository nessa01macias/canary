"""Shared pipeline plumbing: paths, DuckDB connection, snapshot discovery.

The pipeline sits downstream of app/ingestion (which owns data/raw/):

  L0  data/raw/<source>/<source_as_of>/        immutable snapshots (ingestion's contract)
  L1  data/staged/<source>/<source_as_of>.parquet   typed, h3-indexed, timestamp-stamped
  L2+ data/canary.duckdb                       canonical events/places/areas + metrics

A raw snapshot participates only once it is FINALIZED (its metadata.json exists) --
this is what makes it safe to run the pipeline while an ingestion is still downloading.

Every staged row carries `source_as_of` and `fetched_at` copied from the snapshot's
metadata.json, so the two-date discipline survives into every downstream table.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import duckdb

BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
STAGED_DIR = DATA_DIR / "staged"
PROCESSED_DIR = DATA_DIR / "processed"
DB_PATH = DATA_DIR / "canary.duckdb"

H3_RES = 9  # ~0.1 km2 hex, the atomic area unit ("within ~300m of an address")


def connect(db_path: Path | None = None, *, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(str(db_path or DB_PATH), read_only=read_only)
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("INSTALL h3 FROM community; LOAD h3;")
    return con


@dataclass(frozen=True)
class RawSnapshot:
    source: str
    source_as_of: str  # ISO date, the source's own freshness
    fetched_at: str  # ISO timestamp, when we pulled it
    dir: Path

    @property
    def rows_csv(self) -> Path:
        return self.dir / "rows.csv"


def finalized_snapshots(source: str) -> list[RawSnapshot]:
    """All finalized snapshots for a source, oldest first. Unfinalized dirs are skipped."""
    out = []
    source_dir = RAW_DIR / source
    if not source_dir.exists():
        return out
    for snap_dir in sorted(source_dir.iterdir()):
        meta_path = snap_dir / "metadata.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text())
        out.append(
            RawSnapshot(
                source=source,
                source_as_of=meta["source_as_of"],
                fetched_at=meta["fetched_at"],
                dir=snap_dir,
            )
        )
    return out


def latest_snapshot(source: str) -> RawSnapshot | None:
    snaps = finalized_snapshots(source)
    return snaps[-1] if snaps else None


def staged_path(source: str, source_as_of: str) -> Path:
    return STAGED_DIR / source / f"{source_as_of}.parquet"


def latest_staged(source: str) -> Path | None:
    source_dir = STAGED_DIR / source
    if not source_dir.exists():
        return None
    files = sorted(source_dir.glob("*.parquet"))
    return files[-1] if files else None


def pipeline_version() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=BACKEND_DIR,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unversioned"
