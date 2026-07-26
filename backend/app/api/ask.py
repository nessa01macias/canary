"""
Ask Canary v2 — the curated-generative-UI engine.

The model COMPOSES an interface from a blessed block registry; the server
HYDRATES every number from DuckDB. The model never emits a statistic that
reaches a chart — it only arranges components and writes prose (which must
quote the grounding). A hallucinated interface is impossible; a bespoke one is
automatic:

  intent ──► Claude (grounded, mission-aware) ──► block spec
                                                    │  {"blocks":[{type,...}]}
             frontend renders ◄── server hydration ─┘  (series from DuckDB,
             (sparklines, compare, map actions)         residents from k-anon views)

Block registry (all optional, model picks what the intent warrants):
  answer     {md}                                    the prose receipt
  rank_map   {chips}                                 applies the fit overlay
  flyto      {neighborhood}                          camera + glow
  compare    {areas[2..3], metrics[1..3]}            side-by-side w/ 12mo series
  residents  {area}                                  k-anon review averages

Personalization: `mission` (moving | buying | opening_business | exploring)
rides every call and frames both the prose and the component choice.
"""

from __future__ import annotations

import json
import os
import time

import httpx

from . import db, sf_live, store

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
ASK_MODEL = os.environ.get("CANARY_ASK_MODEL", "claude-haiku-4-5")
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

GROUNDED_CHIPS = [
    "Low crime", "Quiet", "Housing stability", "New construction",
    "Business openings", "Vacancy trend", "Good schools", "Transit access",
    "Tree canopy", "Groceries & retail", "Away from industry", "Flood risk",
    "Parking", "Road projects", "Liquor & cannabis", "Fast emergency response",
]

# Metrics the compare block may chart (all have full 41-hood monthly series).
COMPARE_METRICS = [
    "permits_issued", "units_approved_net", "biz_openings", "biz_closings",
    "crime_incidents", "crime_victim_reported", "threeoneone_noise",
    "evictions_filed", "threeoneone_cleaning",
]

MISSIONS = {"moving", "buying", "opening_business", "exploring"}

MISSION_FRAMING = {
    "moving": "The user is looking for a place to LIVE (renting). Lead with livability change: quiet, safety direction, eviction pressure, resident reviews.",
    "buying": "The user is buying a home — a 10-year commitment. Lead with the forward layer: approved construction, units pipeline, structural trajectory, schools, flood.",
    "opening_business": "The user wants to open a business. Lead with commercial vitality: business openings momentum, storefront vacancy, foot-traffic proxies (transit, grocery anchors), cannabis/liquor licensing as nightlife signal.",
    "exploring": "The user is exploring. Surprise them with the most striking real movements in the data.",
}

# ---------------------------------------------------------------------------
# Rate limit — in-process sliding window per client IP. Demo/free tier.
# ---------------------------------------------------------------------------
_RATE_WINDOW_S = 60
_RATE_MAX = 10
_hits: dict[str, list[float]] = {}


def check_rate(client_ip: str) -> bool:
    now = time.time()
    window = [t for t in _hits.get(client_ip, []) if now - t < _RATE_WINDOW_S]
    if len(window) >= _RATE_MAX:
        _hits[client_ip] = window
        return False
    window.append(now)
    _hits[client_ip] = window
    return True


# ---------------------------------------------------------------------------
# Grounding — compact per-neighborhood facts (same cached payload the map uses).
# ---------------------------------------------------------------------------
async def _grounding() -> tuple[str, set[str], dict]:
    nbhd = await sf_live.get_neighborhoods()
    areas: list[dict] = []
    names: set[str] = set()
    as_of = None
    for f in nbhd.get("features", []):
        p = f.get("properties") or {}
        name = p.get("nhood")
        if not name:
            continue
        names.add(name)
        as_of = p.get("trendsAsOf") or as_of
        areas.append({
            "name": name,
            "descriptor": p.get("descriptor"),
            "permits_24mo": p.get("permits"),
            "net_units_approved": p.get("netUnits"),
            "construction_$M": round((p.get("totalCost") or 0) / 1e6, 1),
            "trend_ranks": {
                "crime_rising": p.get("crimeTrend"),
                "noise_rising": p.get("noiseTrend"),
                "biz_openings_rising": p.get("bizOpenTrend"),
                "evictions_rising": p.get("evictionTrend"),
                "storefront_vacancy": p.get("vacancyRate"),
            },
            "attributes": {
                "school_scores": p.get("schoolScore"),
                "transit_access": p.get("transitAccess"),
                "tree_canopy": p.get("treeCanopy"),
                "grocery_access": p.get("groceryAccess"),
                "industry_presence": p.get("industryPresence"),
                "flood_share": p.get("floodShare"),
                "ems_speed_inverse": p.get("emsMinutes"),
                "cannabis_retail": p.get("cannabisRetail"),
            },
        })

    residents = []
    try:
        rows = await store.fetch_resident_layer("resident_layer_by_area")
        residents = [
            {"area": r["place_label"], "n_reviews": r["n_reviews"],
             "safety_of5": r.get("avg_safety"), "quiet_of5": r.get("avg_noise"),
             "getting_better_of5": r.get("avg_trajectory")}
            for r in rows
        ]
    except Exception:  # noqa: BLE001
        pass

    payload = {
        "geography": "San Francisco, 41 Analysis Neighborhoods",
        "as_of": as_of,
        "note": "trend_ranks and attributes are rank-normalized 0..1 across SF (1 = most/fastest-rising). permits/net_units/$ are raw 24-month values.",
        "areas": areas,
        "resident_reviews_k_anonymous": residents,
    }
    return json.dumps(payload, separators=(",", ":")), names, {"areas": len(areas), "as_of": as_of}


