"""
Read-only access to the L3 canary.duckdb the pipeline chat produces.

This layer only READS. It never builds tables — that boundary belongs to
app/pipeline. If the pipeline is mid-rebuild, a read may briefly fail; callers
should treat that as a transient 503, not an error to design around.

Everything here is geography-agnostic: queries are by H3 cell or bounding box,
so the same code serves SF today and Tokyo the day its data lands.
"""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path

import duckdb

# backend/data/canary.duckdb, overridable for deploys.
_DEFAULT_DB = Path(__file__).resolve().parents[2] / "data" / "canary.duckdb"
DB_PATH = Path(os.environ.get("CANARY_DUCKDB", _DEFAULT_DB))

# Raw source/event_type -> coarse display category. Data-driven fallback to
# 'other' means a new source added upstream never breaks the API.
CATEGORY_BY_EVENT_TYPE: dict[str, str] = {
    "permit_filed": "construction",
    "permit_issued": "construction",
    "permit_completed": "construction",
    "place_opened": "business",
    "place_closed": "business",
    "license_issued": "business",
    "crime_incident": "safety",
    "noise_complaint": "safety",
    "eviction_notice": "housing",
}

CATEGORY_BY_METRIC: dict[str, str] = {
    "permits_filed": "construction",
    "permits_issued": "construction",
    "permit_cost_issued_usd": "construction",
    "units_approved_net": "construction",
    "biz_openings": "business",
    "biz_closings": "business",
    "crime_incidents": "safety",
    "evictions_filed": "housing",
}


def category_for_event(event_type: str) -> str:
    return CATEGORY_BY_EVENT_TYPE.get(event_type, "other")


def category_for_metric(metric: str) -> str:
    return CATEGORY_BY_METRIC.get(metric, "other")


def event_types_for_category(category: str) -> list[str]:
    """Reverse map: a coarse category -> the raw event_types it covers."""
    return [et for et, cat in CATEGORY_BY_EVENT_TYPE.items() if cat == category]


def _open() -> duckdb.DuckDBPyConnection:
    """
    A fresh read-only connection per call. We deliberately do NOT hold the DB
    file open between requests: the pipeline chat does a full rebuild/atomic
    swap of canary.duckdb, and a long-lived reader would block it. Read-only
    connect + immediate close keeps the writer unblocked. Open cost is ~ms.
    """
    if not DB_PATH.exists():
        raise FileNotFoundError(
            f"canary.duckdb not found at {DB_PATH}. Run the pipeline first "
            "(`make pipeline` in backend/) or set CANARY_DUCKDB."
        )
    con = duckdb.connect(str(DB_PATH), read_only=True)
    # Load H3 for the report ring path. Try LOAD first (offline, fast); fall
    # back to INSTALL only if the extension isn't cached locally yet.
    try:
        con.execute("LOAD h3;")
    except Exception:  # noqa: BLE001
        try:
            con.execute("INSTALL h3 FROM community; LOAD h3;")
        except Exception:  # noqa: BLE001 - h3 optional; ring path degrades gracefully
            pass
    return con


def query(sql: str, params: list | None = None) -> list[dict]:
    con = _open()
    try:
        cur = con.execute(sql, params or [])
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        con.close()


# --------------------------------------------------------------------------- #
#  Spatial helpers (H3-native, so they work for any metro)
# --------------------------------------------------------------------------- #
def hex_for_point(lat: float, lon: float, res: int = 9) -> str:
    return query(
        "SELECT h3_latlng_to_cell_string(?, ?, ?) AS h",
        [lat, lon, res],
    )[0]["h"]


def ring_hexes(h3_9: str, k: int) -> list[str]:
    rows = query("SELECT UNNEST(h3_grid_disk(?, ?)) AS h", [h3_9, k])
    return [r["h"] for r in rows]


# --------------------------------------------------------------------------- #
#  Reads used by the routes
# --------------------------------------------------------------------------- #
def changes_in_bbox(
    min_lng: float,
    min_lat: float,
    max_lng: float,
    max_lat: float,
    since: date | None,
    limit: int,
    event_types: list[str] | None = None,
) -> list[dict]:
    sql = """
        SELECT source, event_type, event_time, h3_9, lat, lon,
               neighborhood, detail, value, units_delta, record_key, source_as_of
        FROM events
        WHERE lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?
    """
    params: list = [min_lng, max_lng, min_lat, max_lat]
    if event_types:
        placeholders = ",".join(["?"] * len(event_types))
        sql += f" AND event_type IN ({placeholders})"
        params.extend(event_types)
    if since is not None:
        sql += " AND event_time >= ?"
        params.append(since)
    sql += " ORDER BY event_time DESC NULLS LAST LIMIT ?"
    params.append(limit)
    return query(sql, params)


def changes_in_hexes(hexes: list[str], since: date | None, limit: int) -> list[dict]:
    placeholders = ",".join(["?"] * len(hexes))
    sql = f"""
        SELECT source, event_type, event_time, h3_9, lat, lon,
               neighborhood, detail, value, units_delta, record_key, source_as_of
        FROM events
        WHERE h3_9 IN ({placeholders})
    """
    params: list = list(hexes)
    if since is not None:
        sql += " AND event_time >= ?"
        params.append(since)
    sql += " ORDER BY event_time DESC NULLS LAST LIMIT ?"
    params.append(limit)
    return query(sql, params)


def metric_series(area_ids: list[str], area_level: str, metric: str, months: int) -> list[dict]:
    placeholders = ",".join(["?"] * len(area_ids))
    sql = f"""
        SELECT period, SUM(value) AS value, SUM(n) AS n,
               ANY_VALUE(source) AS source, MAX(source_as_of) AS source_as_of,
               ANY_VALUE(pipeline_version) AS pipeline_version
        FROM metrics
        WHERE metric = ? AND area_level = ? AND area_id IN ({placeholders})
        GROUP BY period
        ORDER BY period DESC
        LIMIT ?
    """
    params: list = [metric, area_level, *area_ids, months]
    rows = query(sql, params)
    rows.reverse()  # chronological for the series
    return rows


def neighborhood_trends(metrics: list[str]) -> list[dict]:
    """Last-12-months vs prior-12-months sums per (neighborhood, metric), using
    the latest complete period in the table as the anchor. Real change signal —
    replaces the frontend's placeholder hashes."""
    placeholders = ",".join(["?"] * len(metrics))
    return query(
        f"""
        WITH bounds AS (
          SELECT MAX(period) AS maxp FROM metrics WHERE area_level = 'neighborhood'
        )
        SELECT area_id, metric,
               SUM(CASE WHEN period > maxp - INTERVAL 12 MONTH
                        THEN value ELSE 0 END) AS last12,
               SUM(CASE WHEN period <= maxp - INTERVAL 12 MONTH
                         AND period >  maxp - INTERVAL 24 MONTH
                        THEN value ELSE 0 END) AS prior12,
               MAX(source_as_of) AS source_as_of
        FROM metrics, bounds
        WHERE area_level = 'neighborhood' AND metric IN ({placeholders})
        GROUP BY area_id, metric
        """,
        metrics,
    )


def available_metrics() -> list[dict]:
    return query(
        """
        SELECT metric,
               LIST(DISTINCT area_level) AS area_levels,
               MIN(period) AS period_min,
               MAX(period) AS period_max
        FROM metrics
        GROUP BY metric
        ORDER BY metric
        """
    )
