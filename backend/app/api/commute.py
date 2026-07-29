"""
Commute preview — routing proxy for the "if I lived here…" feature.

The frontend never calls a routing vendor directly: it POSTs an origin (the spot
being evaluated) + up to 3 saved destinations (work / school / grocery) here, and
this module fetches real routes server-side. Keeping it server-side means the
routing key never ships to the browser, and identical spot→destination requests
are cached in-process (people re-scope the same corner constantly).

Providers, by mode:
  drive / bike / walk  → Stadia Maps (Valhalla). Returns encoded polyline6 we
                         decode to GeoJSON — legal to draw on our MapLibre map.
  transit              → NOT wired. Stadia's hosted API has no schedule-based
                         transit, and 511 SF Bay publishes GTFS *data*, not a
                         trip planner. Real transit needs an engine (OpenTripPlanner
                         over the 511 GTFS we already ingest). Until that stands up
                         we answer transit legs with ok=false / "transit_unavailable"
                         so the UI can show it as coming-soon rather than break.

Env:  STADIA_API_KEY — https://stadiamaps.com free dev tier. Absent → legs come
      back ok=false with "routing_unconfigured" (feature degrades, never 500s).
"""

from __future__ import annotations

import os
import time
from typing import Literal

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api", tags=["commute"])

# drive/bike/walk → Valhalla costing model. transit is intentionally absent here.
_COSTING: dict[str, str] = {
    "drive": "auto",
    "bike": "bicycle",
    "walk": "pedestrian",
}
_STADIA_ROUTE_URL = "https://api.stadiamaps.com/route/v1"

_CACHE_TTL = 60 * 60 * 12  # 12h — routes between fixed points barely move
_cache: dict[str, tuple[float, "Leg"]] = {}


# --------------------------------------------------------------------------- #
#  Request / response shapes
# --------------------------------------------------------------------------- #
class LngLat(BaseModel):
    lat: float
    lon: float


class DestIn(LngLat):
    id: str


class CommuteIn(BaseModel):
    origin: LngLat
    destinations: list[DestIn] = Field(default_factory=list, max_length=3)
    mode: Literal["drive", "bike", "walk", "transit"] = "drive"


class LineString(BaseModel):
    type: Literal["LineString"] = "LineString"
    coordinates: list[list[float]]  # [ [lon, lat], … ]


class Leg(BaseModel):
    id: str
    ok: bool
    duration_s: float | None = None
    distance_m: float | None = None
    geometry: LineString | None = None
    error: str | None = None


class CommuteOut(BaseModel):
    mode: str
    legs: list[Leg]


# --------------------------------------------------------------------------- #
#  Valhalla polyline6 decode (Google algorithm, precision 1e6)
# --------------------------------------------------------------------------- #
def _decode_polyline6(encoded: str) -> list[list[float]]:
    coords: list[list[float]] = []
    index = lat = lon = 0
    length = len(encoded)
    while index < length:
        for _is_lon in (False, True):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if (result & 1) else (result >> 1)
            if _is_lon:
                lon += delta
            else:
                lat += delta
        # GeoJSON order is [lon, lat]
        coords.append([lon / 1e6, lat / 1e6])
    return coords


# --------------------------------------------------------------------------- #
#  Stadia (Valhalla) — one origin→destination leg
# --------------------------------------------------------------------------- #
async def _stadia_leg(dest: DestIn, origin: LngLat, costing: str, key: str) -> Leg:
    body = {
        "locations": [
            {"lat": origin.lat, "lon": origin.lon},
            {"lat": dest.lat, "lon": dest.lon},
        ],
        "costing": costing,
        "units": "kilometers",
        "directions_options": {"units": "kilometers"},
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                _STADIA_ROUTE_URL, params={"api_key": key}, json=body
            )
        if resp.status_code != 200:
            return Leg(id=dest.id, ok=False, error=f"provider_{resp.status_code}")
        trip = resp.json().get("trip", {})
        summary = trip.get("summary", {})
        coords: list[list[float]] = []
        for seg in trip.get("legs", []):
            shape = seg.get("shape")
            if shape:
                coords.extend(_decode_polyline6(shape))
        if not coords:
            return Leg(id=dest.id, ok=False, error="no_route")
        return Leg(
            id=dest.id,
            ok=True,
            duration_s=float(summary.get("time", 0.0)),
            distance_m=float(summary.get("length", 0.0)) * 1000.0,  # km → m
            geometry=LineString(coordinates=coords),
        )
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        return Leg(id=dest.id, ok=False, error=f"fetch_failed:{type(exc).__name__}")


def _cache_key(mode: str, origin: LngLat, dest: DestIn) -> str:
    # round to ~11 m so tiny scope jitter reuses the same route
    return (
        f"{mode}|{origin.lat:.4f},{origin.lon:.4f}"
        f"|{dest.lat:.4f},{dest.lon:.4f}"
    )


# --------------------------------------------------------------------------- #
#  Endpoint
# --------------------------------------------------------------------------- #
@router.post("/commute", response_model=CommuteOut)
async def post_commute(body: CommuteIn) -> CommuteOut:
    mode = body.mode

    # Transit isn't wired yet (see module docstring) — answer honestly so the UI
    # can render "coming soon" instead of a broken line.
    if mode == "transit":
        return CommuteOut(
            mode=mode,
            legs=[Leg(id=d.id, ok=False, error="transit_unavailable") for d in body.destinations],
        )

    key = os.environ.get("STADIA_API_KEY", "").strip()
    if not key:
        return CommuteOut(
            mode=mode,
            legs=[Leg(id=d.id, ok=False, error="routing_unconfigured") for d in body.destinations],
        )

    costing = _COSTING[mode]
    legs: list[Leg] = []
    for dest in body.destinations:
        ck = _cache_key(mode, body.origin, dest)
        hit = _cache.get(ck)
        if hit and (time.time() - hit[0]) < _CACHE_TTL:
            # cached leg was computed for a different dest.id → clone with this id
            cached = hit[1]
            legs.append(cached.model_copy(update={"id": dest.id}))
            continue
        leg = await _stadia_leg(dest, body.origin, costing, key)
        if leg.ok:
            _cache[ck] = (time.time(), leg)
        legs.append(leg)

    return CommuteOut(mode=mode, legs=legs)
