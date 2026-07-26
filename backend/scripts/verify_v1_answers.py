#!/usr/bin/env python
"""Independent verification of benchmark_v1.json against live DataSF Socrata (SODA) APIs.

PURPOSE (credibility artifact for the paper): re-derive every expected answer of the
frozen AI benchmark (data/processed/benchmark_v1.json) DIRECTLY from San Francisco's
public open-data APIs, importing NOTHING from the Canary pipeline (app/*). A reviewer
can read this one file, see every semantic choice inline with its justification, run
it, and check the benchmark's answers against the city's own records without trusting
any Canary code. Allowed imports: Python stdlib + requests. Aggregation is done
server-side by the city's SODA endpoints (SoQL $select/$where/$group) wherever
possible; the only client-side math is set membership, substring matching, ratios,
and a per-permit dedupe for the address rings.

DATA SOURCES (live SODA endpoints, no API key required):
    Building permits      https://data.sfgov.org/resource/i98e-djp9.json
    Registered businesses https://data.sfgov.org/resource/g8m3-pdis.json
    Police incidents 2018+ https://data.sfgov.org/resource/wg3w-h783.json
    Eviction notices      https://data.sfgov.org/resource/5cei-gny5.json
    311 cases             https://data.sfgov.org/resource/vw6y-z8j6.json
    Census geocoder       https://geocoding.geo.census.gov (address_forward only; the
                          benchmark generator used the same public federal geocoder)

NEIGHBORHOOD ASSIGNMENT: every count here uses the CITY's own "Analysis Neighborhood"
column carried on each dataset (API field names: neighborhoods_analysis_boundaries,
analysis_neighborhood, or neighborhood, per dataset -- verified against each dataset's
view metadata). Canary's neighborhood-level metrics use the same source column, so
this check does not depend on Canary's H3 spine; small divergence, where it appears,
is real signal about the source, not about Canary.

TIME WINDOWS (re-derived from the pipeline definitions, not imported):
  The benchmark was generated 2026-07-26T02:33:20Z on a machine in America/Los_Angeles
  (= 2026-07-25 19:33 PDT), from snapshots with source_as_of 2026-07-24. DuckDB's
  current_date follows the local timezone (verified empirically), so at generation
  current_date = 2026-07-25.
  - Trajectory windows (direction / superlative / pairwise / trap questions) anchor at
    date_trunc('month', current_date) = 2026-07-01, and the pipeline's metrics grid
    keeps only complete past months, therefore:
        last12  = [2025-07-01, 2026-07-01)
        prior12 = [2024-07-01, 2025-07-01)
  - Temporal questions compare fiscal-style years:
        jul23_jun24 = [2023-07-01, 2024-07-01)
        jul24_jun25 = [2024-07-01, 2025-07-01)   (identical to prior12)
  - The numeric net-units block and the address rings use ROLLING windows over raw
    events (no month clip): event_time >= current_date - 12 (resp. 24) months, i.e.
    issued_date >= 2025-07-25 (resp. 2024-07-25), bounded above only by the data the
    2026-07-24 snapshot contained. To reproduce that bound against the live (moving)
    API, those rolling windows are capped at issued_date <= 2026-07-24T23:59:59.
    (Sanity anchor: Nob Hill sum(proposed-existing) over [2025-07-25, 2026-07-24]
    reproduces the frozen 1319 exactly; the month-clipped window reproduces 987.)
  - Month-clipped windows end 2026-06-30 < snapshot date, so no cap is needed there;
    any divergence is late-arriving/revised rows in the live API ("drift").

ADDRESS-RING GEOMETRY FINDING (q035-q037): the questions say "within about 500 meters".
The independent value here is the TRUE geodesic 500 m disk around the independently
geocoded address (haversine on the permit's own coordinates). Verification uncovered
that the generator's ring was NOT a true 500 m disk: it computed
DuckDB ST_Distance_Sphere(ST_Point(lon, lat), ...), but that function expects
EPSG:4326 authority axis order (x = LATITUDE) -- verified empirically: with
ST_Point(lon, lat) a 0.01 degree latitude step measures 596 m instead of 1111.9 m and a
0.01 degree longitude step measures 1111.9 m instead of 878.9 m at SF's latitude. The
frozen rings are therefore anisotropic (~395 m east-west by ~933 m north-south,
additionally clipped by an H3 res-9 k=2 disk). Feeding live rows through that exact
distorted predicate reproduces the frozen unit totals precisely (494 / 43 / 53), so
each ring record below carries BOTH numbers: the true-500 m-disk answer (used for the
verdict -- never adjusted to force agreement) and the pipeline-formula replication
(pure-Python swapped-axis haversine, no H3 clip) that explains the frozen value.

METRIC SEMANTICS (copied as constants from app/pipeline/build.py + stage.py, with the
column renames resolved back to the SODA API field names; justification inline below):
  permits_issued        count of permit rows with a non-null issued_date in window.
                        NO status filter: the pipeline treats the presence of the
                        city's Issued Date as the issuance event itself.
  units_approved_net    sum(coalesce(proposed_units,0) - coalesce(existing_units,0))
                        over the same permit-issued rows. Socrata stores these unit
                        columns as text, so SoQL casts them with ::number (a failed
                        cast becomes null, matching the pipeline's try_cast).
  biz_openings          count of registry rows by LOCATION start date
                        (location_start_date, NOT dba_start_date -- the pipeline's
                        place open event is the location's own start date).
  active_businesses     count of registry rows with location_start_date IS NOT NULL
                        AND location_end_date IS NULL (a "place" exists only if it has
                        a start date; it is active while it has no end date). This is
                        a current-state attribute: it cannot be capped at the snapshot
                        date, so live churn since 2026-07-24 is expected drift.
  crime_*               count of incident rows by incident_date (the 2018-present
                        dataset), classified by exact incident_category string match
                        against the frozensets below.
  evictions_filed       count of eviction-notice rows by file_date.
  threeoneone_*         count of 311 cases by requested_datetime ("Opened");
                        encampment = Category (service_name) contains 'encampment'
                        case-insensitively; noise = contains 'noise'; the refined
                        noise metric additionally excludes rows whose Request Type
                        (service_subtype) == 'other_excessive_noise' (see q043).

CRIME CATEGORY SPLIT (inlined from app/pipeline/crime_categories.py): police incident
counts mix (a) crimes a member of the public reports being a victim of, and (b)
incidents that exist because police proactively acted (stops, warrants, drug/weapon
possession discovered via searches, sit-lie sweeps). A surge in (b) measures a
crackdown, not more victimization -- so the benchmark's user-facing crime trend is
VICTIM_REPORTED only, ENFORCEMENT_DRIVEN is tracked separately, and categories in
neither set (administrative/ambiguous: lost property, case closures, suspicious occ)
count only toward the unsplit crime_incidents total. Matching is exact and
case-sensitive, as in the pipeline (the lists include the dataset's typo variants).

VERDICTS per question:
  confirmed     numeric/address: |delta| <= the question's tolerance_pct;
                direction/temporal: independently derived change has the expected sign;
                superlative/pairwise: same winning area;
                trap: the refined-vs-nominal decomposition reproduces the artifact.
  drift         small mismatch plausibly explained by the live API having moved past
                the frozen 2026-07-24 snapshot (public records are append-mostly):
                numeric within 1.5x tolerance; superlative where the expected area is
                still top-3 within 0.05 pct-points of the winner (or 5% of the winner
                for the absolute-units superlative); pairwise where the gap is < 0.02.
  mismatch      real disagreement (never forced into agreement -- documented as-is).
  not_verified  cannot be re-derived from the public API alone (reason given).

CACHING: every HTTP response is cached under data/processed/verification_cache/ keyed
by a hash of the full URL, so re-runs are cheap and deterministic. Delete that
directory to force fresh pulls.

Usage:
    venv/bin/python scripts/verify_v1_answers.py
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

# --------------------------------------------------------------------------------
# paths
# --------------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parents[1]
BENCHMARK_PATH = BACKEND_DIR / "data" / "processed" / "benchmark_v1.json"
CACHE_DIR = BACKEND_DIR / "data" / "processed" / "verification_cache"
OUT_PATH = BACKEND_DIR / "data" / "processed" / "benchmark_v1_verification.json"

# --------------------------------------------------------------------------------
# endpoints and field names (field names verified against each dataset's Socrata
# view metadata, /api/views/<id>.json, on 2026-07-26)
# --------------------------------------------------------------------------------
PERMITS = "https://data.sfgov.org/resource/i98e-djp9.json"   # 1 row per permit record
REGBIZ = "https://data.sfgov.org/resource/g8m3-pdis.json"    # registered business locations
CRIME = "https://data.sfgov.org/resource/wg3w-h783.json"     # police incidents 2018-present
EVICTIONS = "https://data.sfgov.org/resource/5cei-gny5.json" # eviction notices
CASES311 = "https://data.sfgov.org/resource/vw6y-z8j6.json"  # 311 cases
CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"

# city neighborhood column per dataset (the CSV display name differs from the API
# field name; these are the API field names):
#   permits   neighborhoods_analysis_boundaries   ("neighborhoods_analysis_boundaries")
#   regbiz    neighborhoods_analysis_boundaries   ("Neighborhoods - Analysis Boundaries")
#   crime     analysis_neighborhood               ("Analysis Neighborhood")
#   311       analysis_neighborhood               ("Analysis Neighborhood")
#   evictions neighborhood                        ("Neighborhoods - Analysis Boundaries")
HOOD_PERMITS = "neighborhoods_analysis_boundaries"
HOOD_REGBIZ = "neighborhoods_analysis_boundaries"
HOOD_CRIME = "analysis_neighborhood"
HOOD_311 = "analysis_neighborhood"
HOOD_EVICTIONS = "neighborhood"

# --------------------------------------------------------------------------------
# time windows (see module docstring for the derivation)
# --------------------------------------------------------------------------------
SNAPSHOT_AS_OF = "2026-07-24"                      # source_as_of of the frozen snapshots
LAST12 = ("2025-07-01", "2026-07-01")              # trailing 12 complete months
PRIOR12 = ("2024-07-01", "2025-07-01")             # the 12 before (== jul24_jun25)
FY24 = ("2023-07-01", "2024-07-01")                # jul23_jun24 (temporal questions)
ROLL12_START = "2025-07-25"                        # current_date(2026-07-25) - 12 months
ROLL24_START = "2024-07-25"                        # current_date(2026-07-25) - 24 months
SNAPSHOT_CAP = "2026-07-24T23:59:59"               # upper cap replicating the snapshot end
RING_RADIUS_M = 500

MIN_EVENTS = 24  # trajectory "rankable" volume floor: last12 + prior12 >= 24 events

# verdict thresholds (documented in the docstring)
NUMERIC_DRIFT_FACTOR = 1.5          # outside tolerance but within 1.5x tolerance -> drift
SUPERLATIVE_DRIFT_MARGIN = 0.05     # pct-points between winner and expected -> drift
SUPERLATIVE_DRIFT_TOPK = 3          # expected must still rank this high for drift
PAIRWISE_DRIFT_GAP = 0.02           # pct-points gap below which a flipped pair is drift
TRAP_NOMINAL_MIN = 0.50             # nominal noise rise must still look like "over 60%"
TRAP_REFINED_MAX = 0.35             # refined metric must be well below the nominal rise
TRAP_DECOMP_GAP = 0.15              # nominal - refined must exceed this

# --------------------------------------------------------------------------------
# crime category split, inlined verbatim from app/pipeline/crime_categories.py.
# Rationale: enforcement activity is not victimization -- counting police-initiated
# incidents (stops, warrants, possession discovered by search, sit-lie sweeps) as
# "crime" makes a crackdown look like a crime wave. The benchmark's crime trend
# questions are therefore defined over VICTIM_REPORTED categories only; categories in
# neither set count only toward the unsplit crime_incidents total.
# --------------------------------------------------------------------------------
VICTIM_REPORTED = frozenset({
    "Larceny Theft", "Assault", "Burglary", "Motor Vehicle Theft",
    "Motor Vehicle Theft?", "Robbery", "Malicious Mischief", "Vandalism", "Fraud",
    "Arson", "Embezzlement", "Forgery And Counterfeiting", "Sex Offense", "Rape",
    "Homicide", "Offences Against The Family And Children",
})
ENFORCEMENT_DRIVEN = frozenset({
    "Drug Offense", "Drug Violation", "Warrant", "Prostitution", "Weapons Offense",
    "Weapons Carrying Etc", "Weapons Offence", "Stolen Property",
    "Traffic Violation Arrest", "Disorderly Conduct", "Civil Sidewalks", "Liquor Laws",
    "Gambling", "Human Trafficking (A), Commercial Sex Acts",
    "Human Trafficking (B), Involuntary Servitude",
    "Human Trafficking, Commercial Sex Acts",
})

# the 311 catch-all Request Type excluded by the refined noise metric (q043): a
# March-2026 mobile-app flow change funnels reports into this bucket, a reporting
# artifact rather than a change in conditions. Exact, case-sensitive value as it
# appears in the dataset's service_subtype column (snake_case from the new 311 system).
NOISE_CATCHALL_SUBTYPE = "other_excessive_noise"


# --------------------------------------------------------------------------------
# HTTP with on-disk cache
# --------------------------------------------------------------------------------
_session = requests.Session()
_session.headers["User-Agent"] = "canary-benchmark-independent-verification/1.0"
_uncached_calls = 0


def _cached_get(url: str, params: dict) -> object:
    """GET with a content cache keyed by the full URL; retries on 429/5xx."""
    global _uncached_calls
    full = requests.Request("GET", url, params=params).prepare().url
    key = hashlib.sha256(full.encode()).hexdigest()[:24]
    cache_file = CACHE_DIR / f"{key}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text())["data"]

    delay = 2.0
    for attempt in range(5):
        try:
            resp = _session.get(full, timeout=300)
        except requests.RequestException:
            # cold Socrata group-bys can exceed the read timeout on first execution;
            # the retry usually hits the warmed query cache
            if attempt < 4:
                time.sleep(delay)
                delay *= 2
                continue
            raise
        if resp.status_code in (429, 500, 502, 503, 504) and attempt < 4:
            time.sleep(delay)
            delay *= 2
            continue
        resp.raise_for_status()
        data = resp.json()
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(
            {"url": full, "fetched_at": datetime.now(timezone.utc).isoformat(), "data": data}
        ))
        _uncached_calls += 1
        time.sleep(0.4)  # politeness between live requests
        return data
    raise RuntimeError(f"unreachable: {full}")


def soda(resource: str, **params: str) -> list[dict]:
    """SODA query; asserts the result was not truncated at $limit."""
    params.setdefault("$limit", "100000")
    rows = _cached_get(resource, params)
    if not isinstance(rows, list):
        raise RuntimeError(f"SODA error from {resource}: {rows}")
    if len(rows) >= int(params["$limit"]):
        raise RuntimeError(f"result truncated at $limit={params['$limit']} for {resource} {params}")
    return rows


def window_where(date_field: str, start: str, end: str) -> str:
    """Half-open [start, end) filter on a Socrata calendar_date field."""
    return f"{date_field} >= '{start}T00:00:00' AND {date_field} < '{end}T00:00:00'"


# --------------------------------------------------------------------------------
# fetch phase: one grouped request per (dataset, window)
# --------------------------------------------------------------------------------
def fetch_permits_by_hood(window: tuple[str, str]) -> dict[str, dict]:
    """Per-neighborhood permit_issued count and net units, one server-side groupby.

    sum() ignores nulls, so sum(proposed) - sum(existing) equals the pipeline's
    sum(coalesce(proposed,0) - coalesce(existing,0)).
    """
    rows = soda(
        PERMITS,
        **{
            "$select": f"{HOOD_PERMITS} as hood, count(*) as n, "
                       "sum(proposed_units::number) as p, sum(existing_units::number) as e",
            "$where": f"{window_where('issued_date', *window)} AND {HOOD_PERMITS} IS NOT NULL",
            "$group": "hood",
        },
    )
    return {
        r["hood"]: {
            "n": int(r["n"]),
            "units": float(r.get("p") or 0) - float(r.get("e") or 0),
        }
        for r in rows
    }


def fetch_crime_by_hood_cat(window: tuple[str, str]) -> dict[str, dict[str, int]]:
    """Per-(neighborhood, incident_category) counts; classification happens client-side."""
    rows = soda(
        CRIME,
        **{
            "$select": f"{HOOD_CRIME} as hood, incident_category as cat, count(*) as n",
            "$where": f"{window_where('incident_date', *window)} AND {HOOD_CRIME} IS NOT NULL",
            "$group": "hood, cat",
        },
    )
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        out.setdefault(r["hood"], {})[r.get("cat") or ""] = int(r["n"])
    return out


def crime_sums(by_cat: dict[str, int]) -> dict[str, int]:
    return {
        "total": sum(by_cat.values()),
        "victim": sum(n for c, n in by_cat.items() if c in VICTIM_REPORTED),
        "enforcement": sum(n for c, n in by_cat.items() if c in ENFORCEMENT_DRIVEN),
    }


def fetch_biz_openings_by_hood(window: tuple[str, str]) -> dict[str, int]:
    rows = soda(
        REGBIZ,
        **{
            "$select": f"{HOOD_REGBIZ} as hood, count(*) as n",
            "$where": f"{window_where('location_start_date', *window)} AND {HOOD_REGBIZ} IS NOT NULL",
            "$group": "hood",
        },
    )
    return {r["hood"]: int(r["n"]) for r in rows}


def fetch_active_biz_by_hood() -> dict[str, int]:
    rows = soda(
        REGBIZ,
        **{
            "$select": f"{HOOD_REGBIZ} as hood, count(*) as n",
            "$where": f"location_start_date IS NOT NULL AND location_end_date IS NULL "
                      f"AND {HOOD_REGBIZ} IS NOT NULL",
            "$group": "hood",
        },
    )
    return {r["hood"]: int(r["n"]) for r in rows}


def fetch_evictions_by_hood(window: tuple[str, str]) -> dict[str, int]:
    rows = soda(
        EVICTIONS,
        **{
            "$select": f"{HOOD_EVICTIONS} as hood, count(*) as n",
            "$where": f"{window_where('file_date', *window)} AND {HOOD_EVICTIONS} IS NOT NULL",
            "$group": "hood",
        },
    )
    return {r["hood"]: int(r["n"]) for r in rows}


def fetch_311_by_hood_cat(window: tuple[str, str]) -> dict[str, dict[str, int]]:
    rows = soda(
        CASES311,
        **{
            "$select": f"{HOOD_311} as hood, service_name as cat, count(*) as n",
            "$where": f"{window_where('requested_datetime', *window)} AND {HOOD_311} IS NOT NULL",
            "$group": "hood, cat",
        },
    )
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        out.setdefault(r["hood"], {})[r.get("cat") or ""] = int(r["n"])
    return out


def fetch_311_noise_subtypes(window: tuple[str, str]) -> dict[tuple[str, str], int]:
    """(Category, Request Type) counts for noise categories, citywide, hood non-null
    (the trap's ground truth sums neighborhood-level rows, which requires a non-null
    Analysis Neighborhood)."""
    rows = soda(
        CASES311,
        **{
            "$select": "service_name as cat, service_subtype as sub, count(*) as n",
            "$where": f"{window_where('requested_datetime', *window)} AND {HOOD_311} IS NOT NULL "
                      "AND upper(service_name) LIKE '%NOISE%'",
            "$group": "cat, sub",
        },
    )
    return {(r.get("cat") or "", r.get("sub") or ""): int(r["n"]) for r in rows}


def fetch_units_rolling_by_hood() -> dict[str, dict]:
    """Net units on the ROLLING 12-month window used by the numeric block:
    issued_date in [2025-07-25, snapshot end 2026-07-24]."""
    rows = soda(
        PERMITS,
        **{
            "$select": f"{HOOD_PERMITS} as hood, count(*) as n, "
                       "sum(proposed_units::number) as p, sum(existing_units::number) as e",
            "$where": f"issued_date >= '{ROLL12_START}T00:00:00' AND issued_date <= '{SNAPSHOT_CAP}' "
                      f"AND {HOOD_PERMITS} IS NOT NULL",
            "$group": "hood",
        },
    )
    return {
        r["hood"]: {"n": int(r["n"]), "units": float(r.get("p") or 0) - float(r.get("e") or 0)}
        for r in rows
    }


def geocode(address: str) -> tuple[float, float] | None:
    """US Census geocoder (the same public service the benchmark generator used)."""
    result = _cached_get(
        CENSUS_GEOCODER,
        {"address": address, "benchmark": "Public_AR_Current", "format": "json"},
    )
    matches = result.get("result", {}).get("addressMatches", []) if isinstance(result, dict) else []
    if not matches:
        return None
    return matches[0]["coordinates"]["y"], matches[0]["coordinates"]["x"]


def fetch_ring_candidates(lat: float, lon: float) -> list[dict]:
    """Permit rows issued in the rolling 24-month window within 1000 m of the point
    (a superset: covers both the true 500 m disk and the distorted pipeline ring,
    whose north-south reach is ~933 m). The exact 500 m membership is then computed
    client-side from each permit's own coordinates, so the final number does not
    depend on Socrata's within_circle boundary behavior."""
    return soda(
        PERMITS,
        **{
            "$select": "permit_number, issued_date, proposed_units, existing_units, location",
            "$where": f"within_circle(location, {lat}, {lon}, 1000) "
                      f"AND issued_date >= '{ROLL24_START}T00:00:00' AND issued_date <= '{SNAPSHOT_CAP}'",
            "$limit": "50000",
        },
    )


