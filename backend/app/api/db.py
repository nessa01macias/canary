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


def business_changes_in_bbox(
    min_lng: float,
    min_lat: float,
    max_lng: float,
    max_lat: float,
    since: date | None,
    limit: int,
) -> list[dict]:
    """Business open/close events with the REGISTERED NAME joined from places
    (events carry only NAICS in detail). Clamped to <= today: the registry has
    future/typo dates (e.g. 'opened 2028') that would otherwise surface."""
    sql = """
        SELECT e.source, e.event_type, e.event_time, e.h3_9, e.lat, e.lon,
               e.neighborhood, COALESCE(p.name, e.detail) AS detail,
               e.value, e.units_delta, e.record_key, e.source_as_of
        FROM events e
        LEFT JOIN places p ON p.place_key = e.record_key
        WHERE e.lon BETWEEN ? AND ? AND e.lat BETWEEN ? AND ?
          AND e.event_type IN ('place_opened', 'place_closed')
          AND e.event_time <= CURRENT_DATE
    """
    params: list = [min_lng, max_lng, min_lat, max_lat]
    if since is not None:
        sql += " AND e.event_time >= ?"
        params.append(since)
    sql += " ORDER BY e.event_time DESC LIMIT ?"
    params.append(limit)
    return query(sql, params)


def biggest_construction_in_hexes(hexes: list[str], since: date | None, limit: int = 5) -> list[dict]:
    """The most consequential approved construction in the ring — by net housing
    units, then dollars. The report's hero fact ('what's approved to be built
    next to this address'), which recency-ordered queries drown in 311 noise."""
    placeholders = ",".join(["?"] * len(hexes))
    sql = f"""
        SELECT source, event_type, event_time, h3_9, lat, lon,
               neighborhood, detail, value, units_delta, record_key, source_as_of
        FROM events
        WHERE h3_9 IN ({placeholders})
          AND event_type IN ('permit_issued', 'permit_filed')
          AND (units_delta > 0 OR value >= 500000)
    """
    params: list = list(hexes)
    if since is not None:
        sql += " AND event_time >= ?"
        params.append(since)
    sql += " ORDER BY units_delta DESC NULLS LAST, value DESC NULLS LAST LIMIT ?"
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


def hex_trajectory(metric: str) -> list[dict]:
    """Every res-9 hex's precomputed trajectory for one metric, with the hex
    polygon boundary as WKT — the sub-neighborhood texture layer ("which corner
    of the neighborhood is changing"). One query, ~1,100 rows; the serving layer
    turns it into GeoJSON and caches it."""
    return query(
        """
        SELECT t.area_id AS h3_9, a.neighborhood,
               h3_cell_to_boundary_wkt(t.area_id) AS boundary_wkt,
               t.last12, t.prior12, t.pct_change, t.slope36, t.z,
               t.source, t.source_as_of
        FROM trajectory t
        LEFT JOIN areas a ON a.h3_9 = t.area_id
        WHERE t.area_level = 'h3_9' AND t.metric = ? AND t.rankable
        """,
        [metric],
    )


def neighborhood_trends(metrics: list[str]) -> list[dict]:
    """Per-(neighborhood, metric) change signal, read from the pipeline's
    precomputed L3 `trajectory` table (last12/prior12/pct_change/z, provenance
    included) — the single source of truth for 'is this rising or falling'.
    Only `rankable` rows (enough active months to trust the comparison)."""
    placeholders = ",".join(["?"] * len(metrics))
    return query(
        f"""
        SELECT area_id, metric, last12, prior12, pct_change, z, source_as_of
        FROM trajectory
        WHERE area_level = 'neighborhood' AND rankable AND metric IN ({placeholders})
        """,
        metrics,
    )


def area_attributes(h3_9: str) -> dict:
    """Reference-layer attributes for one hex — every non-spine column on its
    `areas` row (flood zone, fire hazard, school area, parking regime… as the
    pipeline stages them). Dynamic pass-through: new columns appear here with
    zero API changes (FRONTEND_DATA_CONTRACT pattern 3)."""
    rows = query("SELECT * FROM areas WHERE h3_9 = ?", [h3_9])
    if not rows:
        return {}
    spine = {"h3_9", "h3_8", "h3_7", "neighborhood"}
    return {k: v for k, v in rows[0].items() if k not in spine and v is not None}


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
