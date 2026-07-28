#!/usr/bin/env python
"""Independent verification of benchmark_v2.json against live DataSF Socrata (SODA) APIs.

PURPOSE (freeze-time verification, PROTOCOL_V2.md §6): re-derive every expected answer
of the FROZEN 137-question benchmark (data/processed/benchmark_v2.json, committed at
fbd6166 BEFORE any model query) DIRECTLY from San Francisco's public open-data APIs,
importing NOTHING from the Canary pipeline (app/*). A reviewer can read this one file,
see every semantic choice inline with its justification, run it, and check the
benchmark's answers against the city's own records without trusting any Canary code.
Allowed imports: Python stdlib + requests. Aggregation is done server-side by the
city's SODA endpoints (SoQL $select/$where/$group) wherever possible; the only
client-side math is set membership, substring matching, ratios, ranking, and a
per-permit dedupe for the address rings.

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
this check does not depend on Canary's H3 spine.

TIME WINDOWS (re-derived from the pipeline definitions, not imported):
  benchmark_v2 was generated 2026-07-28T14:50:54Z on a machine in America/Los_Angeles
  (= 2026-07-28 07:50 PDT), from snapshots with source_as_of:
      permits / crime / 311   2026-07-24   (only snapshot staged for each)
      businesses / evictions  2026-07-25   (latest staged snapshot)
  DuckDB's current_date follows the local timezone, so at generation
  current_date = 2026-07-28.
  - Trajectory windows (direction / superlative / pairwise / trap / the numeric
    count block) anchor at date_trunc('month', current_date) = 2026-07-01, and the
    pipeline's metrics grid keeps only complete past months, therefore (UNCHANGED
    from v1):
        last12  = [2025-07-01, 2026-07-01)
        prior12 = [2024-07-01, 2025-07-01)
  - Temporal questions compare fiscal-style years:
        jul23_jun24 = [2023-07-01, 2024-07-01)
        jul24_jun25 = [2024-07-01, 2025-07-01)   (identical to prior12)
  - The numeric net-units block and the address rings use ROLLING windows over raw
    permit events (no month clip): issued_date >= current_date - 12 (resp. 24)
    months, i.e. issued_date >= 2025-07-28 (resp. 2024-07-28), bounded above only by
    what the 2026-07-24 permits snapshot contained. To reproduce that bound against
    the live (moving) API, those rolling windows are capped at
    issued_date <= 2026-07-24T23:59:59.
  - Month-clipped windows end 2026-06-30 < snapshot dates, so no cap is needed there;
    any divergence is late-arriving/revised rows in the live API ("drift").

ADDRESS-RING GEOMETRY (v2): the v1 verification uncovered that the v1 generator's
rings were not true 500 m disks (DuckDB ST_Distance_Sphere axis-order erratum:
ST_Point(lon, lat) where the function expects x = latitude). The v2 generator FIXED
this: it calls ST_Distance_Sphere(ST_Point(p.lat, p.lon), ST_Point(lat, lon)) and
runs a geometry self-test (two known point pairs within 1%) before generating.
Therefore the TRUE geodesic 500 m disk computed here (haversine, R = 6371008.8 m, on
each permit's own coordinates) should now match the frozen values directly -- that
agreement is itself the regression check on the v1 erratum. The generator also
prefilters candidates with an H3 res-9 k=2 grid-disk JOIN; a k=2 disk at res 9
(hexagon inradius ~150 m; guaranteed containment radius from any point of the center
cell ~(5*inradius - circumradius) ~ 580 m) fully contains a 500 m circle, so the
prefilter cannot exclude a permit inside the true disk and is ignored here. If a
ring mismatches anyway, permits near the 500 m boundary (490-510 m) are listed so a
clip/rounding cause can be pinpointed. RING DEDUPE SUBTLETY (matters at 2675 Geary
Blvd): some permits carry multiple rows with different location points; the
generator's ring predicate (WHERE) runs before its dedupe (QUALIFY), so a permit is
in the ring iff ANY of its rows is inside the disk -- replicated here via each
permit's minimum distance across rows (see ring_summary).

METRIC SEMANTICS (copied as constants from app/pipeline/build.py + stage.py, with the
column renames resolved back to the SODA API field names; justification inline below):
  permits_issued          count of permit rows with a non-null issued_date in window.
                          NO status filter: the pipeline treats the presence of the
                          city's Issued Date as the issuance event itself.
  units_approved_net      sum(coalesce(proposed_units,0) - coalesce(existing_units,0))
                          over the same permit-issued rows. Socrata stores the unit
                          columns as text, so SoQL casts them with ::number (a failed
                          cast becomes null, matching the pipeline's try_cast).
  permit_cost_issued_usd  sum(coalesce(revised_cost, estimated_cost)) over the same
                          permit-issued rows (build.py: value = coalesce(revised,
                          estimated) on the permit_issued event; sum ignores nulls).
                          Both cost columns are text in Socrata -> ::number casts.
                          Verified exact: FiDi last12 cost reproduces the frozen
                          886,006,640 to the dollar.
  biz_openings            count of registry rows by LOCATION start date
                          (location_start_date, NOT dba_start_date -- the pipeline's
                          place-open event is the location's own start date).
  biz_closings            count of registry rows with location_end_date in window AND
                          location_start_date IS NOT NULL (the pipeline's `places`
                          table only admits rows with a start date). IMPORTANT
                          AS-FROZEN SEMANTICS FINDING: build.py *intends* to exclude
                          administrative closures (flag='administrative'), but the
                          stager maps the export's "Administratively Closed" text
                          ("***Administratively Closed") through
                          lower(x) IN ('true','yes','y','1'), which never matches, so
                          administratively_closed = FALSE on every staged row
                          (verified: all 364,420 rows in the 2026-07-25 parquet) and
                          the exclusion was a NO-OP in the frozen build. The frozen
                          biz_closings numbers therefore INCLUDE administrative
                          closures; this script replicates that (no exclusion) for
                          the verdicts, and separately reports the intended-semantics
                          variant (administratively_closed IS NULL in SODA, where the
                          flag is "***Administratively Closed" or null) as a
                          diagnostic on every biz_closings question.
  active_businesses       count of registry rows with location_start_date IS NOT NULL
                          AND location_end_date IS NULL. Current-state attribute: it
                          cannot be capped at the snapshot date, so live churn since
                          2026-07-25 is expected drift.
  crime_*                 count of incident rows by incident_date (2018-present
                          dataset), classified by exact incident_category string
                          match against the frozensets below.
  evictions_filed         count of eviction-notice rows by file_date.
  threeoneone_*           count of 311 cases by requested_datetime ("Opened");
                          encampment  = Category (service_name) contains 'encampment'
                                        case-insensitively (build.py ILIKE '%noise%'
                                        analog);
                          cleaning    = service_name = 'Street and Sidewalk Cleaning'
                                        EXACTLY (build.py: detail = 'Street and
                                        Sidewalk Cleaning'; discovery query on the
                                        live dataset confirms that is the only
                                        service_name containing clean/sweep in the
                                        last-12 window);
                          noise       = service_name contains 'noise'
                                        case-insensitively;
                          noise_specific excludes rows whose Request Type
                                        (service_subtype) == 'other_excessive_noise'
                                        (the catch-all inflated by a Mar-2026 mobile
                                        app flow change -- trap q133).

CRIME CATEGORY SPLIT (inlined from app/pipeline/crime_categories.py): police incident
counts mix (a) crimes a member of the public reports being a victim of, and (b)
incidents that exist because police proactively acted (stops, warrants, drug/weapon
possession discovered via searches, sit-lie sweeps). A surge in (b) measures a
crackdown, not more victimization -- so the benchmark's user-facing crime trend is
VICTIM_REPORTED only, ENFORCEMENT_DRIVEN is tracked separately (and is itself the
metric of superlative q051 and part of the trap decompositions), and categories in
neither set count only toward the unsplit crime_incidents total. Matching is exact
and case-sensitive, as in the pipeline (the lists include the dataset's typo
variants).

TRAJECTORY RANKING RULES (re-derived from app/pipeline/trajectory.py + generate_v2.py):
  pct_change  = (last12 - prior12) / prior12, defined only when prior12 > 0
                (trajectory.py: CASE WHEN prior12 > 0; matters for units_approved_net,
                which can have negative window sums)
  rankable    = (last12 + prior12) >= 24
  rise/drop superlatives rank rankable areas with defined pct_change by pct_change
  (desc/asc); 'most' superlatives rank ALL areas by last12 level (the generator's
  'most' query has no rankable floor -- last12 is never NULL in trajectory, it is
  coalesced to 0). v2 additionally records the RUNNER-UP: this script verifies both
  that the expected winner is #1 and that the recorded runner_up is #2 under the
  same rules.
  Superlative mode is inferred from the frozen record itself: ground_truth containing
  'last_12mo' -> 'most'; otherwise the question wording ('decline'/'decrease'/'drop'
  -> ascending, else descending). The wordings come verbatim from the generator's
  SUPERLATIVES table, so this inference is exact.

VERDICTS per question:
  confirmed     numeric/address: |delta| <= the question's tolerance_pct;
                direction/temporal: independently derived change has the expected sign;
                superlative: same #1 AND same #2; pairwise: same winning area;
                trap: every embedded number within 2% AND the trap's mechanism
                reproduces (signs/thresholds below).
  drift         small mismatch plausibly explained by the live API having moved past
                the frozen 2026-07-24/25 snapshots (public records are append-mostly):
                numeric within 1.5x tolerance; superlative where the expected winner
                is still top-3 within 0.05 pct-points of the live winner (or 5% of the
                winner for level questions) -- or winner correct but the recorded
                runner-up displaced by a within-margin live movement; pairwise where
                the flipped gap is < 0.02; trap where the mechanism reproduces but
                some embedded number moved 2-10%.
  mismatch      real disagreement (never forced into agreement -- documented as-is).
  documentary   the claim is source-documentation, not a computation (q136 Prop 13:
                the Assessor dataset's own notes say assessed value is capped by
                Prop 13 and is not market price; there is no number to re-derive).
  not_verified  cannot be re-derived from the public API alone (reason given).

CACHING: every HTTP response is cached under data/processed/verification_cache/ keyed
by a hash of the full URL, so re-runs are cheap and deterministic. Delete that
directory to force fresh pulls.

Usage:
    venv/bin/python scripts/verify_v2_answers.py
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
BENCHMARK_PATH = BACKEND_DIR / "data" / "processed" / "benchmark_v2.json"
CACHE_DIR = BACKEND_DIR / "data" / "processed" / "verification_cache"
OUT_PATH = BACKEND_DIR / "data" / "processed" / "benchmark_v2_verification.json"

# --------------------------------------------------------------------------------
# endpoints and field names (field names verified against each dataset's Socrata
# view metadata, /api/views/<id>.json, on 2026-07-28)
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
PERMITS_AS_OF = "2026-07-24"          # source_as_of of the frozen permits/crime/311 snapshots
REGBIZ_AS_OF = "2026-07-25"           # source_as_of of the frozen businesses/evictions snapshots
LAST12 = ("2025-07-01", "2026-07-01") # trailing 12 complete months
PRIOR12 = ("2024-07-01", "2025-07-01")# the 12 before (== jul24_jun25)
FY24 = ("2023-07-01", "2024-07-01")   # jul23_jun24 (temporal questions)
ROLL12_START = "2025-07-28"           # current_date(2026-07-28) - 12 months
ROLL24_START = "2024-07-28"           # current_date(2026-07-28) - 24 months
PERMITS_CAP = "2026-07-24T23:59:59"   # upper cap replicating the permits snapshot end
RING_RADIUS_M = 500

MIN_EVENTS = 24  # trajectory "rankable" volume floor: last12 + prior12 >= 24 events

# verdict thresholds (documented in the docstring)
NUMERIC_DRIFT_FACTOR = 1.5          # outside tolerance but within 1.5x tolerance -> drift
SUPERLATIVE_DRIFT_MARGIN = 0.05     # pct-points between winner and expected -> drift
SUPERLATIVE_LEVEL_DRIFT = 0.05      # 5% of the winner's level, for 'most' questions
SUPERLATIVE_DRIFT_TOPK = 3          # expected must still rank this high for drift
PAIRWISE_DRIFT_GAP = 0.02           # pct-points gap below which a flipped pair is drift
TRAP_NUM_CONFIRM = 2.0              # every embedded trap number within this % -> confirmed
TRAP_NUM_DRIFT = 10.0               # within this % (mechanism intact) -> drift
TRAP_NOMINAL_MIN = 0.50             # q133: nominal noise rise must still look like "over 60%"
TRAP_REFINED_MAX = 0.35             # q133: refined metric must be well below the nominal rise
TRAP_DECOMP_GAP = 0.15              # q133: nominal - refined must exceed this

# --------------------------------------------------------------------------------
# crime category split, inlined verbatim from app/pipeline/crime_categories.py.
# Rationale: enforcement activity is not victimization -- counting police-initiated
# incidents (stops, warrants, possession discovered by search, sit-lie sweeps) as
# "crime" makes a crackdown look like a crime wave. The benchmark's crime trend
# questions are defined over VICTIM_REPORTED categories only; ENFORCEMENT_DRIVEN is
# its own metric (superlative q051, trap decompositions); categories in neither set
# count only toward the unsplit crime_incidents total.
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

# 311 catch-all Request Type excluded by the refined noise metric (trap q133): a
# March-2026 mobile-app flow change funnels reports into this bucket, a reporting
# artifact rather than a change in conditions. Exact, case-sensitive value as it
# appears in the dataset's service_subtype column.
NOISE_CATCHALL_SUBTYPE = "other_excessive_noise"

# build.py: threeoneone_cleaning counts events with detail = 'Street and Sidewalk
# Cleaning' (exact equality on the 311 Category / SODA service_name). A live
# discovery query (service_name containing 'clean' or 'sweep', last-12 window)
# returns exactly one value: 'Street and Sidewalk Cleaning' -- so exact equality and
# substring agree on this dataset; equality is used to mirror the pipeline.
CLEANING_CATEGORY = "Street and Sidewalk Cleaning"

# SODA value of the registry's "Administratively Closed" flag (used only for the
# intended-semantics diagnostic; the as-frozen metric ignores the flag entirely --
# see the biz_closings entry in the module docstring).
ADMIN_CLOSED_VALUE = "***Administratively Closed"


# --------------------------------------------------------------------------------
# HTTP with on-disk cache
# --------------------------------------------------------------------------------
_session = requests.Session()
_session.headers["User-Agent"] = "canary-benchmark-independent-verification/2.0"
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
    """Per-neighborhood permit_issued count, net units and issued cost, one
    server-side groupby.

    sum() ignores nulls, so sum(proposed) - sum(existing) equals the pipeline's
    sum(coalesce(proposed,0) - coalesce(existing,0)); and
    sum(coalesce(revised_cost, estimated_cost)) matches build.py's
    value = coalesce(revised_cost, estimated_cost) summed over issued permits
    (rows where both are null contribute nothing to either formulation).
    """
    rows = soda(
        PERMITS,
        **{
            "$select": f"{HOOD_PERMITS} as hood, count(*) as n, "
                       "sum(proposed_units::number) as p, sum(existing_units::number) as e, "
                       "sum(coalesce(revised_cost::number, estimated_cost::number)) as cost",
            "$where": f"{window_where('issued_date', *window)} AND {HOOD_PERMITS} IS NOT NULL",
            "$group": "hood",
        },
    )
    return {
        r["hood"]: {
            "n": int(r["n"]),
            "units": float(r.get("p") or 0) - float(r.get("e") or 0),
            "cost": float(r.get("cost") or 0),
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


def fetch_biz_closings_by_hood(window: tuple[str, str]) -> dict[str, dict]:
    """Closings = location_end_date in window AND location_start_date IS NOT NULL
    (the pipeline's `places` table only admits rows with a start date).

    AS-FROZEN semantics: NO administrative-closure exclusion (the stager's truthy
    check never matched the export's '***Administratively Closed' value, so the
    frozen build excluded nothing -- see module docstring). `n` is the as-frozen
    count used for all verdicts; `admin` counts the rows the pipeline INTENDED to
    exclude, reported as a diagnostic (`n - admin` = intended-semantics count).
    """
    rows = soda(
        REGBIZ,
        **{
            "$select": f"{HOOD_REGBIZ} as hood, count(*) as n, "
                       f"sum(case(administratively_closed IS NOT NULL, 1, true, 0)) as adm",
            "$where": f"{window_where('location_end_date', *window)} "
                      f"AND location_start_date IS NOT NULL AND {HOOD_REGBIZ} IS NOT NULL",
            "$group": "hood",
        },
    )
    return {r["hood"]: {"n": int(r["n"]), "admin": int(float(r.get("adm") or 0))} for r in rows}


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
    (the trap's ground truth sums neighborhood-level trajectory rows, which requires
    a non-null Analysis Neighborhood)."""
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
    issued_date in [2025-07-28, permits-snapshot end 2026-07-24]."""
    rows = soda(
        PERMITS,
        **{
            "$select": f"{HOOD_PERMITS} as hood, count(*) as n, "
                       "sum(proposed_units::number) as p, sum(existing_units::number) as e",
            "$where": f"issued_date >= '{ROLL12_START}T00:00:00' AND issued_date <= '{PERMITS_CAP}' "
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
    (a strict superset of the 500 m disk). The exact 500 m membership is then
    computed client-side from each permit's own coordinates, so the final number
    does not depend on Socrata's within_circle boundary behavior."""
    return soda(
        PERMITS,
        **{
            "$select": "permit_number, issued_date, proposed_units, existing_units, location",
            "$where": f"within_circle(location, {lat}, {lon}, 1000) "
                      f"AND issued_date >= '{ROLL24_START}T00:00:00' AND issued_date <= '{PERMITS_CAP}'",
            "$limit": "50000",
        },
    )


_EARTH_R = 6_371_008.8  # mean Earth radius, meters (matches the generator's haversine)


def dist_true_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Correct geodesic (haversine) distance in meters."""
    phi1, lam1, phi2, lam2 = map(math.radians, (lat1, lon1, lat2, lon2))
    a = (math.sin((phi2 - phi1) / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin((lam2 - lam1) / 2) ** 2)
    return 2 * _EARTH_R * math.asin(math.sqrt(a))


def ring_summary(rows: list[dict], lat: float, lon: float) -> dict:
    """Sum coalesced unit deltas over the TRUE 500 m geodesic disk, one count per
    permit_number -- in v2 this is also the generator's formula (axis-order fixed +
    self-tested), so it should reproduce the frozen values directly.

    DEDUPE ORDER MATTERS (found while diagnosing 2675 Geary Blvd): some permits
    appear as MULTIPLE rows with DIFFERENT location points (e.g. two address points
    of the same corner parcel, one inside and one outside the disk). The generator's
    SQL applies the ring predicate in WHERE and dedupes afterwards with QUALIFY
    row_number() = 1, so a permit belongs to the ring iff ANY of its rows falls
    inside the disk. Replicated here by taking each permit's MINIMUM distance across
    its rows (dedupe-first-then-test, as v1's ring code did, silently drops a permit
    whose arbitrary first row is the outside one). Unit values are identical across
    duplicate rows in practice; conflicting-unit duplicates are counted so any
    arbitrary-row indeterminacy is visible rather than silent.

    Permits whose min distance is within 10 m of the boundary are listed: DuckDB's
    ST_Distance_Sphere sphere radius can differ from our haversine by <0.2%, so only
    boundary-hugging permits could disagree between the two implementations."""
    by_pn: dict[str, list[dict]] = {}
    for r in rows:
        if r.get("location"):
            by_pn.setdefault(r["permit_number"], []).append(r)
    disk = {"n_permits": 0, "units": 0.0}
    borderline: list[dict] = []
    dup_conflicts = 0
    for pn, rr in by_pn.items():
        if len({(x.get("proposed_units"), x.get("existing_units")) for x in rr}) > 1:
            dup_conflicts += 1
        r0 = rr[0]
        p = float(r0["proposed_units"]) if r0.get("proposed_units") not in (None, "") else 0.0
        e = float(r0["existing_units"]) if r0.get("existing_units") not in (None, "") else 0.0
        du = p - e
        d = min(  # GeoJSON coordinates are [lon, lat]
            dist_true_m(lat, lon, float(x["location"]["coordinates"][1]),
                        float(x["location"]["coordinates"][0]))
            for x in rr)
        if d <= RING_RADIUS_M:
            disk["n_permits"] += 1
            disk["units"] += du
        if abs(d - RING_RADIUS_M) <= 10:
            borderline.append({"permit": pn, "dist_m": round(d, 1), "units_delta": du,
                               "inside": d <= RING_RADIUS_M})
    borderline.sort(key=lambda b: -abs(b["units_delta"]))
    return {"disk": disk, "borderline_490_510m": borderline[:8],
            "dup_permit_rows_with_conflicting_units": dup_conflicts}


# --------------------------------------------------------------------------------
# comparison helpers
# --------------------------------------------------------------------------------
def pct_change(last: float, prior: float) -> float | None:
    """Pipeline definition (trajectory.py): (last-prior)/prior, defined only when
    prior > 0 (strictly positive -- units_approved_net windows can be negative)."""
    return (last - prior) / prior if prior > 0 else None


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


def rank_by_pct(table: dict[str, dict], *, reverse: bool) -> list[tuple[str, float]]:
    """Rankable areas with defined pct_change, best first (generator's rise/drop query)."""
    rows = [(h, r["pct_change"]) for h, r in table.items()
            if r["rankable"] and r["pct_change"] is not None]
    rows.sort(key=lambda x: x[1], reverse=reverse)
    return rows


def rank_by_level(table: dict[str, dict]) -> list[tuple[str, float]]:
    """All areas by last12 level, biggest first (generator's 'most' query: no
    rankable floor; trajectory's last12 is coalesced to 0, never NULL)."""
    rows = [(h, r["last12"]) for h, r in table.items()]
    rows.sort(key=lambda x: -x[1])
    return rows


def trap_number_checks(pairs: list[tuple[str, float, float]]) -> tuple[list[dict], float]:
    """[(label, expected, live)] -> (per-number deltas, max |rel delta %|)."""
    checks, worst = [], 0.0
    for label, exp, live in pairs:
        d = rel_delta_pct(live, exp)
        checks.append({"name": label, "expected": exp, "live": live, "delta_pct": d})
        if d is not None:
            worst = max(worst, abs(d))
    return checks, worst


def trap_verdict(mechanism_ok: bool, worst_delta: float) -> str:
    if not mechanism_ok:
        return "mismatch"
    if worst_delta <= TRAP_NUM_CONFIRM:
        return "confirmed"
    if worst_delta <= TRAP_NUM_DRIFT:
        return "drift"
    return "mismatch"


# --------------------------------------------------------------------------------
# main verification
# --------------------------------------------------------------------------------
def verify() -> dict:
    bench = json.loads(BENCHMARK_PATH.read_text())
    questions = bench["questions"]

    print("Fetching server-side aggregates from data.sfgov.org ...", flush=True)
    # fy24 is fetched only for datasets with temporal questions in the frozen file:
    # permits (q129/q130), crime (q126), evictions (q121), 311 encampment (q117-128),
    # biz closings (q131). biz openings has no temporal question -> last12/prior12 only.
    permits_w = {w: fetch_permits_by_hood(win) for w, win in
                 [("last12", LAST12), ("prior12", PRIOR12), ("fy24", FY24)]}
    crime_w = {w: fetch_crime_by_hood_cat(win) for w, win in
               [("last12", LAST12), ("prior12", PRIOR12), ("fy24", FY24)]}
    bizopen_w = {w: fetch_biz_openings_by_hood(win) for w, win in
                 [("last12", LAST12), ("prior12", PRIOR12)]}
    bizclose_w = {w: fetch_biz_closings_by_hood(win) for w, win in
                  [("last12", LAST12), ("prior12", PRIOR12), ("fy24", FY24)]}
    evic_w = {w: fetch_evictions_by_hood(win) for w, win in
              [("last12", LAST12), ("prior12", PRIOR12), ("fy24", FY24)]}
    c311_w = {w: fetch_311_by_hood_cat(win) for w, win in
              [("last12", LAST12), ("prior12", PRIOR12), ("fy24", FY24)]}
    noise_w = {w: fetch_311_noise_subtypes(win) for w, win in
               [("last12", LAST12), ("prior12", PRIOR12)]}
    active_biz = fetch_active_biz_by_hood()
    units_rolling = fetch_units_rolling_by_hood()

    # rolling-window sanity anchor (see docstring): the frozen numeric block's
    # Nob Hill value is 1319; the live rolling window should reproduce it modulo
    # backfill drift. Printed, not asserted -- the per-question verdicts decide.
    nh = units_rolling.get("Nob Hill", {}).get("units")
    print(f"  [anchor] Nob Hill units issued [{ROLL12_START}..{PERMITS_AS_OF}] -> {nh} "
          f"(frozen numeric q052 expects 1319)")

    def sub_counts(cats_by_hood: dict[str, dict[str, int]], pred) -> dict[str, int]:
        return {h: sum(n for c, n in cats.items() if pred(c))
                for h, cats in cats_by_hood.items()}

    # derived per-neighborhood tables in trajectory form -----------------------------
    tables: dict[str, dict[str, dict]] = {}
    tables["permits_issued"] = rank_table(
        {h: v["n"] for h, v in permits_w["last12"].items()},
        {h: v["n"] for h, v in permits_w["prior12"].items()})
    tables["units_approved_net"] = rank_table(
        {h: v["units"] for h, v in permits_w["last12"].items()},
        {h: v["units"] for h, v in permits_w["prior12"].items()})
    tables["permit_cost_issued_usd"] = rank_table(
        {h: v["cost"] for h, v in permits_w["last12"].items()},
        {h: v["cost"] for h, v in permits_w["prior12"].items()})
    tables["biz_openings"] = rank_table(bizopen_w["last12"], bizopen_w["prior12"])
    tables["biz_closings"] = rank_table(
        {h: v["n"] for h, v in bizclose_w["last12"].items()},
        {h: v["n"] for h, v in bizclose_w["prior12"].items()})
    # intended-semantics diagnostic table (administrative closures excluded); never
    # used for verdicts, only to flag where the documented-but-inoperative exclusion
    # would change an answer
    tables["biz_closings_intended"] = rank_table(
        {h: v["n"] - v["admin"] for h, v in bizclose_w["last12"].items()},
        {h: v["n"] - v["admin"] for h, v in bizclose_w["prior12"].items()})
    tables["evictions_filed"] = rank_table(evic_w["last12"], evic_w["prior12"])
    tables["crime_victim_reported"] = rank_table(
        {h: crime_sums(c)["victim"] for h, c in crime_w["last12"].items()},
        {h: crime_sums(c)["victim"] for h, c in crime_w["prior12"].items()})
    tables["crime_enforcement"] = rank_table(
        {h: crime_sums(c)["enforcement"] for h, c in crime_w["last12"].items()},
        {h: crime_sums(c)["enforcement"] for h, c in crime_w["prior12"].items()})
    tables["crime_incidents"] = rank_table(
        {h: crime_sums(c)["total"] for h, c in crime_w["last12"].items()},
        {h: crime_sums(c)["total"] for h, c in crime_w["prior12"].items()})
    tables["threeoneone_encampment"] = rank_table(
        sub_counts(c311_w["last12"], lambda c: "encampment" in c.lower()),
        sub_counts(c311_w["prior12"], lambda c: "encampment" in c.lower()))
    tables["threeoneone_cleaning"] = rank_table(
        sub_counts(c311_w["last12"], lambda c: c == CLEANING_CATEGORY),
        sub_counts(c311_w["prior12"], lambda c: c == CLEANING_CATEGORY))

    # fiscal-year (jul23_jun24 vs jul24_jun25) values for the temporal block, keyed
    # by metric; fy25 == prior12 by construction
    fy_tables: dict[str, dict[str, dict[str, float]]] = {
        "threeoneone_encampment": {
            "fy24": sub_counts(c311_w["fy24"], lambda c: "encampment" in c.lower()),
            "fy25": sub_counts(c311_w["prior12"], lambda c: "encampment" in c.lower()),
        },
        "evictions_filed": {"fy24": evic_w["fy24"], "fy25": evic_w["prior12"]},
        "crime_victim_reported": {
            "fy24": {h: crime_sums(c)["victim"] for h, c in crime_w["fy24"].items()},
            "fy25": {h: crime_sums(c)["victim"] for h, c in crime_w["prior12"].items()},
        },
        "permits_issued": {
            "fy24": {h: v["n"] for h, v in permits_w["fy24"].items()},
            "fy25": {h: v["n"] for h, v in permits_w["prior12"].items()},
        },
        "biz_closings": {
            "fy24": {h: v["n"] for h, v in bizclose_w["fy24"].items()},
            "fy25": {h: v["n"] for h, v in bizclose_w["prior12"].items()},
        },
    }

    def closings_intended_note(area: str) -> dict:
        """Intended-semantics (admin closures excluded) diagnostic for one area."""
        row = tables["biz_closings_intended"].get(area)
        l12 = bizclose_w["last12"].get(area, {"n": 0, "admin": 0})
        p12 = bizclose_w["prior12"].get(area, {"n": 0, "admin": 0})
        return {
            "note": "build.py intends to exclude administrative closures but the "
                    "stager's truthy-value check never matches the export's "
                    "'***Administratively Closed' value, so the frozen numbers "
                    "include them; this shows the intended-semantics variant",
            "admin_closures_in_last12": l12["admin"],
            "admin_closures_in_prior12": p12["admin"],
            "intended_last12": l12["n"] - l12["admin"],
            "intended_prior12": p12["n"] - p12["admin"],
            "intended_pct_change": (None if row is None or row["pct_change"] is None
                                    else round(row["pct_change"], 3)),
        }

    per_question: list[dict] = []
    for q in questions:
        rec = {
            "id": q["id"], "type": q["type"], "metric": q["metric"], "area": q["area"],
            "expected": q["expected"], "independent_value": None,
            "delta_pct": None, "match": None, "verdict": None, "detail": {},
        }
        qtype, metric, area = q["type"], q["metric"], q["area"]

        # ---- direction --------------------------------------------------------------
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
                if metric == "biz_closings":
                    diag = closings_intended_note(area)
                    ipct_int = diag["intended_pct_change"]
                    diag["intended_direction"] = direction_of(ipct_int)
                    diag["intended_semantics_would_flip_answer"] = (
                        ipct_int is not None and direction_of(ipct_int) != q["expected"])
                    rec["detail"]["biz_closings_intended_semantics"] = diag

        # ---- temporal ---------------------------------------------------------------
        elif qtype == "temporal":
            fy = fy_tables[metric]
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
            if metric == "biz_closings":
                # fy windows: same no-exclusion finding applies; quantify the intended
                # variant for the two fiscal years
                a1 = bizclose_w["fy24"].get(area, {"n": 0, "admin": 0})
                a2 = bizclose_w["prior12"].get(area, {"n": 0, "admin": 0})
                iy1, iy2 = a1["n"] - a1["admin"], a2["n"] - a2["admin"]
                ip = pct_change(iy2, iy1)
                rec["detail"]["biz_closings_intended_semantics"] = {
                    "intended_jul23_jun24": iy1, "intended_jul24_jun25": iy2,
                    "intended_direction": direction_of(ip),
                    "intended_semantics_would_flip_answer": (
                        ip is not None and direction_of(ip) != q["expected"]),
                }

        # ---- superlative (v2: winner AND runner-up are both verified) ----------------
        elif qtype == "superlative":
            gt = q["ground_truth"]
            level_mode = "last_12mo" in gt  # generator: level gt carries last_12mo
            if level_mode:
                ranking = rank_by_level(tables[metric])
                exp_val, ru_val = gt["last_12mo"], gt["runner_up_last_12mo"]
            else:
                # rise vs drop from the generator's own wording (SUPERLATIVES table):
                # drop questions say 'decline'/'decrease'/'drop', rise questions say
                # 'increase'/'rise' -- disjoint vocabularies, so this is exact
                is_drop = any(w in q["question"].lower() for w in ("decline", "decrease", "drop"))
                ranking = rank_by_pct(tables[metric], reverse=not is_drop)
                exp_val, ru_val = gt["pct_change"], gt["runner_up_pct"]
                rec["detail"]["mode"] = "drop" if is_drop else "rise"
            if level_mode:
                rec["detail"]["mode"] = "most"
            if not ranking:
                rec["verdict"] = "not_verified"
                rec["detail"]["reason"] = "empty live ranking"
                per_question.append(rec)
                continue
            winner, winner_val = ranking[0]
            live_ru, live_ru_val = ranking[1] if len(ranking) > 1 else (None, None)
            rec["independent_value"] = winner
            winner_ok = winner == q["expected"]
            ru_ok = live_ru == gt["runner_up"]
            rec["match"] = winner_ok and ru_ok
            rec["detail"]["winner_confirmed"] = winner_ok
            rec["detail"]["runner_up_confirmed"] = ru_ok
            rec["detail"]["expected_runner_up"] = gt["runner_up"]
            rec["detail"]["live_runner_up"] = live_ru
            rec["detail"]["top5"] = [(h, round(v, 3)) for h, v in ranking[:5]]
            rec["detail"]["delta_winner_value_pct"] = (
                None if winner_val is None else rel_delta_pct(winner_val, exp_val)
                if winner_ok else None)
            if live_ru is not None and ru_ok:
                rec["detail"]["delta_runner_up_value_pct"] = rel_delta_pct(live_ru_val, ru_val)

            def margin_close(a: float, b: float) -> bool:
                return (abs(a - b) <= SUPERLATIVE_LEVEL_DRIFT * abs(a) if level_mode
                        else abs(a - b) <= SUPERLATIVE_DRIFT_MARGIN)

            if winner_ok and ru_ok:
                rec["verdict"] = "confirmed"
            elif winner_ok:
                # headline answer holds; the recorded #2 was displaced by live
                # movement -> drift if it is still nearby, else mismatch
                ru_pos = next((i for i, (h, _) in enumerate(ranking) if h == gt["runner_up"]), None)
                rec["detail"]["recorded_runner_up_live_rank"] = None if ru_pos is None else ru_pos + 1
                close = (ru_pos is not None and ru_pos < SUPERLATIVE_DRIFT_TOPK + 1
                         and margin_close(live_ru_val, ranking[ru_pos][1]))
                rec["verdict"] = "drift" if close else "mismatch"
                if rec["verdict"] == "drift":
                    rec["detail"]["drift_note"] = "winner #1 confirmed; runner-up displaced within margin"
            else:
                exp_pos = next((i for i, (h, _) in enumerate(ranking) if h == q["expected"]), None)
                rec["detail"]["expected_live_rank"] = None if exp_pos is None else exp_pos + 1
                if exp_pos is not None and exp_pos < SUPERLATIVE_DRIFT_TOPK:
                    m = abs(winner_val - ranking[exp_pos][1])
                    rec["detail"]["margin_to_live_winner"] = round(m, 3)
                    rec["verdict"] = "drift" if margin_close(winner_val, ranking[exp_pos][1]) else "mismatch"
                else:
                    rec["verdict"] = "mismatch"
            if metric == "biz_closings":
                # would the intended semantics (admin closures excluded) crown a
                # different #1? diagnostic only
                irank = (rank_by_level if level_mode
                         else lambda t: rank_by_pct(t, reverse=not is_drop))(tables["biz_closings_intended"])
                rec["detail"]["biz_closings_intended_semantics"] = {
                    "intended_top3": [(h, round(v, 3)) for h, v in irank[:3]],
                    "intended_winner": irank[0][0] if irank else None,
                    "intended_semantics_would_flip_answer": bool(irank) and irank[0][0] != q["expected"],
                }

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
                gt = q.get("ground_truth", {})
                rec["detail"]["gt_pct_changes"] = gt
                rec["match"] = winner == q["expected"]
                if rec["match"]:
                    rec["verdict"] = "confirmed"
                else:
                    rec["verdict"] = ("drift" if abs(vals[a] - vals[b]) < PAIRWISE_DRIFT_GAP
                                      else "mismatch")

        # ---- numeric ----------------------------------------------------------------
        elif qtype == "numeric":
            if metric == "units_approved_net":
                # generator: events (raw, no month clip) with
                # event_time >= current_date - 12 months -> rolling window
                entry = units_rolling.get(area)
                value = None if entry is None else entry["units"]
                rec["detail"]["window"] = (f"issued {ROLL12_START}..{PERMITS_AS_OF} "
                                           "(rolling, permits-snapshot-capped)")
            elif metric == "active_businesses":
                value = active_biz.get(area)
                rec["detail"]["note"] = ("current-state attribute; live registry churn since "
                                         f"the {REGBIZ_AS_OF} snapshot is expected drift")
            else:
                # generator: trajectory.last12 for crime_victim_reported /
                # evictions_filed / biz_openings -> month-truncated last12 window
                row = tables[metric].get(area)
                value = None if row is None else row["last12"]
                rec["detail"]["window"] = f"month-truncated last12 {LAST12[0]}..{LAST12[1]}"
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
                # verdict from the TRUE 500 m geodesic disk; in v2 this is ALSO the
                # generator's formula (axis-order fixed), so direct agreement is the
                # regression check on the v1 erratum
                value = summary["disk"]["units"]
                rec["independent_value"] = value
                rec["delta_pct"] = rel_delta_pct(value, q["expected"])
                gt = q["ground_truth"]
                rec["detail"].update({
                    "geocode": {"lat": pt[0], "lon": pt[1]},
                    "window": f"issued {ROLL24_START}..{PERMITS_AS_OF}, {RING_RADIUS_M} m true disk",
                    "true_500m_disk": summary["disk"],
                    "n_permits_expected": gt["n_permits"],
                    "n_permits_delta": summary["disk"]["n_permits"] - gt["n_permits"],
                    "borderline_490_510m": summary["borderline_490_510m"],
                    "dup_permit_rows_with_conflicting_units":
                        summary["dup_permit_rows_with_conflicting_units"],
                })
                tol = q["tolerance_pct"]
                adp = abs(rec["delta_pct"]) if rec["delta_pct"] is not None else float("inf")
                rec["verdict"] = ("confirmed" if adp <= tol
                                  else "drift" if adp <= tol * NUMERIC_DRIFT_FACTOR
                                  else "mismatch")
                if rec["verdict"] != "confirmed" or rec["detail"]["n_permits_delta"] != 0:
                    rec["detail"]["diagnosis_hint"] = (
                        "check borderline permits (DuckDB sphere-radius vs haversine "
                        "differs <0.2% at the boundary) and whether the generator's "
                        "H3 k=2 preclip excluded an in-disk permit (it should not: a "
                        "res-9 k=2 disk contains a 500 m circle with ~80 m margin)"
                    )

        # ---- traps: verify the EMBEDDED numbers, not the yes/no ------------------------
        elif qtype == "trap":
            gt = q.get("ground_truth", {})
            grows = q.get("grounding_rows", [])

            if metric in ("crime_victim_reported",) and area in ("Tenderloin", "Mission"):
                # q132 / q134: area-level enforcement-vs-victimization decomposition.
                # Embedded numbers = last12/prior12 for crime_incidents,
                # crime_victim_reported, crime_enforcement (grounding_rows).
                name_map = {"crime_incidents": "total", "crime_victim_reported": "victim",
                            "crime_enforcement": "enforcement"}
                live_l = crime_sums(crime_w["last12"].get(area, {}))
                live_p = crime_sums(crime_w["prior12"].get(area, {}))
                pairs = []
                for row in grows:
                    key = name_map[row["metric"]]
                    pairs.append((f"{row['metric']}.last12", row["last12"], live_l[key]))
                    pairs.append((f"{row['metric']}.prior12", row["prior12"], live_p[key]))
                checks, worst = trap_number_checks(pairs)
                decomp = {k: pct_change(live_l[v], live_p[v]) for k, v in name_map.items()}
                rec["independent_value"] = {k: None if p is None else round(p, 3)
                                            for k, p in decomp.items()}
                if area == "Tenderloin":
                    # designed contrast: total rose on an enforcement surge while
                    # victimization fell (generator emitted it from live trajectory)
                    mech = (decomp["crime_victim_reported"] is not None
                            and decomp["crime_victim_reported"] < 0
                            and decomp["crime_incidents"] is not None
                            and decomp["crime_incidents"] > 0
                            and decomp["crime_enforcement"] is not None
                            and decomp["crime_enforcement"] > 0)
                else:
                    # q134 floors from the generator: enforcement pct >= 0.25 while
                    # victim pct <= 0
                    mech = (decomp["crime_enforcement"] is not None
                            and decomp["crime_enforcement"] >= 0.25
                            and decomp["crime_victim_reported"] is not None
                            and decomp["crime_victim_reported"] <= 0)
                rec["match"] = mech
                rec["detail"]["embedded_number_checks"] = checks
                rec["detail"]["worst_embedded_delta_pct"] = round(worst, 2)
                rec["detail"]["mechanism_reproduced"] = mech
                rec["verdict"] = trap_verdict(mech, worst)

            elif metric == "threeoneone_noise":
                # q133: citywide nominal noise vs refined (excluding the
                # 'other_excessive_noise' catch-all Request Type). Embedded numbers:
                # nominal last12/prior12 (ground_truth) and refined last12/prior12
                # (grounding_rows).
                nom = {w: sum(sub.values()) for w, sub in noise_w.items()}
                ref = {w: sum(n for (_, s), n in sub.items() if s != NOISE_CATCHALL_SUBTYPE)
                       for w, sub in noise_w.items()}
                pct_nom = pct_change(nom["last12"], nom["prior12"])
                pct_ref = pct_change(ref["last12"], ref["prior12"])
                refined_gt = next(r for r in grows if r["metric"] == "threeoneone_noise_specific")
                checks, worst = trap_number_checks([
                    ("noise.last12", gt["noise_complaints_last12"], nom["last12"]),
                    ("noise.prior12", gt["prior12"], nom["prior12"]),
                    ("noise_specific.last12", refined_gt["citywide_last12"], ref["last12"]),
                    ("noise_specific.prior12", refined_gt["citywide_prior12"], ref["prior12"]),
                ])
                rec["independent_value"] = {
                    "noise_complaints_last12": nom["last12"], "prior12": nom["prior12"],
                    "pct_change_nominal": round(pct_nom, 3),
                    "pct_change_refined_excl_catchall": round(pct_ref, 3),
                }
                catchall_last = sum(n for (_, s), n in noise_w["last12"].items()
                                    if s == NOISE_CATCHALL_SUBTYPE)
                rec["detail"]["catchall_subtype"] = NOISE_CATCHALL_SUBTYPE
                rec["detail"]["catchall_share_of_last12"] = round(catchall_last / nom["last12"], 3)
                mech = (pct_nom >= TRAP_NOMINAL_MIN and pct_ref <= TRAP_REFINED_MAX
                        and (pct_nom - pct_ref) >= TRAP_DECOMP_GAP)
                rec["match"] = mech
                rec["detail"]["embedded_number_checks"] = checks
                rec["detail"]["worst_embedded_delta_pct"] = round(worst, 2)
                rec["detail"]["mechanism_reproduced"] = mech
                rec["verdict"] = trap_verdict(mech, worst)

            elif metric == "biz_closings":
                # q135: the embedded number is the registry closure count itself
                # (biz_closings last12 for the area, as-frozen semantics); the
                # generator picked the top-1 rankable area by last12, so that
                # selection is re-checked too. The lag CLAIM is documentary, but the
                # count is computable -> verdict from the count.
                row = tables["biz_closings"].get(area)
                live_n = None if row is None else row["last12"]
                checks, worst = trap_number_checks(
                    [("registry_closures_last12", gt["registry_closures_last12"], live_n)]
                    if live_n is not None else [])
                ranking = [(h, r["last12"]) for h, r in tables["biz_closings"].items() if r["rankable"]]
                ranking.sort(key=lambda x: -x[1])
                top1_ok = bool(ranking) and ranking[0][0] == area
                rec["independent_value"] = live_n
                rec["detail"]["embedded_number_checks"] = checks
                rec["detail"]["worst_embedded_delta_pct"] = round(worst, 2)
                rec["detail"]["is_top1_by_last12_rankable"] = top1_ok
                rec["detail"]["top3_by_last12"] = ranking[:3]
                diag = closings_intended_note(area)
                rec["detail"]["biz_closings_intended_semantics"] = diag
                rec["detail"]["note"] = (
                    "the closure-lag claim itself is a documented measurement caveat "
                    "(not computable from a snapshot); ironically the admin-closure "
                    "inclusion shown above further supports the trap's point that the "
                    "registry count is not a clean real-time closure measure")
                rec["match"] = live_n is not None and top1_ok
                rec["verdict"] = trap_verdict(rec["match"], worst)

            elif metric == "crime_incidents" and area == "San Francisco":
                # q137: citywide decomposition. 'Citywide' = sum over neighborhood-level
                # rows (hood non-null), exactly how the generator summed trajectory.
                live = {}
                for w in ("last12", "prior12"):
                    tot = vic = enf = 0
                    for cats in crime_w[w].values():
                        s = crime_sums(cats)
                        tot += s["total"]; vic += s["victim"]; enf += s["enforcement"]
                    live[w] = {"crime_incidents": tot, "crime_victim_reported": vic,
                               "crime_enforcement": enf}
                pairs = []
                for row in grows:
                    m = row["metric"]
                    pairs.append((f"{m}.last12", row["citywide_last12"], live["last12"][m]))
                    pairs.append((f"{m}.prior12", row["citywide_prior12"], live["prior12"][m]))
                checks, worst = trap_number_checks(pairs)
                pcts = {m: pct_change(live["last12"][m], live["prior12"][m])
                        for m in live["last12"]}
                rec["independent_value"] = {
                    "total_pct": round(pcts["crime_incidents"], 3),
                    "enforcement_pct": round(pcts["crime_enforcement"], 3),
                    "victim_pct": round(pcts["crime_victim_reported"], 3),
                }
                # generator floors: total fell while enforcement rose > 10%
                mech = (pcts["crime_incidents"] < 0 and pcts["crime_enforcement"] > 0.10)
                rec["match"] = mech
                rec["detail"]["embedded_number_checks"] = checks
                rec["detail"]["worst_embedded_delta_pct"] = round(worst, 2)
                rec["detail"]["mechanism_reproduced"] = mech
                rec["verdict"] = trap_verdict(mech, worst)

            elif metric == "assessed_value":
                # q136: Prop 13. There is NO computable number: the claim is that the
                # Assessor dataset's own documentation says assessed value grows at a
                # capped ~2%/yr until change of ownership and is not market price.
                # That is source-documentation, verified by reading the dataset notes,
                # not by an aggregate query -> 'documentary'.
                rec["verdict"] = "documentary"
                rec["match"] = None
                rec["detail"]["note"] = (
                    "mechanism-only trap: the claim (Prop 13 caps assessed-value "
                    "growth; assessor rolls are not market prices) is documented in "
                    "the DataSF Assessor Historical Secured Property Tax Rolls "
                    "dataset description and California Constitution art. XIII A; "
                    "there is no number to re-derive from a SODA aggregate")

            else:
                rec["verdict"] = "not_verified"
                rec["detail"]["reason"] = f"unrecognized trap shape (metric={metric!r}, area={area!r})"

        else:
            rec["verdict"] = "not_verified"
            rec["detail"]["reason"] = f"unknown question type {qtype!r}"

        per_question.append(rec)

    summary = {"confirmed": 0, "drift": 0, "mismatch": 0, "documentary": 0, "not_verified": 0}
    for rec in per_question:
        summary[rec["verdict"]] += 1

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method_note": (
            "Independent re-derivation of every benchmark_v2 expected answer directly from "
            "live DataSF SODA endpoints (permits i98e-djp9, businesses g8m3-pdis, police "
            "incidents wg3w-h783, evictions 5cei-gny5, 311 vw6y-z8j6), using server-side "
            "SoQL aggregation and the city's own Analysis Neighborhood columns -- zero "
            "Canary pipeline code imported. Windows: last12=[2025-07-01,2026-07-01), "
            "prior12=[2024-07-01,2025-07-01), jul23_jun24=[2023-07-01,2024-07-01); the "
            "numeric net-units block and the 500 m address rings use the generator's "
            "rolling windows (issued_date >= 2025-07-28 resp. 2024-07-28; generation-day "
            "current_date was 2026-07-28 PDT) capped at the frozen permits snapshot's "
            "as_of 2026-07-24. Semantics replicated as constants: permit issuance = "
            "non-null issued_date (no status filter); net units = sum(proposed_units - "
            "existing_units, nulls as 0, Socrata ::number casts); permit cost = "
            "sum(coalesce(revised_cost, estimated_cost)) over issued permits; business "
            "openings keyed on location_start_date; business closings keyed on "
            "location_end_date with location_start_date set -- AS-FROZEN these INCLUDE "
            "administrative closures because the stager's truthy check never matched the "
            "export's '***Administratively Closed' value (documented no-op; the "
            "intended-semantics variant is reported per question as a diagnostic); "
            "active businesses = location_start_date set AND location_end_date null "
            "(uncappable current-state attribute); crime split into victim-reported vs "
            "enforcement-driven by exact incident_category sets (enforcement activity is "
            "not victimization); 311 encampment by case-insensitive substring on "
            "Category, street cleaning by exact Category = 'Street and Sidewalk "
            "Cleaning' (verified the only clean/sweep Category live), noise by "
            "substring with the refined variant excluding the 'other_excessive_noise' "
            "Request Type catch-all; address rings geocoded with the public US Census "
            "geocoder and evaluated on the TRUE 500 m geodesic disk (haversine on each "
            "permit's own coordinates), one count per permit_number where a permit is "
            "in-disk iff ANY of its duplicate rows' points is (the generator's WHERE "
            "precedes its QUALIFY dedupe; some permits carry two address points) -- in "
            "v2 the generator's axis-order erratum is fixed and self-tested, so "
            "true-disk agreement doubles as the regression check. Superlatives verify BOTH the "
            "winner (#1) and the recorded runner-up (#2) under the trajectory rules "
            "(rankable = last12+prior12 >= 24; pct_change defined only for prior12 > 0; "
            "'most' ranks by last12 level with no floor). Trap questions verify the "
            "EMBEDDED numbers and the decomposition mechanism, not the yes/no; the "
            "Prop-13 trap is 'documentary' (source-documentation, no computable "
            "number). The live API has moved past the frozen snapshots (2026-07-24 "
            "permits/crime/311, 2026-07-25 businesses/evictions; append-mostly public "
            "records), so small count deltas are expected and quantified per question. "
            "Verdicts: confirmed (within tolerance / same sign / same #1 and #2 / "
            "mechanism + embedded numbers within 2%), drift (small live-data movement: "
            "numeric within 1.5x tolerance, superlative winner-or-runner-up displaced "
            "within 0.05 pct-points or 5% level margin, pairwise gap < 0.02, trap "
            "numbers within 10% with mechanism intact), mismatch (real disagreement, "
            "reported as-is), documentary (mechanism-only trap), not_verified (not "
            "derivable from the public API alone). Raw API responses cached under "
            "data/processed/verification_cache/."
        ),
        "per_question": per_question,
        "summary": summary,
    }


def print_table(report: dict) -> None:
    print(f"\n{'id':<6}{'type':<16}{'metric':<26}{'area':<34}{'expected':<22}"
          f"{'independent':<22}{'delta/match':<14}{'verdict'}")
    print("-" * 152)
    for r in report["per_question"]:
        iv = r["independent_value"]
        if isinstance(iv, dict):
            iv_s = str(iv.get("pct_change", iv.get("pct_change_nominal", iv.get("total_pct", ""))))
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
    print("-" * 152)
    print(f"summary: confirmed={s['confirmed']}  drift={s['drift']}  "
          f"mismatch={s['mismatch']}  documentary={s['documentary']}  "
          f"not_verified={s['not_verified']}  (of {len(report['per_question'])})")


def main() -> None:
    report = verify()
    OUT_PATH.write_text(json.dumps(report, indent=1))
    print_table(report)
    print(f"\nlive API requests this run: {_uncached_calls} (rest served from cache)")
    print(f"report -> {OUT_PATH.relative_to(BACKEND_DIR)}")


if __name__ == "__main__":
    sys.exit(main())