_EARTH_R = 6_371_008.8  # mean Earth radius, meters


def _haversine_m(phi1_deg: float, lam1_deg: float, phi2_deg: float, lam2_deg: float) -> float:
    """Great-circle distance where phi is taken as latitude and lam as longitude."""
    phi1, lam1, phi2, lam2 = map(math.radians, (phi1_deg, lam1_deg, phi2_deg, lam2_deg))
    a = (math.sin((phi2 - phi1) / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin((lam2 - lam1) / 2) ** 2)
    return 2 * _EARTH_R * math.asin(math.sqrt(a))


def dist_true_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Correct geodesic (haversine) distance in meters."""
    return _haversine_m(lat1, lon1, lat2, lon2)


def dist_pipeline_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """DIAGNOSTIC ONLY -- replicates the generator's distance: it called DuckDB
    ST_Distance_Sphere with ST_Point(lon, lat), but the function expects
    x = latitude (EPSG:4326 authority order), so longitudes were treated as
    latitudes and vice versa. Equivalent to haversine with the axes swapped."""
    return _haversine_m(lon1, lat1, lon2, lat2)


def ring_summary(rows: list[dict], lat: float, lon: float) -> dict:
    """Dedupe by permit_number (pipeline kept one arbitrary row per permit), then
    sum coalesced unit deltas over (a) the true 500 m geodesic disk -- the question's
    stated semantics, used for the verdict -- and (b) the pipeline's swapped-axis
    ring (without its H3 k=2 clip, which only trims a few edge permits and, on these
    three rings, does not change the unit totals). Also reports the largest-unit
    permits on which the two geometries disagree."""
    seen: dict[str, dict] = {}
    for r in rows:
        if r.get("location"):
            seen.setdefault(r["permit_number"], r)
    true_disk = {"n_permits": 0, "units": 0.0}
    swapped = {"n_permits": 0, "units": 0.0}
    disagreements: list[dict] = []
    for pn, r in seen.items():
        plon, plat = (float(v) for v in r["location"]["coordinates"])  # GeoJSON [lon, lat]
        p = float(r["proposed_units"]) if r.get("proposed_units") not in (None, "") else 0.0
        e = float(r["existing_units"]) if r.get("existing_units") not in (None, "") else 0.0
        du = p - e
        in_true = dist_true_m(lat, lon, plat, plon) <= RING_RADIUS_M
        in_swapped = dist_pipeline_m(lat, lon, plat, plon) <= RING_RADIUS_M
        if in_true:
            true_disk["n_permits"] += 1
            true_disk["units"] += du
        if in_swapped:
            swapped["n_permits"] += 1
            swapped["units"] += du
        if in_true != in_swapped and abs(du) > 5:
            disagreements.append({
                "permit": pn, "units_delta": du,
                "true_dist_m": round(dist_true_m(lat, lon, plat, plon)),
                "in_true_500m_disk": in_true,
            })
    disagreements.sort(key=lambda d: -abs(d["units_delta"]))
    return {"true": true_disk, "swapped": swapped, "disagreements": disagreements[:5]}


# --------------------------------------------------------------------------------
# comparison helpers
# --------------------------------------------------------------------------------
def pct_change(last: float, prior: float) -> float | None:
    """Pipeline definition: (last-prior)/prior, undefined when prior == 0."""
    return (last - prior) / prior if prior else None


def rel_delta_pct(independent: float, expected: float) -> float | None:
    if expected == 0:
        return None
    return round(100.0 * (independent - expected) / expected, 2)


def direction_of(pct: float | None) -> str:
    if pct is None:
        return "undefined"
    return "increase" if pct > 0 else ("decrease" if pct < 0 else "flat")


def rank_table(last: dict[str, float], prior: dict[str, float],
               *, rankable_floor: int = MIN_EVENTS) -> dict[str, dict]:
    """Replicates the trajectory table: per-area last12/prior12/pct_change plus the
    'rankable' volume floor (last12 + prior12 >= MIN_EVENTS) used for rank questions."""
    table: dict[str, dict] = {}
    for hood in sorted(set(last) | set(prior)):
        l, p = float(last.get(hood, 0)), float(prior.get(hood, 0))
        table[hood] = {
            "last12": l, "prior12": p, "pct_change": pct_change(l, p),
            "rankable": (l + p) >= rankable_floor,
        }
    return table


def winner_by_pct(table: dict[str, dict], *, reverse: bool) -> list[tuple[str, float]]:
    """Rankable areas with defined pct_change, best first."""
    rows = [(h, r["pct_change"]) for h, r in table.items()
            if r["rankable"] and r["pct_change"] is not None]
    rows.sort(key=lambda x: x[1], reverse=reverse)
    return rows


# --------------------------------------------------------------------------------
# main verification
# --------------------------------------------------------------------------------
def verify() -> dict:
    bench = json.loads(BENCHMARK_PATH.read_text())
    questions = bench["questions"]

    print("Fetching server-side aggregates from data.sfgov.org ...", flush=True)
    permits_w = {w: fetch_permits_by_hood(win) for w, win in
                 [("last12", LAST12), ("prior12", PRIOR12)]}
    crime_w = {w: fetch_crime_by_hood_cat(win) for w, win in
               [("last12", LAST12), ("prior12", PRIOR12), ("fy24", FY24)]}
    biz_w = {w: fetch_biz_openings_by_hood(win) for w, win in
             [("last12", LAST12), ("prior12", PRIOR12)]}
    evic_w = {w: fetch_evictions_by_hood(win) for w, win in
              [("last12", LAST12), ("prior12", PRIOR12), ("fy24", FY24)]}
    c311_w = {w: fetch_311_by_hood_cat(win) for w, win in
              [("last12", LAST12), ("prior12", PRIOR12)]}
    noise_w = {w: fetch_311_noise_subtypes(win) for w, win in
               [("last12", LAST12), ("prior12", PRIOR12)]}
    active_biz = fetch_active_biz_by_hood()
    units_rolling = fetch_units_rolling_by_hood()

    # derived per-neighborhood tables in trajectory form -----------------------------
    tables: dict[str, dict[str, dict]] = {}
    tables["permits_issued"] = rank_table(
        {h: v["n"] for h, v in permits_w["last12"].items()},
        {h: v["n"] for h, v in permits_w["prior12"].items()})
    tables["units_approved_net"] = rank_table(
        {h: v["units"] for h, v in permits_w["last12"].items()},
        {h: v["units"] for h, v in permits_w["prior12"].items()})
    tables["biz_openings"] = rank_table(biz_w["last12"], biz_w["prior12"])
    tables["evictions_filed"] = rank_table(evic_w["last12"], evic_w["prior12"])
    tables["crime_victim_reported"] = rank_table(
        {h: crime_sums(c)["victim"] for h, c in crime_w["last12"].items()},
        {h: crime_sums(c)["victim"] for h, c in crime_w["prior12"].items()})
    tables["threeoneone_encampment"] = rank_table(
        {h: sum(n for c, n in cats.items() if "encampment" in c.lower())
         for h, cats in c311_w["last12"].items()},
        {h: sum(n for c, n in cats.items() if "encampment" in c.lower())
         for h, cats in c311_w["prior12"].items()})

    # fiscal-year tables for the temporal block
    fy_crime_victim = {
        "fy24": {h: crime_sums(c)["victim"] for h, c in crime_w["fy24"].items()},
        "fy25": {h: crime_sums(c)["victim"] for h, c in crime_w["prior12"].items()},
    }
    fy_evictions = {"fy24": evic_w["fy24"], "fy25": evic_w["prior12"]}

    superlative_order = {  # metric -> best = highest or lowest pct (from the generator)
        "biz_openings": True, "crime_victim_reported": False,
        "permits_issued": True, "evictions_filed": True,
    }

    per_question: list[dict] = []
    for q in questions:
        rec = {
            "id": q["id"], "type": q["type"], "metric": q["metric"], "area": q["area"],
            "expected": q["expected"], "independent_value": None,
            "delta_pct": None, "match": None, "verdict": None, "detail": {},
        }
        qtype, metric, area = q["type"], q["metric"], q["area"]

        # ---- direction (incl. q042's victim-vs-enforcement variant) ----------------
        if qtype == "direction":
            row = tables[metric].get(area)
            if row is None:
                rec["verdict"] = "not_verified"
                rec["detail"]["reason"] = f"area {area!r} absent from live {metric} aggregation"
            else:
                ipct = row["pct_change"]
                rec["independent_value"] = {
                    "last_12mo": row["last12"], "prior_12mo": row["prior12"],
                    "pct_change": None if ipct is None else round(ipct, 3),
                }
                rec["match"] = direction_of(ipct) == q["expected"]
                rec["verdict"] = "confirmed" if rec["match"] else "mismatch"
                gt = q.get("ground_truth", {})
                if "last_12mo" in gt:
                    rec["detail"]["delta_last12_pct"] = rel_delta_pct(row["last12"], gt["last_12mo"])
                    rec["detail"]["delta_prior12_pct"] = rel_delta_pct(row["prior12"], gt["prior_12mo"])
                if area == "Tenderloin" and metric == "crime_victim_reported":
                    # trap variant: reproduce the three-way decomposition
                    decomp = {}
                    for name in ("total", "victim", "enforcement"):
                        l = crime_sums(crime_w["last12"].get(area, {}))[name]
                        p = crime_sums(crime_w["prior12"].get(area, {}))[name]
                        decomp[name] = round(pct_change(l, p), 3) if p else None
                    rec["detail"]["decomposition_pct_change"] = decomp
                    rec["detail"]["artifact_reproduced"] = bool(
                        decomp["victim"] is not None and decomp["victim"] < 0
                        and decomp["total"] is not None and decomp["total"] > 0
                        and decomp["enforcement"] is not None and decomp["enforcement"] > 0
                    )

        # ---- temporal ---------------------------------------------------------------
        elif qtype == "temporal":
            fy = fy_crime_victim if metric == "crime_victim_reported" else fy_evictions
            y1, y2 = float(fy["fy24"].get(area, 0)), float(fy["fy25"].get(area, 0))
            ipct = pct_change(y2, y1)
            rec["independent_value"] = {
                "jul23_jun24": y1, "jul24_jun25": y2,
                "pct_change": None if ipct is None else round(ipct, 3),
            }
            rec["match"] = direction_of(ipct) == q["expected"]
            rec["verdict"] = "confirmed" if rec["match"] else "mismatch"
            gt = q.get("ground_truth", {})
            rec["detail"]["delta_y1_pct"] = rel_delta_pct(y1, gt["jul23_jun24"])
            rec["detail"]["delta_y2_pct"] = rel_delta_pct(y2, gt["jul24_jun25"])

        # ---- superlative ------------------------------------------------------------
        elif qtype == "superlative":
            if metric == "units_approved_net":
                # generator ranked by absolute last12 units, no rankable floor
                ranking = sorted(
                    ((h, r["last12"]) for h, r in tables[metric].items()),
                    key=lambda x: x[1], reverse=True)
            else:
                ranking = winner_by_pct(tables[metric], reverse=superlative_order[metric])
            top = ranking[:5]
            winner, winner_val = top[0]
            rec["independent_value"] = winner
            rec["match"] = winner == q["expected"]
            rec["detail"]["top5"] = [(h, round(v, 3)) for h, v in top]
            exp_pos = next((i for i, (h, _) in enumerate(ranking) if h == q["expected"]), None)
            if rec["match"]:
                rec["verdict"] = "confirmed"
            elif exp_pos is not None and exp_pos < SUPERLATIVE_DRIFT_TOPK:
                exp_val = ranking[exp_pos][1]
                margin = abs(winner_val - exp_val)
                close = (margin <= SUPERLATIVE_DRIFT_MARGIN if metric != "units_approved_net"
                         else margin <= 0.05 * abs(winner_val))
                rec["verdict"] = "drift" if close else "mismatch"
                rec["detail"]["expected_rank"] = exp_pos + 1
                rec["detail"]["margin"] = round(margin, 3)
            else:
                rec["verdict"] = "mismatch"
                rec["detail"]["expected_rank"] = None if exp_pos is None else exp_pos + 1

        # ---- pairwise ---------------------------------------------------------------
        elif qtype == "pairwise":
            a, b = q["areas"]
            vals = {}
            for hood in (a, b):
                row = tables[metric].get(hood, {"pct_change": None})
                vals[hood] = None if row["pct_change"] is None else round(row["pct_change"], 3)
            if vals[a] is None or vals[b] is None:
                rec["verdict"] = "not_verified"
                rec["detail"]["reason"] = f"pct_change undefined for one area: {vals}"
            else:
                winner = a if vals[a] > vals[b] else b
                rec["independent_value"] = winner
                rec["detail"]["pct_changes"] = vals
                rec["match"] = winner == q["expected"]
                if rec["match"]:
                    rec["verdict"] = "confirmed"
                else:
                    rec["verdict"] = ("drift" if abs(vals[a] - vals[b]) < PAIRWISE_DRIFT_GAP
                                      else "mismatch")

        # ---- numeric ----------------------------------------------------------------
        elif qtype == "numeric":
            if metric == "units_approved_net":
                entry = units_rolling.get(area)
                value = None if entry is None else entry["units"]
                rec["detail"]["window"] = f"issued {ROLL12_START}..{SNAPSHOT_AS_OF} (rolling, snapshot-capped)"
            else:  # active_businesses
                value = active_biz.get(area)
                rec["detail"]["note"] = ("current-state attribute; live registry churn since "
                                         f"the {SNAPSHOT_AS_OF} snapshot is expected drift")
            if value is None:
                rec["verdict"] = "not_verified"
                rec["detail"]["reason"] = f"area {area!r} absent from live aggregation"
            else:
                rec["independent_value"] = value
                rec["delta_pct"] = rel_delta_pct(value, q["expected"])
                tol = q["tolerance_pct"]
                adp = abs(rec["delta_pct"]) if rec["delta_pct"] is not None else float("inf")
                rec["verdict"] = ("confirmed" if adp <= tol
                                  else "drift" if adp <= tol * NUMERIC_DRIFT_FACTOR
                                  else "mismatch")

        # ---- address_forward ----------------------------------------------------------
        elif qtype == "address_forward":
            pt = geocode(area)
            if pt is None:
                rec["verdict"] = "not_verified"
                rec["detail"]["reason"] = "Census geocoder returned no match for the address"
            else:
                summary = ring_summary(fetch_ring_candidates(*pt), *pt)
                # verdict from the TRUE 500 m geodesic disk (the question's stated
                # semantics); the pipeline-formula replication below documents why
                # the frozen value differs where it does (see module docstring)
                value = summary["true"]["units"]
                rec["independent_value"] = value
                rec["delta_pct"] = rel_delta_pct(value, q["expected"])
                rec["detail"].update({
                    "geocode": {"lat": pt[0], "lon": pt[1]},
                    "window": f"issued {ROLL24_START}..{SNAPSHOT_AS_OF}, {RING_RADIUS_M} m ring",
                    "true_500m_disk": summary["true"],
                    "n_permits_expected": q["ground_truth"]["n_permits"],
                    "pipeline_formula_replication": {
                        **summary["swapped"],
                        "note": "swapped-axis haversine replicating the generator's "
                                "ST_Distance_Sphere(ST_Point(lon,lat),...) call; "
                                "reproduces the frozen expected value, showing the "
                                "frozen ring was ~395m E-W x ~933m N-S, not a 500m disk",
                    },
                    "geometry_disagreements_gt5_units": summary["disagreements"],
                })
                tol = q["tolerance_pct"]
                adp = abs(rec["delta_pct"]) if rec["delta_pct"] is not None else float("inf")
                rec["verdict"] = ("confirmed" if adp <= tol
                                  else "drift" if adp <= tol * NUMERIC_DRIFT_FACTOR
                                  else "mismatch")
                if rec["verdict"] == "mismatch":
                    rec["detail"]["diagnosis"] = (
                        "expected value encodes the distorted ring, not the stated "
                        "500 m: the pipeline-formula replication above matches it; "
                        "the largest disagreeing permits are listed"
                    )

        # ---- trap (311 noise artifact) --------------------------------------------------
        elif qtype == "trap":
            nom = {w: sum(sub.values()) for w, sub in noise_w.items()}
            ref = {w: sum(n for (_, s), n in sub.items() if s != NOISE_CATCHALL_SUBTYPE)
                   for w, sub in noise_w.items()}
            pct_nom = pct_change(nom["last12"], nom["prior12"])
            pct_ref = pct_change(ref["last12"], ref["prior12"])
            rec["independent_value"] = {
                "noise_complaints_last12": nom["last12"], "prior12": nom["prior12"],
                "pct_change_nominal": round(pct_nom, 3),
                "pct_change_refined_excl_catchall": round(pct_ref, 3),
            }
            gt = q["ground_truth"]
            rec["detail"]["delta_last12_pct"] = rel_delta_pct(nom["last12"], gt["noise_complaints_last12"])
            rec["detail"]["delta_prior12_pct"] = rel_delta_pct(nom["prior12"], gt["prior12"])
            catchall_last = sum(n for (_, s), n in noise_w["last12"].items()
                                if s == NOISE_CATCHALL_SUBTYPE)
            rec["detail"]["catchall_subtype"] = NOISE_CATCHALL_SUBTYPE
            rec["detail"]["catchall_share_of_last12"] = round(catchall_last / nom["last12"], 3)
            # artifact reproduced <=> nominal still shows the big rise while the refined
            # series (excluding the catch-all bucket) rises far less
            reproduced = (pct_nom >= TRAP_NOMINAL_MIN
                          and pct_ref <= TRAP_REFINED_MAX
                          and (pct_nom - pct_ref) >= TRAP_DECOMP_GAP)
            rec["match"] = reproduced
            rec["verdict"] = "confirmed" if reproduced else "mismatch"

        else:
            rec["verdict"] = "not_verified"
            rec["detail"]["reason"] = f"unknown question type {qtype!r}"

        per_question.append(rec)

    summary = {"confirmed": 0, "drift": 0, "mismatch": 0, "not_verified": 0}
    for rec in per_question:
        summary[rec["verdict"]] += 1

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method_note": (
            "Independent re-derivation of every benchmark_v1 expected answer directly from "
            "live DataSF SODA endpoints (permits i98e-djp9, businesses g8m3-pdis, police "
            "incidents wg3w-h783, evictions 5cei-gny5, 311 vw6y-z8j6), using server-side "
            "SoQL aggregation and the city's own Analysis Neighborhood columns -- zero "
            "Canary pipeline code imported. Windows: last12=[2025-07-01,2026-07-01), "
            "prior12=[2024-07-01,2025-07-01), jul23_jun24=[2023-07-01,2024-07-01); the "
            "numeric net-units block and 500 m address rings use the generator's rolling "
            "windows (issued_date >= 2025-07-25 resp. 2024-07-25, generation-day "
            "current_date was 2026-07-25 PDT) capped at the frozen snapshot's as_of "
            "2026-07-24. Semantics replicated as constants: permit issuance = non-null "
            "issued_date (no status filter); net units = sum(proposed_units - "
            "existing_units, nulls as 0, Socrata ::number casts); business openings keyed "
            "on location_start_date; active businesses = location_start_date set AND "
            "location_end_date null (uncappable current-state attribute); crime split into "
            "victim-reported vs enforcement-driven by exact incident_category sets "
            "(enforcement activity is not victimization); 311 encampment/noise by "
            "case-insensitive substring on Category, refined noise excluding the "
            "'other_excessive_noise' Request Type catch-all; address rings geocoded with "
            "the public US Census geocoder and evaluated on the TRUE 500 m geodesic disk "
            "(haversine on each permit's own coordinates), deduped by permit_number. "
            "RING-GEOMETRY FINDING: the generator's rings were not true 500 m disks -- "
            "its DuckDB ST_Distance_Sphere call passed ST_Point(lon,lat) where the "
            "function expects x=latitude (EPSG:4326 authority axis order), yielding "
            "~395 m E-W x ~933 m N-S regions (plus an H3 k=2 clip); a pure-Python "
            "replication of that swapped-axis formula reproduces the frozen unit totals "
            "(494/43/53) and is reported per ring question alongside the true-disk "
            "verdict value, which is never adjusted to force agreement. "
            "The live API has moved past the frozen snapshot "
            "(append-mostly public records), so small count deltas are expected and are "
            "quantified per question; verdicts: confirmed (within tolerance / same sign / "
            "same winner / artifact reproduced), drift (small live-data movement: numeric "
            "within 1.5x tolerance, superlative expected still top-3 within 0.05 of the "
            "winner, pairwise gap < 0.02), mismatch (real disagreement, reported as-is), "
            "not_verified (not derivable from the public API alone). Raw API responses "
            "cached under data/processed/verification_cache/."
        ),
        "per_question": per_question,
        "summary": summary,
    }


def print_table(report: dict) -> None:
    print(f"\n{'id':<6}{'type':<16}{'metric':<26}{'area':<34}{'expected':<22}"
          f"{'independent':<22}{'delta/match':<14}{'verdict'}")
    print("-" * 148)
    for r in report["per_question"]:
        iv = r["independent_value"]
        if isinstance(iv, dict):
            iv_s = str(iv.get("pct_change", iv.get("pct_change_nominal", "")))
            iv_s = f"pct {iv_s}"
        elif isinstance(iv, float):
            iv_s = f"{iv:g}"
        else:
            iv_s = str(iv)
        dm = (f"{r['delta_pct']:+.1f}%" if r["delta_pct"] is not None
              else ("match" if r["match"] else "MISMATCH") if r["match"] is not None else "—")
        print(f"{r['id']:<6}{r['type']:<16}{r['metric']:<26}{str(r['area'])[:32]:<34}"
              f"{str(r['expected'])[:20]:<22}{iv_s[:20]:<22}{dm:<14}{r['verdict']}")
    s = report["summary"]
    print("-" * 148)
    print(f"summary: confirmed={s['confirmed']}  drift={s['drift']}  "
          f"mismatch={s['mismatch']}  not_verified={s['not_verified']}  "
          f"(of {len(report['per_question'])})")


def main() -> None:
    report = verify()
    OUT_PATH.write_text(json.dumps(report, indent=1))
    print_table(report)
    print(f"\nlive API requests this run: {_uncached_calls} (rest served from cache)")
    print(f"report -> {OUT_PATH.relative_to(BACKEND_DIR)}")


if __name__ == "__main__":
    sys.exit(main())
