"""Area news — tier ZERO of the forward chain (announcement → permit → license →
opening). Implements the claims tier of backend/DATA_CONTRACT.md: announced_*
vocabulary, location_precision (rule #13: never manufactured), lifecycle
claimed → corroborated → materialized | expired (rule #14: same-event links),
verbatim quote + URL on every claim. Claims NEVER enter metrics (rule #10).

Flow (daily, via app/ingestion/refresh.py):
  fetch_daily()   Firecrawl search (10 outlets, pilot areas) → cross-run URL dedupe
                  → scrape NEW articles into a dated L0 snapshot → one Haiku
                  extraction per article → claims_<ts>.json (immutable)
  claims_build()  derived, rebuildable state: merge ALL raw claims → expiry pass →
                  corroborate open point/block claims against the pipeline's fresh
                  events (permits, place open/close) → data/processed/claims.json

Fan-out beyond the 3 pilot areas stays GATED on the human precision review
(data/processed/news_pilot_review.csv, ~85%). News is NOT ratchet data (archives
exist) — never borrow the moat argument for it.

    python -m app.ingestion.news --pilot     # collect now (same path as the daily job)
    python -m app.ingestion.news --build     # rebuild claims state only
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from datetime import date, timedelta

from dotenv import load_dotenv

from app.ingestion import base
from app.ingestion.base import SourceSpec

load_dotenv(base.BACKEND_DIR / ".env")

EXTRACT_MODEL = "claude-haiku-4-5-20251001"  # cheap; the model we run at scale
CLAIMS_STATE_PATH = base.PROCESSED_DIR / "claims.json"
REVIEW_PATH = base.PROCESSED_DIR / "news_pilot_review.csv"

# General local press + the RE TRADE press (the latter publishes development
# announcements earlier and with addresses — tier zero of the forward chain).
OUTLETS = [
    # general
    "sfchronicle.com", "sfgate.com", "sfstandard.com",
    "missionlocal.org", "hoodline.com", "sfist.com",
    # real-estate trade
    "socketsite.com", "sfyimby.com", "therealdeal.com", "bizjournals.com",
]

# Pilot areas: one loud, one industrial, one quiet/low-press (benchmark showed
# low-press areas are where grounded context is scarcest).
PILOT_AREAS: dict[str, list[str]] = {
    "Mission": ['"Mission District"', '"the Mission"'],
    "Bayview Hunters Point": ['"Bayview"', '"Hunters Point"', '"Candlestick"'],
    "Japantown": ['"Japantown"'],
}
TOPIC = "(development OR construction OR housing OR closure OR opening OR crime OR transit OR eviction)"
MAX_ARTICLES_PER_AREA = 10

# Lifecycle expiry defaults per event_type (days). Contract: announcements EXPIRE —
# a stale "coming soon" never haunts the map years later.
EXPIRY_DAYS: dict[str, int] = {
    "announced_opening": 548,       # 18 months
    "announced_closure": 365,
    "announced_development": 1095,  # 36 months
    "announced_transit": 1460,      # 48 months
    "announced_policy": 730,
}
DEFAULT_EXPIRY_DAYS = 365  # observational claims

# Which RECORD event_types can corroborate which announcement types (rule #14).
CORROBORATING_TYPES: dict[str, list[str]] = {
    "announced_opening": ["place_opened", "permit_filed", "permit_issued"],
    "announced_closure": ["place_closed"],
    "announced_development": ["permit_filed", "permit_issued"],
    # announced_transit / announced_policy: no record match in v1
}
# Matching against these means the thing actually happened, not just progressed.
MATERIALIZING_TYPES = {"place_opened", "place_closed"}

# Tokens too generic to identify an entity ("The Mission Cafe" must not match on
# "mission" or "cafe" alone).
_STOP_TOKENS = {
    "the", "a", "an", "of", "and", "at", "on", "in", "new", "san", "francisco",
    "sf", "cafe", "café", "restaurant", "bar", "shop", "store", "market", "center",
    "co", "inc", "llc", "street", "st", "ave", "avenue", "blvd",
}

SPEC = SourceSpec(
    key="news_sf",
    name="SF local news — area claims (pilot areas)",
    geography="san_francisco",
    temporal_shape="event_stream",
    cadence="daily",
    fmt="md+json",
    license="fair-use excerpts w/ citation; never republished in full",
    homepage="(multiple local outlets)",
    canonical_source="news",
    tier="T6.0-claims",
    requires_auth=True,
    notes="CLAIMS tier (DATA_CONTRACT §4b): announced_* + lifecycle + precision. Never metrics. NOT ratchet data.",
)

# Read-first, attribute-after: ONE extraction per article; area AND precision come
# from the claim's own textual evidence, never from the search query.
EXTRACT_PROMPT = """From this local news article, extract every FACTUAL claim about physical or civic change in any of these San Francisco neighborhoods:

