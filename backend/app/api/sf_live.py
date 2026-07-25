"""
SF live-enrichment endpoints — the backend as the single data gateway.

The frontend no longer touches DataSF. It calls /api/sf/permits and
/api/sf/neighborhoods; this module fetches DataSF server-side and does ALL the
enrichment (permit change-story + neighborhood aggregation) that used to run in
the browser. Ported 1:1 from the former frontend/src/sfPermits.ts and
neighborhoods.ts so the map renders identically.

Results are cached briefly in-process so we don't hammer DataSF per request.
"""

from __future__ import annotations

import math
import time
from typing import Any

import httpx

PERMITS_URL = (
    "https://data.sfgov.org/resource/i98e-djp9.json"
    "?$limit=300&$order=permit_creation_date DESC"
)
NBHD_GEOJSON_URL = (
    "https://data.sfgov.org/api/geospatial/j2bu-swwd?method=export&format=GeoJSON"
)

_CACHE_TTL = 600  # seconds
_cache: dict[str, tuple[float, Any]] = {}


async def _get_json(url: str) -> Any:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.json()


async def _cached(key: str, url: str) -> Any:
    hit = _cache.get(key)
    if hit and (time.time() - hit[0]) < _CACHE_TTL:
        return hit[1]
    data = await _get_json(url)
    _cache[key] = (time.time(), data)
    return data


# --------------------------------------------------------------------------- #
#  Permit enrichment (port of sfPermits.ts deriveStage / deriveChange)
# --------------------------------------------------------------------------- #
def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        n = float(v)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def _tidy(s: Any) -> str | None:
    return s.strip().lower() if isinstance(s, str) and s.strip() else None


def _derive_stage(p: dict) -> str:
    if p.get("issued_date"):
        return "issued"
    if p.get("approved_date"):
        return "approved"
    if p.get("filed_date"):
        return "filed"
    return "unknown"


def _derive_change(p: dict) -> tuple[str, str]:
    eu, pu = _num(p.get("existing_units")), _num(p.get("proposed_units"))
    es, ps = _num(p.get("number_of_existing_stories")), _num(p.get("number_of_proposed_stories"))
    ex_use, pr_use = _tidy(p.get("existing_use")), _tidy(p.get("proposed_use"))
    is_adu = str(p.get("adu")).lower() == "true" or p.get("adu") == "1"

    if eu is not None and pu is not None and pu > eu:
        return "densify", f"{int(eu)} → {int(pu)} units"
    if ex_use and pr_use and ex_use != pr_use:
        return "convert", f"{p.get('existing_use')} → {p.get('proposed_use')}"
    if es is not None and ps is not None and ps > es:
        d = int(ps - es)
        return "taller", f"+{d} {'story' if d == 1 else 'stories'} ({int(es)} → {int(ps)})"
    if is_adu:
        return "adu", "ADU added"
    if (eu is None or eu == 0) and pu is not None and pu > 0:
        return "newbuild", f"new — {int(pu)} {'unit' if pu == 1 else 'units'}"
    return "alteration", p.get("permit_type_definition") or "alteration"


def _enrich_permit(p: dict) -> dict | None:
    loc = p.get("location")
    if not loc or not loc.get("coordinates"):
        return None
    lng, lat = loc["coordinates"]
    address = " ".join(
        str(x) for x in (p.get("street_number"), p.get("street_name"), p.get("street_suffix")) if x
    )
    cost = _num(p.get("revised_cost")) or _num(p.get("estimated_cost"))
    stage = _derive_stage(p)
    change_type, change_label = _derive_change(p)
    eu, pu = _num(p.get("existing_units")), _num(p.get("proposed_units"))
    net_units = (pu - eu) if (eu is not None and pu is not None) else None
    nbhd = p.get("neighborhoods_analysis_boundaries")

    return {
        "id": f"sf-{p.get('permit_number')}",
        "lng": lng,
        "lat": lat,
        "city": "San Francisco",
        "headline": change_label,  # the change IS the headline
        "detail": f"{address or 'San Francisco'} — {p.get('description') or 'no description'}",
        "source": f"DataSF Building Permits · {nbhd or 'SF'}",
        "kind": "construction",
        "neighborhood": nbhd,
        "cost": cost,
        "stage": stage,
        "changeType": change_type,
        "changeLabel": change_label,
        "existingUse": p.get("existing_use"),
        "proposedUse": p.get("proposed_use"),
        "existingUnits": eu,
        "proposedUnits": pu,
        "existingStories": _num(p.get("number_of_existing_stories")),
        "proposedStories": _num(p.get("number_of_proposed_stories")),
        "netUnits": net_units,
        "status": p.get("status"),
    }


async def get_permits() -> list[dict]:
    raw = await _cached("permits", PERMITS_URL)
    return [e for p in raw if (e := _enrich_permit(p)) is not None]


# --------------------------------------------------------------------------- #
#  Neighborhood aggregation (port of neighborhoods.ts aggregate / describe)
# --------------------------------------------------------------------------- #
def _describe(a: dict) -> str:
    if a["permits"] == 0:
        return "No recent permit activity"
    if a["netUnits"] >= 5 or a["densify"] >= 3:
        return "Densifying — parcels adding units"
    if a["convert"] >= 3:
        return "Use converting — buildings changing purpose"
    if a["taller"] >= 3:
        return "Building taller — added stories"
    if a["totalCost"] >= 10_000_000:
        return "Capital-intensive — large-dollar projects"
    if a["adu"] >= 3:
        return "Backyard density — ADUs added"
    return "Steady — mostly minor alterations"