SYSTEM_RULES = """You are Canary, a neighborhood-change engine for San Francisco, grounded EXCLUSIVELY on the attached open-data payload. You do not chat — you COMPOSE AN INTERFACE from blocks, plus a short prose receipt.

HARD RULES:
1. Prose uses ONLY numbers present in the grounding. Never invent a statistic, price, or trend.
2. You have NO rent or home-price data. If asked about prices/rents, say so in one sentence, then answer the nearest computable question.
3. Facts with direction, never quality labels. NEVER reference race, ethnicity, income, or demographics.
4. answer.md ≤ 100 words, plain and concrete. Trend ranks are relative: phrase as "among SF's highest/lowest".
5. Choose blocks the INTENT warrants: comparative question → compare; place question → flyto; preference intent → rank_map; livability question where resident reviews exist → residents. Don't stack more than 4 blocks.
6. If a FOCUS block is present, the user is currently looking at that area: read "here"/"this area" as it and answer about it unless the question clearly asks otherwise. Don't emit a flyto for the area already in focus.

OUTPUT STRICT JSON, no fences:
{"blocks":[
  {"type":"answer","md":"..."},
  {"type":"rank_map","chips":["..."]},
  {"type":"flyto","neighborhood":"..."},
  {"type":"compare","areas":["A","B"],"metrics":["biz_openings"]},
  {"type":"residents","area":"..."}
],"followups":["...","..."]}

Allowed chips: """ + ", ".join(GROUNDED_CHIPS) + """
Allowed compare metrics: """ + ", ".join(COMPARE_METRICS)


# ---------------------------------------------------------------------------
# Focus — the PlaceCard scope the user asks FROM. A small, per-request system
# block appended AFTER the cached grounding block, so the big city payload's
# prompt cache stays intact while "here" gains 12 months of monthly detail.
# ---------------------------------------------------------------------------
FOCUS_METRICS = [
    "permits_issued", "units_approved_net", "biz_openings", "biz_closings",
    # Both crime series on purpose: incidents measure REPORTING; the honest
    # "getting safer or just more policed?" answer needs victim-reported too.
    "crime_incidents", "crime_victim_reported", "threeoneone_noise", "evictions_filed",
]


def _focus_block(context: dict | None, real_areas: set[str]) -> str | None:
    if not isinstance(context, dict):
        return None
    nhood = context.get("nhood")
    # Spot/record scopes may only carry coordinates — resolve through the spine.
    if not nhood and context.get("lat") is not None and context.get("lon") is not None:
        try:
            h3 = db.hex_for_point(float(context["lat"]), float(context["lon"]))
            rows = db.query("SELECT neighborhood FROM areas WHERE h3_9 = ?", [h3])
            nhood = rows[0]["neighborhood"] if rows else None
        except Exception:  # noqa: BLE001 — focus is best-effort, never fatal
            nhood = None
    if not nhood or nhood not in real_areas:
        return None
    series: dict[str, list] = {}
    for metric in FOCUS_METRICS:
        try:
            rows = db.metric_series([nhood], "neighborhood", metric, 12)
        except Exception:  # noqa: BLE001
            continue
        if rows:
            series[metric] = [
                {"period": str(r["period"]), "value": r["value"] or 0} for r in rows
            ]
    if not series:
        return None
    payload = {"focus_area": nhood, "scope": context.get("scope"), "monthly_series_12mo": series}
    return json.dumps(payload, separators=(",", ":"))


