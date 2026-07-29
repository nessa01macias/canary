"""Place search over the ingested Overture Maps Places snapshot.

MapTiler geocoding (used by the frontend address field) covers chains and
landmarks but misses small independents — search "Palmetto Superfoods" and it
fuzzy-falls-back to "Palmetto Avenue". Overture's Places theme covers those small
businesses, and the data engine already snapshots it monthly
(app/ingestion/overture.py → data/raw/overture_places/<as_of>/places.parquet).

This endpoint searches the LATEST local snapshot by name. Reading the raw snapshot
directly is fine here: a name→point lookup doesn't need the change-detection
maturity the pipeline gates events/metrics on (that's about POI churn, not search).

If no snapshot is present, we return [] and the frontend simply falls back to
MapTiler — so this is safe to ship before the first Overture ingestion has landed.

Env: OVERTURE_PLACES_PARQUET overrides the parquet path (else newest snapshot).
"""

from __future__ import annotations

import glob
import os
import time
from pathlib import Path

from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/places", tags=["places"])

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_SNAP_GLOB = str(_BACKEND_DIR / "data" / "raw" / "overture_places" / "*" / "places.parquet")

# Resolve the snapshot path at most once per minute — the file set only changes
# when a monthly ingestion runs, so there's no reason to re-glob per keystroke.
_PATH_TTL = 60
_path_cache: tuple[float, str | None] = (0.0, None)


class Place(BaseModel):
    id: str
    label: str
    category: str | None = None
    center: list[float]  # [lon, lat] — matches the frontend PickedAddress.center


def _latest_parquet() -> str | None:
    global _path_cache
    now = time.time()
    if now - _path_cache[0] < _PATH_TTL:
        return _path_cache[1]

    override = os.environ.get("OVERTURE_PLACES_PARQUET", "").strip()
    if override:
        resolved = override if Path(override).exists() else None
    else:
        paths = glob.glob(_SNAP_GLOB)
        # snapshot dir is named by source_as_of (an ISO date) → lexical max == newest
        resolved = max(paths, key=lambda p: Path(p).parent.name) if paths else None

    _path_cache = (now, resolved)
    return resolved


@router.get("/search", response_model=list[Place])
def search_places(
    q: str = Query(..., min_length=2),
    limit: int = Query(8, ge=1, le=20),
) -> list[Place]:
    path = _latest_parquet()
    if not path:
        return []

    term = q.strip()
    like = f"%{term}%"
    prefix = f"{term}%"
    # `path` is server-controlled (env / our own snapshot dir), never user input —
    # safe to inline; only the user's query/limit are bound parameters.
    sql = (
        "SELECT gers_id, name, category, lon, lat "
        f"FROM read_parquet('{path}') "
        "WHERE name IS NOT NULL AND name ILIKE ? "
        "ORDER BY (name ILIKE ?) DESC, confidence DESC NULLS LAST "
        "LIMIT ?"
    )
    try:
        import duckdb

        con = duckdb.connect(database=":memory:")
        try:
            rows = con.execute(sql, [like, prefix, limit]).fetchall()
        finally:
            con.close()
    except Exception:
        # Missing/corrupt parquet, schema drift, DuckDB error — degrade to MapTiler.
        return []

    return [
        Place(id=f"ovt:{r[0]}", label=r[1], category=r[2], center=[float(r[3]), float(r[4])])
        for r in rows
    ]
