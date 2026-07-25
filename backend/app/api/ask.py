"""
Ask Canary — intent-language in, grounded facts + map actions out.

This endpoint is the consumer face of the B2B product: an LLM grounded on the
SAME per-neighborhood payload the map serves (the benchmark's 0-39% → 85-98%
mechanism, productized). Architecture decisions:

- CONTEXT-STUFFING, NOT TOOL-USE: the grounded corpus (~41 areas × signals,
  attributes, resident aggregates) is ~15KB — one round-trip, no agent loop.
  The grounding block is prompt-cached (cache_control) so repeat asks are cheap.
- THE MODEL DRIVES THE MAP: strict-JSON contract {answer_md, neighborhoods,
  chips, followups}; the frontend turns those into fly-to + fit-overlay actions.
  Outputs are CLAMPED server-side to the real area names / real grounded chips.
- HONESTY AS POLICY: no rent/price claims (we hold no price data — say so and
  answer the nearest computable), numbers only from the grounding, neutral
  directions, no demographic steering. Constraint #2/#3 enforced in the prompt.
- FREE-TIER SHAPED: per-IP rate limit; the same grounding as a licensed feed
  with SLAs is what "For AI apps" sells.

Keys live server-side only (ANTHROPIC_API_KEY). No SDK — plain httpx.
"""

from __future__ import annotations

import json
import os
import time

import httpx

from . import sf_live, store

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
ASK_MODEL = os.environ.get("CANARY_ASK_MODEL", "claude-haiku-4-5")
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

# The chips the frontend can actually apply (mirror of GROUNDED_TAGS keys).
GROUNDED_CHIPS = [
    "Low crime", "Quiet", "Housing stability", "New construction",
    "Business openings", "Vacancy trend", "Good schools", "Transit access",
    "Tree canopy", "Groceries & retail", "Away from industry", "Flood risk",
    "Parking", "Road projects", "Liquor & cannabis", "Fast emergency response",
]

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
# Grounding — compact per-neighborhood facts from the same cached payload the
# map serves, plus the k-anonymous resident aggregates when they exist.
# ---------------------------------------------------------------------------
async def _grounding() -> tuple[str, dict]:
    nbhd = await sf_live.get_neighborhoods()
    areas: list[dict] = []
    as_of = None
    for f in nbhd.get("features", []):
        p = f.get("properties") or {}
        name = p.get("nhood")
        if not name:
            continue
        as_of = p.get("trendsAsOf") or as_of
        areas.append({
            "name": name,
            "descriptor": p.get("descriptor"),
            "permits_24mo": p.get("permits"),
            "net_units_approved": p.get("netUnits"),
            "construction_$M": round((p.get("totalCost") or 0) / 1e6, 1),
            # rank-normalized 0..1 across SF (1 = highest / fastest-rising)
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
    except Exception:  # noqa: BLE001 — resident layer optional
        pass

    payload = {
        "geography": "San Francisco, 41 Analysis Neighborhoods",
        "as_of": as_of,
        "note": "trend_ranks and attributes are rank-normalized 0..1 across SF neighborhoods (1 = most / fastest-rising). permits/net_units/$ are raw 24-month values.",
        "areas": areas,
        "resident_reviews_k_anonymous": residents,
    }
    return json.dumps(payload, separators=(",", ":")), {"areas": len(areas), "as_of": as_of}


SYSTEM_RULES = """You are Canary, a neighborhood-change assistant for San Francisco, grounded EXCLUSIVELY on the attached open-data payload (permits, business churn, crime, 311, evictions, schools, transit, flood, etc. — with as-of dates).

HARD RULES:
1. Use ONLY numbers present in the grounding. Never invent a statistic, price, or trend.
2. You have NO rent or home-price data. If asked about prices/rents, say so plainly in one sentence, then answer the nearest computable question (e.g. displacement pressure via evictions, vacancy, construction supply).
3. Facts with direction, never quality labels: say "crime reports rising fastest in SF" not "bad neighborhood". NEVER reference race, ethnicity, income, or demographics — not even indirectly.
4. Be concise: ≤120 words of prose, bullets welcome. Mention 2-4 specific neighborhoods with one cited number each.
5. Trend ranks are relative (0..1 across SF): phrase as "among SF's highest/lowest", not as percentages.
6. If resident reviews exist for a relevant area, you may quote the averages as "residents say".

OUTPUT: respond with STRICT JSON only, no markdown fence:
{"answer_md": "...", "neighborhoods": ["exact area names from the grounding you recommend looking at"], "chips": ["preference chips from the allowed list that encode the user's intent"], "followups": ["2 short natural next questions"]}
Allowed chips: """ + ", ".join(GROUNDED_CHIPS)


async def ask(question: str, history: list[dict]) -> dict:
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not configured on the server.")

    grounding_json, grounded_on = await _grounding()

    messages = [
        *[{"role": m["role"], "content": m["content"][:1000]} for m in history[-6:]],
        {"role": "user", "content": question[:500]},
    ]

    body = {
        "model": ASK_MODEL,
        "max_tokens": 900,
        "system": [
            {"type": "text", "text": SYSTEM_RULES},
            # The big grounding block is cache-marked: repeat questions reuse it.
            {"type": "text", "text": "GROUNDING DATA:\n" + grounding_json,
             "cache_control": {"type": "ephemeral"}},
        ],
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

    # Parse the strict-JSON contract; degrade to plain prose if the model slips.
    parsed: dict = {}
    try:
        start = text.index("{")
        end = text.rindex("}") + 1
        parsed = json.loads(text[start:end])
    except (ValueError, json.JSONDecodeError):
        parsed = {"answer_md": text.strip()}

    # Clamp actions to reality: only real area names, only real chips.
    real_areas = {a["name"] for a in json.loads(grounding_json)["areas"]}
    neighborhoods = [n for n in parsed.get("neighborhoods", []) if n in real_areas][:4]
    chips = [c for c in parsed.get("chips", []) if c in GROUNDED_CHIPS][:4]

    return {
        "answer_md": parsed.get("answer_md", "").strip() or "I couldn't form an answer — try rephrasing?",
        "neighborhoods": neighborhoods,
        "chips": chips,
        "followups": [str(f)[:120] for f in parsed.get("followups", [])][:2],
        "grounded_on": grounded_on,
        "model": ASK_MODEL,
    }