- "Mission" (aliases: Mission District, the Mission)
- "Bayview Hunters Point" (aliases: Bayview, Hunters Point, Candlestick Point)
- "Japantown"

These are neighborhoods of the CITY OF SAN FRANCISCO only. Other Bay Area cities
have districts with the same names (San Jose has a Japantown; Oakland has its own
Chinatown) — if the fact is located outside San Francisco proper, use "area": "other".

Two kinds of claims, distinguished by TENSE:
- OBSERVATIONAL (it happened): construction | business_open | business_close | housing | crime | transit | eviction | policy | other
- ANNOUNCED (it is planned/approved/expected — "will open", "plans to build", "approved to convert"): announced_opening | announced_closure | announced_development | announced_transit | announced_policy

Rules:
- "area": the neighborhood the claim's OWN evidence places it in (a street, venue, or
  neighborhood named near the fact). NEVER infer area from the outlet name or general
  SF framing. Not tied to one of the three → "area": "other".
- Streets named after neighborhoods run FAR beyond them (the 700 block of Mission
  Street is downtown, not the Mission District) — a street name alone is NOT evidence
  the claim is in that neighborhood.
- "location_precision": how precisely the TEXT locates the fact —
  "point" (an exact street address or a named single venue), "block" (an intersection
  or block), "neighborhood", or "city". Never claim more precision than the text gives.
- "address": the street address or intersection VERBATIM from the text, only when
  precision is point/block; else null.
- "entity_name": the named business/project/organization the claim is about
  (e.g. "Starbucks", "Alice Griffith Apartments"), or null.
- "expected_date": for announced_* claims, the stated opening/completion date
  (YYYY-MM-DD, or YYYY-MM, or null).
- Each claim MUST include a short VERBATIM "quote" from the article that supports it.
- FACTS only — skip opinions, pundit predictions, and vibes.
- Nothing relevant → empty list.

Return JSON only, no prose:
{{"claims": [{{"area": "Mission|Bayview Hunters Point|Japantown|other",
   "event_type": "<one of the types above>",
   "location_precision": "point|block|neighborhood|city",
   "address": "<verbatim or null>",
   "entity_name": "<name or null>",
   "event_time": "YYYY-MM-DD or null",
   "expected_date": "YYYY-MM-DD or YYYY-MM or null",
   "claim": "<one factual sentence>",
   "quote": "<verbatim supporting quote>"}}]}}