def _score(a: dict) -> float:
    return (
        a["netUnits"] * 3
        + a["densify"] * 2
        + a["convert"] * 2
        + a["taller"] * 2
        + a["adu"] * 1
        + math.log10(a["totalCost"] + 1) * 2
        + a["permits"] * 0.3
    )


def _aggregate(points: list[dict]) -> dict[str, dict]:
    raw: dict[str, dict] = {}
    for p in points:
        nb = p.get("neighborhood")
        if not nb:
            continue
        a = raw.setdefault(
            nb,
            {"nhood": nb, "permits": 0, "totalCost": 0.0, "netUnits": 0.0,
             "densify": 0, "convert": 0, "taller": 0, "adu": 0},
        )
        a["permits"] += 1
        a["totalCost"] += p.get("cost") or 0
        a["netUnits"] += max(0, p.get("netUnits") or 0)
        ct = p.get("changeType")
        if ct in ("densify", "convert", "taller", "adu"):
            a[ct] += 1

    max_score = max([1.0, *[_score(a) for a in raw.values()]])
    out: dict[str, dict] = {}
    for nb, a in raw.items():
        out[nb] = {**a, "intensity": min(1.0, _score(a) / max_score), "descriptor": _describe(a)}
    return out


# --------------------------------------------------------------------------- #
#  Real per-neighborhood trends from the pipeline's DuckDB metrics (replaces the
#  frontend's placeholder hashes). Rank-normalized 0..1 across neighborhoods so
#  the overlay's diverging ramp always spans its range.
# --------------------------------------------------------------------------- #
TREND_METRICS = {
    "crime_incidents": "crimeTrend",       # higher = crime rising
    "biz_openings": "bizOpenTrend",        # higher = openings accelerating
    "biz_closings": "bizCloseTrend",       # higher = closings accelerating
    "evictions_filed": "evictionTrend",    # higher = evictions rising
}


def _rank_normalize(pairs: list[tuple[str, float]]) -> dict[str, float]:
    """area → rank position in 0..1 (robust to outliers, spans the full ramp)."""
    if not pairs:
        return {}
    ordered = sorted(pairs, key=lambda kv: kv[1])
    denom = max(1, len(ordered) - 1)
    return {area: i / denom for i, (area, _) in enumerate(ordered)}


def _neighborhood_trends() -> tuple[dict[str, dict[str, float]], str | None]:
    """{nhood: {crimeTrend: 0..1, …}}, plus the source as-of date."""
    from . import db  # local import: keep module importable without DuckDB

    try:
        rows = db.neighborhood_trends(list(TREND_METRICS))
    except Exception:  # noqa: BLE001 — DuckDB absent → no trends, never a 500
        return {}, None

    as_of = max((str(r["source_as_of"]) for r in rows if r.get("source_as_of")), default=None)
    out: dict[str, dict[str, float]] = {}
    for metric, prop in TREND_METRICS.items():
        pairs: list[tuple[str, float]] = []
        for r in rows:
            if r["metric"] != metric:
                continue
            last12, prior12 = r["last12"] or 0.0, r["prior12"] or 0.0
            if last12 == 0 and prior12 == 0:
                continue  # no signal for this area/metric
            pct = (last12 - prior12) / prior12 if prior12 > 0 else 1.0
            pairs.append((r["area_id"], pct))
        for area, score in _rank_normalize(pairs).items():
            out.setdefault(area, {})[prop] = round(score, 3)
    return out, as_of


async def get_neighborhoods() -> dict:
    """FeatureCollection with aggregate stats baked into each feature's
    properties, plus the trajectory list — everything the overlay needs."""
    permits = await get_permits()
    geo = await _cached("nbhd_geojson", NBHD_GEOJSON_URL)
    agg = _aggregate(permits)
    trends, trends_as_of = _neighborhood_trends()

    for f in geo.get("features", []):
        nb = (f.get("properties") or {}).get("nhood")
        t = agg.get(nb) if nb else None
        tr = trends.get(nb, {}) if nb else {}
        f["properties"] = {
            **(f.get("properties") or {}),
            "intensity": t["intensity"] if t else 0,
            "permits": t["permits"] if t else 0,
            "netUnits": t["netUnits"] if t else 0,
            "totalCost": t["totalCost"] if t else 0,
            "densify": t["densify"] if t else 0,
            "convert": t["convert"] if t else 0,
            "taller": t["taller"] if t else 0,
            "descriptor": t["descriptor"] if t else "No recent permit activity",
            # Real 12-vs-12-month trends from the pipeline (DuckDB), rank-normalized
            # 0..1. These replace the frontend's old placeholder hashes.
            "crimeTrend": tr.get("crimeTrend", 0.5),
            "bizOpenTrend": tr.get("bizOpenTrend", 0.5),
            "bizCloseTrend": tr.get("bizCloseTrend", 0.5),
            "evictionTrend": tr.get("evictionTrend", 0.5),
            "trendsAsOf": trends_as_of,
        }

    trajectory = sorted(agg.values(), key=lambda t: t["intensity"], reverse=True)
    return {"type": "FeatureCollection", "features": geo.get("features", []), "trajectory": trajectory}
