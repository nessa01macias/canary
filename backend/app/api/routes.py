"""
Canary L4 serving routes.

Endpoints (all geography-agnostic — bbox or H3, works for any metro):
  GET /api/changes    map markers in a bounding box
  GET /api/report     the single-address "before you sign" object
  GET /api/trajectory one metric's movement for an area
  GET /api/catalog    machine-readable capability list (agent-legible discovery)

This module only reads L3. It never writes — that boundary is app/pipeline's.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from . import db, sf_live, store
from .schemas import (
    AddressReport,
    AreaRef,
    Catalog,
    Category,
    ChangePoint,
    Citation,
    ContributionIn,
    MetricInfo,
    Trajectory,
)
from .trajectory import build_trajectory

router = APIRouter(prefix="/api", tags=["canary"])

# Metrics surfaced in a report, in priority order (construction first — the #1
# computable regret from forum validation). Data-driven: anything missing for an
# area is simply skipped, so this list never needs to change per metro.
REPORT_METRICS = [
    "units_approved_net",
    "permits_issued",
    "biz_openings",
    "biz_closings",
    "crime_incidents",
    "threeoneone_noise",   # forum-validated fear #3, staged 2026-07-25
    "evictions_filed",
]


def _to_change_point(r: dict) -> ChangePoint:
    event_type = r["event_type"]
    detail = r.get("detail")
    headline = detail or event_type.replace("_", " ").title()
    return ChangePoint(
        id=f"{r['source']}:{r.get('record_key') or ''}:{event_type}",
        lat=r["lat"],
        lon=r["lon"],
        h3_9=r["h3_9"],
        category=Category(db.category_for_event(event_type)),
        event_type=event_type,
        event_time=r.get("event_time"),
        headline=headline[:140],
        detail=detail,
        value=r.get("value"),
        units_delta=r.get("units_delta"),
        citation=Citation(
            source=r["source"],
            source_as_of=r.get("source_as_of"),
            record_key=r.get("record_key"),
        ),
    )


@router.get("/changes", response_model=list[ChangePoint])
def get_changes(
    bbox: str = Query(..., description="minLng,minLat,maxLng,maxLat"),
    since: date | None = Query(None, description="Only events on/after this date."),
    category: Category | None = Query(None, description="Filter to one coarse category."),
    limit: int = Query(500, ge=1, le=5000),
) -> list[ChangePoint]:
    try:
        min_lng, min_lat, max_lng, max_lat = (float(x) for x in bbox.split(","))
    except ValueError:
        raise HTTPException(400, "bbox must be 'minLng,minLat,maxLng,maxLat'")
    event_types = db.event_types_for_category(category.value) if category else None
    try:
        rows = db.changes_in_bbox(
            min_lng, min_lat, max_lng, max_lat, since, limit, event_types
        )
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))
    return [_to_change_point(r) for r in rows]


@router.get("/report", response_model=AddressReport)
def get_report(
    lat: float = Query(..., description="Latitude of the address/point."),
    lon: float = Query(..., description="Longitude of the address/point."),
    ring_k: int = Query(2, ge=0, le=6, description="k-ring of hexes to cover (~350m each)."),
    since: date | None = Query(None, description="Recent-changes cutoff."),
    window_months: int = Query(24, ge=3, le=120),
) -> AddressReport:
    try:
        h3_9 = db.hex_for_point(lat, lon)
        hexes = db.ring_hexes(h3_9, ring_k)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))
    except Exception as e:  # noqa: BLE001 — h3 extension missing etc.
        raise HTTPException(500, f"H3 resolution failed: {e}")

    change_rows = db.changes_in_hexes(hexes, since, limit=300)
    changes = [_to_change_point(r) for r in change_rows]

    display_name = next((r["neighborhood"] for r in change_rows if r.get("neighborhood")), None)

    trajectories: list[Trajectory] = []
    for metric in REPORT_METRICS:
        rows = db.metric_series(hexes, "h3_9", metric, window_months)
        if not rows:
            continue
        cite = Citation(
            source=rows[-1].get("source") or metric,
            source_as_of=rows[-1].get("source_as_of"),
        )
        trajectories.append(build_trajectory(metric, h3_9, "h3_9", rows, cite))

    pipeline_version = next(
        (r.get("pipeline_version") for r in (db.metric_series(hexes, "h3_9", "permits_issued", 1) or []) if r.get("pipeline_version")),
        None,
    )

    distinct_sources = {c.citation.source for c in changes} | {
        t.citation.source for t in trajectories
    }
    sources = [Citation(source=s) for s in sorted(distinct_sources)]

    return AddressReport(
        query=AreaRef(
            lat=lat, lon=lon, h3_9=h3_9, ring_k=ring_k, hex_ids=hexes,
            display_name=display_name,
        ),
        generated_at=datetime.now(timezone.utc),
        pipeline_version=pipeline_version,
        changes=changes,
        trajectories=trajectories,
        attributes=db.area_attributes(h3_9),
        sources=sources,
    )


@router.get("/trajectory", response_model=Trajectory)
def get_trajectory(
    area_id: str = Query(..., description="H3 cell (or area id) to compute over."),
    metric: str = Query(...),
    area_level: str = Query("h3_9"),
    window_months: int = Query(24, ge=3, le=120),
) -> Trajectory:
    try:
        rows = db.metric_series([area_id], area_level, metric, window_months)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))
    if not rows:
        raise HTTPException(404, f"No series for metric={metric} area={area_id}")
    cite = Citation(source=rows[-1].get("source") or metric, source_as_of=rows[-1].get("source_as_of"))
    return build_trajectory(metric, area_id, area_level, rows, cite)


@router.get("/sf/permits")
async def get_sf_permits() -> list[dict]:
    """SF permits, enriched server-side (change-story, stage, units, cost).
    The frontend renders this directly — no DataSF access from the browser."""
    try:
        return await sf_live.get_permits()
    except Exception as e:  # noqa: BLE001 - upstream DataSF hiccup → 502
        raise HTTPException(502, f"DataSF permits fetch failed: {e}")


@router.get("/sf/neighborhoods")
async def get_sf_neighborhoods() -> dict:
    """SF neighborhood polygons with trajectory aggregates baked into each
    feature's properties, plus the ranked trajectory list."""
    try:
        return await sf_live.get_neighborhoods()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"DataSF neighborhoods fetch failed: {e}")


@router.post("/contributions", status_code=201)
async def post_contribution(body: ContributionIn) -> dict:
    """
    Persist a user contribution (the give-to-get moat). The frontend POSTs here;
    the backend is the only thing that touches Supabase. No DB creds client-side.
    """
    if not store.supabase_configured():
        raise HTTPException(503, "Contributions store not configured on the server.")
    row = body.model_dump(exclude_none=True)
    row.setdefault("ratings", {})
    try:
        await store.insert_contribution(row)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    return {"ok": True}


@router.get("/catalog", response_model=Catalog)
def get_catalog() -> Catalog:
    try:
        rows = db.available_metrics()
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))
    metrics = [
        MetricInfo(
            metric=r["metric"],
            category=Category(db.category_for_metric(r["metric"])),
            area_levels=list(r["area_levels"]),
            period_min=r.get("period_min"),
            period_max=r.get("period_max"),
        )
        for r in rows
    ]
    levels = sorted({lvl for m in metrics for lvl in m.area_levels})
    return Catalog(
        metrics=metrics,
        area_levels=levels,
        coverage_note="H3-native; coverage expands per metro as source data lands.",
    )