ARTICLE (markdown):
{article}"""


# --------------------------------------------------------------------------- #
#  Collection (E: search → dedupe → scrape → extract → L0)
# --------------------------------------------------------------------------- #

def _search_all(client) -> list[dict]:
    """Firecrawl search per area×alias, GLOBALLY deduped by URL."""
    seen: dict[str, dict] = {}
    for area, aliases in PILOT_AREAS.items():
        found = 0
        for alias in aliases:
            res = client.search(
                f"{alias} San Francisco {TOPIC}",
                limit=8,
                tbs="qdr:m",  # past month
                include_domains=OUTLETS,
            )
            for r in res.web or []:
                found += 1
                if r.url not in seen:
                    seen[r.url] = {"url": r.url, "title": r.title or "", "found_via": area}
            if found >= MAX_ARTICLES_PER_AREA:
                break
        print(f"[search] {area}: {found} hits ({len(seen)} unique so far)")
    return list(seen.values())


def _known_article_shas() -> set[str]:
    """Article hashes already captured in ANY prior snapshot — daily runs only pay
    for NEW articles (scrape + extraction skipped for known URLs)."""
    return {p.stem for p in (base.RAW_DIR / "news_sf").glob("*/*.md")}


# Street-suffix words the Census geocoder normalizes away, and directional
# prefixes it abbreviates — both handled when verifying a match echo.
_SUFFIX_TOKENS = {
    "st", "street", "ave", "avenue", "blvd", "boulevard", "dr", "drive", "rd",
    "road", "way", "ln", "lane", "ct", "court", "pl", "place", "ter", "terrace",
    "hwy", "highway", "aly", "alley",
}
_DIR_TOKENS = {"north": "n", "south": "s", "east": "e", "west": "w",
               "n": "n", "s": "s", "e": "e", "w": "w"}


def _match_echoes(address: str, matched: str) -> bool:
    """Every distinctive token of the input street must appear in the geocoder's
    matched address. We append ', San Francisco, CA' to every query, so a fuzzy
    match can silently RELOCATE an out-of-town address onto an SF street of a
    similar name ('653 North 7th Street' in San Jose → SF's plain '7th St').
    Rejecting a non-echoing match demotes precision — rule #13's safe direction."""
    want = re.findall(r"[a-z0-9]+", address.split(",")[0].lower())
    have = set(re.findall(r"[a-z0-9]+", matched.lower()))
    have |= {_DIR_TOKENS[t] for t in have if t in _DIR_TOKENS}
    return all(
        _DIR_TOKENS.get(t, t) in have
        for t in want
        if t not in _SUFFIX_TOKENS
    )


def _geocode_safe(address: str) -> tuple[float, float] | None:
    """app.pipeline.lookup.geocode raises SystemExit on no-match (CLI heritage) —
    wrap it, and verify the match echoes the input street (see _match_echoes);
    any failure demotes precision rather than faking coordinates."""
    try:
        from app.pipeline.lookup import geocode

        lat, lon, matched = geocode(f"{address}, San Francisco, CA")
    except SystemExit:
        return None
    except Exception:  # noqa: BLE001 — geocoder down ≠ collection down
        return None
    if not _match_echoes(address, matched or ""):
        return None
    return lat, lon


# Claim-area label → spine neighborhood names. The spine's 37-name set differs
# from our labels (Japantown sits inside Western Addition; Bayview Hunters Point
# is plain 'Bayview'). FAN-OUT RULE: every new area MUST get a mapping here, or
# the agreement guard abstains for its claims.
_SPINE_AREAS: dict[str, set[str]] = {
    "Mission": {"Mission"},
    "Bayview Hunters Point": {"Bayview"},
    "Japantown": {"Western Addition"},
}


def _pin_agrees_with_area(h3: str, area: str | None) -> bool | None:
    """THE structural guard for wrong-city / wrong-area pins: a claim carries two
    independent location signals — the text's area label and the geocoded pin —
    and they must AGREE on the H3 spine (k=1 ring absorbs boundary edges).
    False = disagreement (SJ's Japantown pin resolves to South of Market, not
    Western Addition). None = no basis to judge (unmapped area / spine down)."""
    want = _SPINE_AREAS.get(area or "")
    if not want:
        return None
    try:
        from app.api import db

        hexes = [h3, *db.ring_hexes(h3, 1)]
        ph = ",".join("?" for _ in hexes)
        rows = db.query(f"SELECT DISTINCT neighborhood FROM areas WHERE h3_9 IN ({ph})", hexes)
    except Exception:  # noqa: BLE001 — spine unavailable → abstain
        return None
    if not rows:
        return False  # pin isn't anywhere in the spine → not even in SF
    return bool(want & {r["neighborhood"] for r in rows})


def _enrich(claim: dict, *, url: str, outlet: str, article_sha: str, found_via: str) -> dict:
    """Contract-mandatory fields: claim_id, lifecycle, honest precision (+h3)."""
    fetched = base.today()
    event_type = claim.get("event_type") or "other"
    precision = claim.get("location_precision") or "neighborhood"

    out = {
        "claim_id": hashlib.sha256((url + (claim.get("quote") or "")).encode()).hexdigest()[:16],
        "tier": "claim",  # epistemic tier, explicit (RECORD > CLAIM > CONTRIBUTED)
        "status": "claimed",
        "expires_at": (fetched + timedelta(days=EXPIRY_DAYS.get(event_type, DEFAULT_EXPIRY_DAYS))).isoformat(),
        "outlet": outlet,
        "url": url,
        "article_sha": article_sha,
        "found_via": found_via,
        "fetched_at": base.now_iso(),
        "corroborating_event_id": None,
        **claim,
        "location_precision": precision,
    }

    # Rule #13: h3 ONLY at point/block precision, and only via a real geocode.
    if precision in ("point", "block") and claim.get("address"):
        coords = _geocode_safe(claim["address"])
        if coords:
            out["lat"], out["lon"] = coords
            try:
                from app.api import db

                out["h3_9"] = db.hex_for_point(*coords)
            except Exception:  # noqa: BLE001 — DuckDB/h3 unavailable → no hex, honest
                pass
        else:
            out["location_precision"] = "neighborhood"  # demote, never fake
        # Agreement guard: text area vs pin must concur on the spine; on
        # disagreement the coarser truth wins (the text is primary evidence,
        # the geocode is derived — so keep the area, drop the pin).
        if out.get("h3_9") and _pin_agrees_with_area(out["h3_9"], out.get("area")) is False:
            for k in ("h3_9", "lat", "lon"):
                out.pop(k, None)
            out["location_precision"] = "neighborhood"
            # Either signal could be the wrong one (a SoMa pin under a Mission
            # label was a wrong LABEL) — surface it for the human review loop.
            out["location_conflict"] = True
    return out


def fetch_daily(force: bool = False) -> None:  # noqa: ARG001 — force unused; dedupe is content-based
    """Collect new articles + extract claims. Safe to run daily (or repeatedly):
    only never-seen URLs are scraped and extracted."""
    import anthropic

    from app.scraping.client import get_client

    fc = get_client()
    llm = anthropic.Anthropic()
    known = _known_article_shas()

    hits = _search_all(fc)
    new_hits = [h for h in hits if hashlib.sha256(h["url"].encode()).hexdigest()[:16] not in known]
    print(f"[total] {len(hits)} unique articles, {len(new_hits)} new")
    if not new_hits:
        print("[current] news_sf: nothing new today")
        return

    as_of = base.today().isoformat()
    snap = base.Snapshot(
        SPEC.key, as_of, geography=SPEC.geography,
        source_name=SPEC.name, license=SPEC.license, homepage=SPEC.homepage,
    )

    all_claims: list[dict] = []
    stats = {"searched": len(hits), "new": len(new_hits), "scraped": 0,
             "scrape_failed": 0, "dropped_other": 0, "tokens_in": 0, "tokens_out": 0}

    for hit in new_hits:
        url = hit["url"]
        sha = hashlib.sha256(url.encode()).hexdigest()[:16]
        try:
            doc = fc.scrape(url, formats=["markdown"], only_main_content=True)
            md = doc.markdown or ""
            if len(md) < 400:  # paywall stub / empty
                stats["scrape_failed"] += 1
                continue
        except Exception as exc:  # noqa: BLE001 — paywalls/blocks are expected noise
            stats["scrape_failed"] += 1
            print(f"    [skip] {url[:70]} ({str(exc)[:50]})")
            continue
        stats["scraped"] += 1
        snap.write_bytes(f"{sha}.md", md.encode())

        claims, usage = _extract_claims(llm, md)
        stats["tokens_in"] += usage["in"]
        stats["tokens_out"] += usage["out"]
        outlet = url.split("/")[2].removeprefix("www.")
        kept = 0
        for c in claims:
            if c.get("area") not in PILOT_AREAS:  # "other" or malformed → discard
                stats["dropped_other"] += 1
                continue
            kept += 1
            all_claims.append(_enrich(c, url=url, outlet=outlet, article_sha=sha, found_via=hit["found_via"]))
        print(f"    [{kept:>2} kept / {len(claims) - kept} other] {hit['title'][:58]}")

    # Unique per run — a second same-day run never clobbers the morning's claims.
    run_ts = base.now_iso().replace(":", "").replace("-", "")[:15]
    snap.write_json(f"claims_{run_ts}.json", all_claims)
    cost = stats["tokens_in"] / 1e6 * 1.0 + stats["tokens_out"] / 1e6 * 5.0  # haiku 4.5 $/Mtok
    snap.finalize(extra={"stats": stats, "extraction_model": EXTRACT_MODEL,
                         "est_extraction_cost_usd": round(cost, 4), "n_claims": len(all_claims)})
    print(f"\nCOLLECTED: {stats['scraped']} new articles, {len(all_claims)} claims, ≈ ${cost:.3f}")


def _extract_claims(anthropic_client, markdown: str) -> tuple[list[dict], dict]:
    msg = anthropic_client.messages.create(
        model=EXTRACT_MODEL,
        max_tokens=2000,
        messages=[{"role": "user", "content": EXTRACT_PROMPT.format(article=markdown[:14000])}],
    )
    text = msg.content[0].text
    usage = {"in": msg.usage.input_tokens, "out": msg.usage.output_tokens}
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return [], usage
    try:
        return json.loads(m.group(0)).get("claims", []), usage
    except json.JSONDecodeError:
        return [], usage


# --------------------------------------------------------------------------- #
#  Claims state (derived, rebuildable — never a mutable store)
# --------------------------------------------------------------------------- #

def _tokens(name: str | None) -> set[str]:
    if not name:
        return set()
    return {
        t for t in re.findall(r"[a-z0-9']+", name.lower())
        if len(t) > 2 and t not in _STOP_TOKENS
    }


def _street_number(address: str | None) -> str | None:
    m = re.match(r"\s*(\d{2,5})\b", address or "")
    return m.group(1) if m else None


def _corroborate(claim: dict) -> tuple[str, str] | None:
    """Find a record event confirming this claim. Returns (event_id, event_type)
    or None. Conservative: ring k=2 around the claim's hex, mapped event types,
    time window [fetched-30d, today], ≥1 distinctive name token or street-number
    match. Zero matches is a VALID outcome — announcements lead records by months."""
    types = CORROBORATING_TYPES.get(claim.get("event_type") or "")
    h3 = claim.get("h3_9")
    if not types or not h3:
        return None

    from app.api import db

    try:
        hexes = db.ring_hexes(h3, 2)
    except Exception:  # noqa: BLE001
        return None
    since = (date.fromisoformat(claim["fetched_at"][:10]) - timedelta(days=30)).isoformat()
    hex_ph = ",".join("?" for _ in hexes)
    type_ph = ",".join("?" for _ in types)
    try:
        rows = db.query(
            f"""
            SELECT e.source, e.event_type, e.record_key, e.detail,
                   p.name AS place_name
            FROM events e
            LEFT JOIN places p ON e.record_key = p.place_key
            WHERE e.h3_9 IN ({hex_ph})
              AND e.event_type IN ({type_ph})
              AND e.event_time BETWEEN CAST(? AS DATE) AND CURRENT_DATE
            ORDER BY e.event_time
            """,
            [*hexes, *types, since],
        )
    except Exception:  # noqa: BLE001 — DuckDB absent/locked → try again next run
        return None

    want = _tokens(claim.get("entity_name"))
    street_no = _street_number(claim.get("address"))
    for r in rows:
        have = _tokens(r.get("place_name")) | _tokens(r.get("detail"))
        name_hit = bool(want & have)
        addr_hit = bool(street_no) and street_no in (r.get("detail") or "")
        if name_hit or addr_hit:
            return f"{r['source']}:{r['record_key']}", r["event_type"]
    return None


def _overrides() -> dict[str, str]:
    """Human refutations (claim_id → reason), git-tracked next to this module.
    L0 snapshots stay immutable; a bad claim is killed here, with its reason on
    the record — the lifecycle's `refuted` state (DATA_CONTRACT §4b)."""
    path = base.BACKEND_DIR / "app" / "ingestion" / "news_overrides.json"
    try:
        return json.loads(path.read_text()).get("refuted", {})
    except (OSError, ValueError):
        return {}


def claims_build() -> dict:
    """Rebuild data/processed/claims.json from ALL raw snapshots (idempotent).
    Lifecycle: claimed → corroborated/materialized (record match) → expired,
    or refuted (human override)."""
    merged: dict[str, dict] = {}
    for path in sorted((base.RAW_DIR / "news_sf").glob("*/claims*.json")):
        try:
            for c in json.loads(path.read_text()):
                cid = c.get("claim_id") or hashlib.sha256(
                    ((c.get("url") or "") + (c.get("quote") or "")).encode()
                ).hexdigest()[:16]
                merged.setdefault(cid, {"claim_id": cid, "tier": "claim", "status": "claimed", **c})
        except (OSError, ValueError):
            continue

    today = base.today()
    refuted = _overrides()
    counts = {"claimed": 0, "corroborated": 0, "materialized": 0, "expired": 0, "refuted": 0}
    for c in merged.values():
        # pre-v3 pilot claims lack lifecycle fields — give them the defaults
        c.setdefault("status", "claimed")
        c.setdefault("expires_at",
                     (date.fromisoformat(c["fetched_at"][:10]) + timedelta(days=DEFAULT_EXPIRY_DAYS)).isoformat()
                     if c.get("fetched_at") else (today + timedelta(days=DEFAULT_EXPIRY_DAYS)).isoformat())

        if c["claim_id"] in refuted:
            c["status"] = "refuted"
            c["refuted_reason"] = refuted[c["claim_id"]]
            for k in ("h3_9", "lat", "lon"):  # refutation voids any pinned location
                c.pop(k, None)
            counts["refuted"] += 1
            continue

        match = _corroborate(c) if c["status"] in ("claimed", "corroborated") else None
        if match:
            event_id, event_type = match
            c["corroborating_event_id"] = event_id
            c["status"] = "materialized" if event_type in MATERIALIZING_TYPES else "corroborated"
        elif c["status"] == "claimed" and c["expires_at"] < today.isoformat():
            c["status"] = "expired"
        counts[c["status"]] = counts.get(c["status"], 0) + 1

    state = {
        "generated_at": base.now_iso(),
        "note": "Derived + rebuildable from data/raw/news_sf/. Epistemic tier CLAIM — "
                "never aggregated into metrics (DATA_CONTRACT rule #10).",
        "counts": counts,
        "claims": sorted(merged.values(), key=lambda c: c.get("fetched_at") or "", reverse=True),
    }
    base.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    CLAIMS_STATE_PATH.write_text(json.dumps(state, indent=1))

    # Regenerate the review CSV WITHOUT erasing the human's work: verdicts are
    # keyed by claim_id and carried over from the existing file.
    verdicts: dict[str, str] = {}
    if REVIEW_PATH.exists():
        with REVIEW_PATH.open(newline="") as f:
            for row in csv.DictReader(f):
                if row.get("claim_id") and row.get("human_verdict"):
                    verdicts[row["claim_id"]] = row["human_verdict"]
    with REVIEW_PATH.open("w", newline="") as f:
        fields = ["claim_id", "area", "outlet", "event_type", "status", "location_precision",
                  "location_conflict", "claim", "quote", "url", "human_verdict"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for c in state["claims"]:
            w.writerow({k: c.get(k, "") for k in fields[:-1]}
                       | {"human_verdict": verdicts.get(c["claim_id"], "")})

    print(f"claims_build: {len(merged)} claims -> {counts} -> {CLAIMS_STATE_PATH}")
    return state


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pilot", action="store_true", help="collect now (same path as the daily job)")
    parser.add_argument("--build", action="store_true", help="rebuild claims state only")
    args = parser.parse_args()
    if args.pilot:
        fetch_daily()
        claims_build()
    elif args.build:
        claims_build()
    else:
        raise SystemExit("use --pilot (collect+build) or --build (state only)")


if __name__ == "__main__":
    main()
