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

Provider ladder (see `_provider` / post_commute) — the seam that lets a real API
drop in later without touching the endpoint or the frontend:
  1. STADIA_API_KEY set                → Stadia (Valhalla), all modes. Production.
  2. CANARY_ROUTING=osrm (no key)      → keyless public OSRM demo, DRIVE only.
  3. otherwise (default, zero config)  → local MOCK: a synthetic staircase path
                                          with a mode-based ETA. No network, no key
                                          — the map draws routes out of the box.
Only the selection changes; each provider returns the same Leg shape. To go from
the local mock to a real API, set STADIA_API_KEY (or CANARY_ROUTING=osrm).

Env:  STADIA_API_KEY   — https://stadiamaps.com free dev tier (all modes).
      CANARY_ROUTING   — "osrm" to use the keyless demo router; unset → mock.
"""

from __future__ import annotations

import math
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
# Keyless fallback when no STADIA_API_KEY is set. The public demo server hosts the
# car profile only (its cycling/walking profiles are the same car graph), so we use
# it for drive routes exclusively — see _osrm_leg / the mode guard in post_commute.
_OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving"

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


# --------------------------------------------------------------------------- #
#  OSRM demo (keyless) — one origin→destination DRIVE leg, GeoJSON geometry
# --------------------------------------------------------------------------- #
async def _osrm_leg(dest: DestIn, origin: LngLat) -> Leg:
    """Keyless drive route via the public OSRM demo server. Returns GeoJSON
    geometry directly (no polyline decode). No key and no SLA — it's the graceful
    fallback so a dev box draws drive lines without a Stadia account."""
    path = f"{origin.lon},{origin.lat};{dest.lon},{dest.lat}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{_OSRM_ROUTE_URL}/{path}",
                params={"overview": "full", "geometries": "geojson"},
            )
        if resp.status_code != 200:
            return Leg(id=dest.id, ok=False, error=f"provider_{resp.status_code}")
        data = resp.json()
        routes = data.get("routes") or []
        if data.get("code") != "Ok" or not routes:
            return Leg(id=dest.id, ok=False, error="no_route")
        route = routes[0]
        coords = route.get("geometry", {}).get("coordinates") or []
        if not coords:
            return Leg(id=dest.id, ok=False, error="no_route")
        return Leg(
            id=dest.id,
            ok=True,
            duration_s=float(route.get("duration", 0.0)),  # seconds
            distance_m=float(route.get("distance", 0.0)),   # meters
            geometry=LineString(coordinates=coords),
        )
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        return Leg(id=dest.id, ok=False, error=f"fetch_failed:{type(exc).__name__}")


# --------------------------------------------------------------------------- #
#  Local mock (no network, no key) — the zero-config default provider
# --------------------------------------------------------------------------- #
# Nominal travel speeds (m/s) for the mock ETA: ~32 km/h city drive, ~15 km/h
# bike, ~4.7 km/h walk. Only used by the mock — real providers report real times.
_MOCK_SPEED_MS: dict[str, float] = {"drive": 8.9, "bike": 4.2, "walk": 1.3}


def _haversine_m(a: LngLat, b_lat: float, b_lon: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(a.lat), math.radians(b_lat)
    dp, dl = math.radians(b_lat - a.lat), math.radians(b_lon - a.lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _mock_leg(dest: DestIn, origin: LngLat, mode: str) -> Leg:
    """Zero-dependency route for local dev: a staircase polyline (H→V→H) between
    the two points, with a mode-based ETA off the crow-flies distance. No network,
    no key — this is what makes the map draw routes with nothing configured. It's a
    placeholder, not a real route; swap in a real provider via STADIA_API_KEY or
    CANARY_ROUTING=osrm (selection lives in post_commute)."""
    mid_lon = origin.lon + (dest.lon - origin.lon) * 0.5
    coords = [
        [origin.lon, origin.lat],
        [mid_lon, origin.lat],
        [mid_lon, dest.lat],
        [dest.lon, dest.lat],
    ]
    # Staircase is longer than the straight line — bump the distance so it reads
    # like a street route rather than a ruler measurement.
    distance_m = _haversine_m(origin, dest.lat, dest.lon) * 1.3
    speed = _MOCK_SPEED_MS.get(mode, 8.9)
    return Leg(
        id=dest.id,
        ok=True,
        duration_s=distance_m / speed,
        distance_m=distance_m,
        geometry=LineString(coordinates=coords),
    )


# --------------------------------------------------------------------------- #
#  Provider selection — the one seam a real API plugs into
# --------------------------------------------------------------------------- #
def _provider() -> str:
    """Which routing backend to use, cheapest-real-first. See the module docstring."""
    if os.environ.get("STADIA_API_KEY", "").strip():
        return "stadia"
    return os.environ.get("CANARY_ROUTING", "mock").strip().lower() or "mock"


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

    provider = _provider()
    key = os.environ.get("STADIA_API_KEY", "").strip()

    # OSRM's demo server is car-only, so under it bike/walk have no real router —
    # answer them as unconfigured rather than pass car times off under those icons.
    # Stadia and the local mock both cover all three modes.
    if provider == "osrm" and mode != "drive":
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
        if provider == "stadia":
            leg = await _stadia_leg(dest, body.origin, costing, key)
        elif provider == "osrm":
            leg = await _osrm_leg(dest, body.origin)
        else:  # "mock" — zero-config local default
            leg = _mock_leg(dest, body.origin, mode)
        if leg.ok:
            _cache[ck] = (time.time(), leg)
        legs.append(leg)

    return CommuteOut(mode=mode, legs=legs)
