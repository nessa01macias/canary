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

from fastapi import Request

from . import ask as ask_mod
from . import db, nbhd_attributes, sf_live, store
from .schemas import (
    AddressReport,
    AreaRef,
    AskIn,
    AskOut,
    Catalog,
    Category,
    ChangePoint,
    Citation,
    ContributionIn,
    MetricInfo,
    ResidentAreaAgg,
    ResidentHexAgg,
    ResidentLayer,
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
        if category == Category.business:
            # Dedicated path: joins the registered business NAME (events only
            # carry NAICS) and clamps out the registry's future-dated dirt.
            rows = db.business_changes_in_bbox(
                min_lng, min_lat, max_lng, max_lat, since, limit
            )
        else:
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
    # Recency-ordered rows drown big permits in 311/crime noise — merge in the
    # most consequential construction (by units, then $) so the hero survives.
    hero_rows = db.biggest_construction_in_hexes(hexes, since)
    seen = {(r["source"], r.get("record_key"), r["event_type"]) for r in change_rows}
    change_rows += [
        r for r in hero_rows if (r["source"], r.get("record_key"), r["event_type"]) not in seen
    ]
    changes = [_to_change_point(r) for r in change_rows]

    # Containing neighborhood from the H3 spine — names the report and keys the
    # neighborhood-level reference attributes below.
    spine_nbhd = None
    try:
        spine_rows = db.query("SELECT neighborhood FROM areas WHERE h3_9 = ?", [h3_9])
        spine_nbhd = spine_rows[0]["neighborhood"] if spine_rows else None
    except Exception:  # noqa: BLE001 — spine miss → report still serves
        pass

    display_name = next(
        (r["neighborhood"] for r in change_rows if r.get("neighborhood")), None
    ) or spine_nbhd

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

    # Reference attributes: neighborhood-level facts (L0 precompute, cited),
    # overridden by any finer hex-level columns the pipeline stages into `areas`.
    attr_display, attr_cites = nbhd_attributes.report_attributes(spine_nbhd)
    attributes = {**attr_display, **db.area_attributes(h3_9)}

    distinct_sources = {c.citation.source for c in changes} | {
        t.citation.source for t in trajectories
    }
    sources = [Citation(source=s) for s in sorted(distinct_sources)] + [
        Citation(**c) for c in attr_cites if c["source"] not in distinct_sources
    ]

    return AddressReport(
        query=AreaRef(
            lat=lat, lon=lon, h3_9=h3_9, ring_k=ring_k, hex_ids=hexes,
            display_name=display_name,
        ),
        generated_at=datetime.now(timezone.utc),
        pipeline_version=pipeline_version,
        changes=changes,
        trajectories=trajectories,
        attributes=attributes,
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


@router.get("/freshness")
def get_freshness() -> dict:
    """Exactly how current every source and served attribute is — source_as_of,
    fetched_at, age vs cadence/pull-tier, per-attribute as-of dates. The checkable
    version of "as updated as possible"; regenerated by every refresh run."""
    import json as _json
    from pathlib import Path as _Path

    path = _Path(__file__).resolve().parents[2] / "data" / "processed" / "freshness.json"
    try:
        return _json.loads(path.read_text())
    except (OSError, ValueError):
        raise HTTPException(503, "freshness manifest not built yet — run: python -m app.ingestion.freshness")


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

    # Un-orphan the review: attach h3_9 so it can join the k-anonymous aggregate.
    # Geocoded lat/lon (the gate modal's verified address pick) wins; otherwise
    # resolve the picked area name to its centroid. Best-effort — a failed
    # resolution never blocks the save.
    if not row.get("h3_9"):
        if not (row.get("lat") and row.get("lon")) and row.get("place_label"):
            centroid = await sf_live.neighborhood_centroid(row["place_label"])
            if centroid:
                row["lat"], row["lon"] = centroid
        if row.get("lat") and row.get("lon"):
            try:
                row["h3_9"] = db.hex_for_point(row["lat"], row["lon"])
            except Exception:  # noqa: BLE001 — DuckDB/h3 unavailable → save without hex
                pass

    try:
        await store.insert_contribution(row)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    return {"ok": True}


@router.get("/resident-layer", response_model=ResidentLayer)
async def get_resident_layer() -> ResidentLayer:
    """
    The give-to-get resident layer — k-anonymised (n ≥ 3) review aggregates per
    area and per hex. Raw reviews are structurally unreadable (RLS); this is the
    only shape they ever leave Supabase in. Empty lists = not enough reviews yet.
    """
    area_rows = await store.fetch_resident_layer("resident_layer_by_area")
    hex_rows = await store.fetch_resident_layer("resident_layer_agg")

    # Attach display names to hexes from the spine (best-effort).
    hexes: list[ResidentHexAgg] = []
    for r in hex_rows:
        neighborhood = None
        try:
            match = db.query("SELECT neighborhood FROM areas WHERE h3_9 = ?", [r["h3_9"]])
            neighborhood = match[0]["neighborhood"] if match else None
        except Exception:  # noqa: BLE001 — DuckDB absent → names omitted, data still served
            pass
        hexes.append(ResidentHexAgg(**r, neighborhood=neighborhood))

    return ResidentLayer(
        areas=[ResidentAreaAgg(**r) for r in area_rows],
        hexes=hexes,
    )


@router.post("/ask", response_model=AskOut)
async def post_ask(body: AskIn, request: Request) -> AskOut:
    """
    Ask Canary: intent-language in, grounded facts + map actions out. The live
    demo of the B2B grounding feed (rate-limited free tier; keys server-side).
    """
    client_ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
    if not ask_mod.check_rate(client_ip):
        raise HTTPException(429, "Free-tier limit reached — try again in a minute. (For volume access, see the For AI apps page.)")
    try:
        result = await ask_mod.ask(body.question, body.history)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return AskOut(**result)


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