# ---------------------------------------------------------------------------
# Hydration — the server fills every number the components render.
# ---------------------------------------------------------------------------
def _hydrate_compare(block: dict, real_areas: set[str]) -> dict | None:
    areas = [a for a in block.get("areas", []) if a in real_areas][:3]
    metrics = [m for m in block.get("metrics", []) if m in COMPARE_METRICS][:3] or ["biz_openings"]
    if len(areas) < 2:
        return None
    series: dict[str, dict[str, list]] = {}
    for area in areas:
        series[area] = {}
        for metric in metrics:
            rows = db.metric_series([area], "neighborhood", metric, 12)
            series[area][metric] = [
                {"period": str(r["period"]), "value": r["value"] or 0} for r in rows
            ]
    return {"type": "compare", "areas": areas, "metrics": metrics, "series": series}


async def _hydrate_residents(block: dict, real_areas: set[str]) -> dict | None:
    area = block.get("area")
    if area not in real_areas:
        return None
    try:
        rows = await store.fetch_resident_layer("resident_layer_by_area")
    except Exception:  # noqa: BLE001
        return None
    match = next((r for r in rows if r["place_label"] == area), None)
    if not match:
        return None
    return {
        "type": "residents", "area": area, "n_reviews": match["n_reviews"],
        "safety": match.get("avg_safety"), "quiet": match.get("avg_noise"),
        "getting_better": match.get("avg_trajectory"),
    }


async def ask(
    question: str, history: list[dict], mission: str | None,
    context: dict | None = None,
) -> dict:
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not configured on the server.")

    grounding_json, real_areas, grounded_on = await _grounding()

    mission_line = MISSION_FRAMING.get(mission or "", MISSION_FRAMING["exploring"])
    messages = [
        *[{"role": m["role"], "content": m["content"][:1000]} for m in history[-6:]],
        {"role": "user", "content": question[:500]},
    ]

    system = [
        {"type": "text", "text": SYSTEM_RULES + "\n\nUSER MISSION: " + mission_line},
        {"type": "text", "text": "GROUNDING DATA:\n" + grounding_json,
         "cache_control": {"type": "ephemeral"}},
    ]
    focus_json = _focus_block(context, real_areas)
    if focus_json:
        # After the cache marker on purpose: varies per request, must not bust
        # the cached city-grounding prefix.
        system.append({"type": "text", "text": "FOCUS:\n" + focus_json})
        grounded_on = {**grounded_on, "focus": json.loads(focus_json)["focus_area"]}

    body = {
        "model": ASK_MODEL,
        "max_tokens": 1100,
        "system": system,
        "messages": messages,
    }
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(ANTHROPIC_URL, headers=headers, json=body)
    if resp.status_code >= 400:
        raise RuntimeError(f"LLM upstream {resp.status_code}: {resp.text[:200]}")
    text = "".join(b.get("text", "") for b in resp.json().get("content", []))

    try:
        parsed = json.loads(text[text.index("{"): text.rindex("}") + 1])
    except (ValueError, json.JSONDecodeError):
        parsed = {"blocks": [{"type": "answer", "md": text.strip()}]}

    # Clamp + hydrate: only known block types, real areas, real chips; every
    # chartable number filled server-side from DuckDB.
    blocks: list[dict] = []
    for b in parsed.get("blocks", [])[:5]:
        t = b.get("type")
        if t == "answer" and b.get("md"):
            blocks.append({"type": "answer", "md": str(b["md"])[:1200]})
        elif t == "rank_map":
            chips = [c for c in b.get("chips", []) if c in GROUNDED_CHIPS][:4]
            if chips:
                blocks.append({"type": "rank_map", "chips": chips})
        elif t == "flyto" and b.get("neighborhood") in real_areas:
            blocks.append({"type": "flyto", "neighborhood": b["neighborhood"]})
        elif t == "compare":
            hydrated = _hydrate_compare(b, real_areas)
            if hydrated:
                blocks.append(hydrated)
        elif t == "residents":
            hydrated = await _hydrate_residents(b, real_areas)
            if hydrated:
                blocks.append(hydrated)

    if not any(b["type"] == "answer" for b in blocks):
        blocks.insert(0, {"type": "answer", "md": "Here's what the record shows."})

    return {
        "blocks": blocks,
        "followups": [str(f)[:120] for f in parsed.get("followups", [])][:2],
        "grounded_on": grounded_on,
        "model": ASK_MODEL,
    }
