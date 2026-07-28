"""Benchmark v2 generator: 150-question scaled design per PROTOCOL_V2.md.

Block targets (protocol §3): direction 35, superlative 22, numeric 25,
pairwise 25, address-level 20, temporal 15, distractor 8. Floors (volume,
effect size, uniqueness gaps) may reduce actual counts; shortfalls are
documented in the output and the paper, exactly as v1 documented 50 -> 43.

Freeze discipline (protocol §4-§6): the geometry self-test runs before any
generation; the output file is committed with its hash BEFORE any model query;
the independent verification script runs against the frozen file. The OSF
registration did not precede this run; that fact is disclosed wherever these
results are reported.

Usage:
    python -m app.benchmark.generate_v2     # -> data/processed/benchmark_v2.json
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone

import requests

from app.pipeline import core

OUT = core.PROCESSED_DIR / "benchmark_v2.json"

N_DIRECTION, N_SUPERLATIVE, N_NUMERIC, N_PAIRWISE = 35, 22, 25, 25
N_ADDRESS, N_TEMPORAL, N_TRAPS = 20, 15, 8

# Uniqueness floors so every expected answer is unambiguous at grading time:
# a pct-change superlative needs daylight between #1 and #2; a level
# superlative needs #1 clearly above #2.
SUPERLATIVE_PCT_GAP = 0.05
SUPERLATIVE_LEVEL_RATIO = 1.15

# metric, question template, |pct| floor, volume floor (last12+prior12)
DIRECTION_METRICS = [
    ("crime_victim_reported", "Is crime rising or falling in {hood}, San Francisco (past year vs the year before, as of mid-2026)?", 0.15, 300),
    ("biz_openings", "Are more or fewer new businesses opening in {hood}, San Francisco, this past year compared to the year before (as of mid-2026)?", 0.15, 120),
    ("biz_closings", "Are business closures in {hood}, San Francisco, rising or falling (past year vs the year before, as of mid-2026)?", 0.20, 100),
    ("evictions_filed", "Are eviction notices in {hood}, San Francisco, increasing or decreasing (past year vs the year before, as of mid-2026)?", 0.20, 50),
    ("threeoneone_encampment", "Are 311 encampment reports in {hood}, San Francisco, up or down over the past year (as of mid-2026)?", 0.25, 80),
    ("units_approved_net", "Is the number of new housing units approved in {hood}, San Francisco, going up or down (past 12 months vs the 12 before, as of mid-2026)?", 0.30, 120),
    ("permits_issued", "Are more or fewer building permits being issued in {hood}, San Francisco (past year vs the year before, as of mid-2026)?", 0.20, 100),
]

# (metric, mode, question) — mode: rise / drop / most (level, last 12 months)
SUPERLATIVES = [
    ("biz_openings", "rise", "Which San Francisco neighborhood had the biggest increase in new business openings over the past year (as of mid-2026)?"),
    ("biz_openings", "drop", "Which San Francisco neighborhood had the largest decline in new business openings over the past year (as of mid-2026)?"),
    ("biz_openings", "most", "Which San Francisco neighborhood had the most new business openings in the past 12 months (as of mid-2026)?"),
    ("biz_closings", "rise", "Which San Francisco neighborhood had the largest increase in business closures over the past year (as of mid-2026)?"),
    ("biz_closings", "drop", "Which San Francisco neighborhood had the largest decrease in business closures over the past year (as of mid-2026)?"),
    ("crime_victim_reported", "drop", "Which San Francisco neighborhood saw the largest drop in reported crime victimization over the past year (as of mid-2026)?"),
    ("crime_victim_reported", "rise", "Which San Francisco neighborhood saw the largest rise in reported crime victimization over the past year (as of mid-2026)?"),
    ("crime_victim_reported", "most", "Which San Francisco neighborhood recorded the most victim-reported crime incidents in the past 12 months (as of mid-2026)?"),
    ("evictions_filed", "rise", "Which San Francisco neighborhood had the largest rise in eviction filings over the past year (as of mid-2026)?"),
    ("evictions_filed", "drop", "Which San Francisco neighborhood had the largest drop in eviction filings over the past year (as of mid-2026)?"),
    ("evictions_filed", "most", "Which San Francisco neighborhood had the most eviction notices filed in the past 12 months (as of mid-2026)?"),
    ("permits_issued", "rise", "Which San Francisco neighborhood had the largest increase in building permits issued over the past year (as of mid-2026)?"),
    ("permits_issued", "drop", "Which San Francisco neighborhood had the largest decrease in building permits issued over the past year (as of mid-2026)?"),
    ("permits_issued", "most", "Which San Francisco neighborhood had the most building permits issued in the past 12 months (as of mid-2026)?"),
    ("threeoneone_encampment", "rise", "Which San Francisco neighborhood had the largest increase in 311 encampment reports over the past year (as of mid-2026)?"),
    ("threeoneone_encampment", "drop", "Which San Francisco neighborhood had the largest decrease in 311 encampment reports over the past year (as of mid-2026)?"),
    ("threeoneone_cleaning", "rise", "Which San Francisco neighborhood had the largest increase in 311 street-cleaning requests over the past year (as of mid-2026)?"),
    ("threeoneone_cleaning", "drop", "Which San Francisco neighborhood had the largest decrease in 311 street-cleaning requests over the past year (as of mid-2026)?"),
    ("permit_cost_issued_usd", "rise", "Which San Francisco neighborhood had the largest increase in construction investment (cost of issued building permits) over the past year (as of mid-2026)?"),
    ("permit_cost_issued_usd", "most", "Which San Francisco neighborhood had the most construction investment by issued permit cost in the past 12 months (as of mid-2026)?"),
    ("units_approved_net", "most", "Which San Francisco neighborhood had the most net new housing units approved in the past 12 months (as of mid-2026)?"),
    ("crime_enforcement", "rise", "Which San Francisco neighborhood had the largest increase in police-initiated (enforcement) incident reports over the past year (as of mid-2026)?"),
]

# (metric, question template, floor for last12, target count)
NUMERIC_COUNTS = [
    ("crime_victim_reported", "Roughly how many crime incidents were reported by victims in {hood}, San Francisco, in the 12 months before July 2026?", 500, 4),
    ("evictions_filed", "Roughly how many eviction notices were filed in {hood}, San Francisco, in the 12 months before July 2026?", 60, 3),
    ("biz_openings", "Roughly how many new businesses opened (registered) in {hood}, San Francisco, in the 12 months before July 2026?", 150, 4),
]

PAIRWISE_METRICS = [
    ("biz_openings", "new business openings", 100),
    ("crime_victim_reported", "reported crime victimization", 100),
    ("evictions_filed", "eviction filings", 60),
    ("units_approved_net", "net new housing units approved", 100),
    ("permits_issued", "building permits issued", 100),
]

ADDRESSES = [
    "600 Valencia St, San Francisco, CA",
    "3251 20th Ave, San Francisco, CA",
    "1 Warriors Way, San Francisco, CA",
    "2301 Chestnut St, San Francisco, CA",
    "450 10th St, San Francisco, CA",
    "1 Ferry Building, San Francisco, CA",
    "2000 Mission St, San Francisco, CA",
    "1455 Market St, San Francisco, CA",
    "555 California St, San Francisco, CA",
    "2675 Geary Blvd, San Francisco, CA",
    "900 North Point St, San Francisco, CA",
    "3600 16th St, San Francisco, CA",
    "1748 Haight St, San Francisco, CA",
    "5800 3rd St, San Francisco, CA",
    "2100 Chestnut St, San Francisco, CA",
    "350 Rhode Island St, San Francisco, CA",
    "1100 Ocean Ave, San Francisco, CA",
    "4500 Mission St, San Francisco, CA",
    "2200 Irving St, San Francisco, CA",
    "700 Divisadero St, San Francisco, CA",
    "88 King St, San Francisco, CA",
    "1275 Columbus Ave, San Francisco, CA",
    "601 Van Ness Ave, San Francisco, CA",
    "1200 9th Ave, San Francisco, CA",
    "2500 Noriega St, San Francisco, CA",
    "301 Cortland Ave, San Francisco, CA",
    "3995 24th St, San Francisco, CA",
    "998 Valencia St, San Francisco, CA",
]

TEMPORAL_METRICS = (
    "evictions_filed", "biz_openings", "crime_victim_reported",
    "permits_issued", "threeoneone_encampment", "biz_closings",
)

CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"


def geocode(address: str) -> tuple[float, float] | None:
    try:
        resp = requests.get(
            CENSUS_GEOCODER,
            params={"address": address, "benchmark": "Public_AR_Current", "format": "json"},
            timeout=30,
        )
        resp.raise_for_status()
        matches = resp.json().get("result", {}).get("addressMatches", [])
        if not matches:
            return None
        return matches[0]["coordinates"]["y"], matches[0]["coordinates"]["x"]
    except requests.RequestException:
        return None


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def geometry_selftest(con) -> None:
    """Protocol §6: ring predicates are unit-tested before generation.

    Ferry Building -> Coit Tower and a pure north-south pair; the v1 erratum
    (axis order) would fail both by tens of percent.
    """
    cases = [
        (37.7955, -122.3937, 37.8024, -122.4058),  # Ferry Building -> Coit Tower
        (37.7599, -122.4213, 37.7699, -122.4213),  # 1.11 km due north
    ]
    for lat1, lon1, lat2, lon2 in cases:
        got = con.execute(
            f"SELECT ST_Distance_Sphere(ST_Point({lat1}, {lon1}), ST_Point({lat2}, {lon2}))"
        ).fetchone()[0]
        want = haversine_m(lat1, lon1, lat2, lon2)
        if abs(got - want) / want > 0.01:
            raise SystemExit(
                f"[geometry] FAIL: ST_Distance_Sphere={got:.1f}m vs haversine={want:.1f}m "
                f"({abs(got - want) / want:.1%} off). Refusing to generate."
            )
    print("[geometry] self-test passed (2 known pairs within 1%)")


def main() -> None:
    con = core.connect(read_only=True)
    geometry_selftest(con)

    as_of = con.execute("SELECT max(source_as_of) FROM trajectory").fetchone()[0]
    provenance = f"DataSF (data.sfgov.org) snapshots as_of {as_of}, Canary pipeline"
    q: list[dict] = []
    shortfalls: list[str] = []

    def emit(item: dict) -> None:
        item["receipt"] = provenance
        q.append(item)

    # ---- direction (target 35): 7 metrics x up to 5 areas -----------------------
    used_areas: dict[str, int] = {}
    for metric, template, floor_pct, floor_vol in DIRECTION_METRICS:
        rows = con.execute(
            """
            SELECT area_id, last12, prior12, pct_change FROM trajectory
            WHERE area_level='neighborhood' AND metric=? AND rankable
              AND abs(pct_change) >= ? AND (last12 + prior12) >= ?
            ORDER BY abs(pct_change) DESC LIMIT 10
            """,
            [metric, floor_pct, floor_vol],
        ).fetchall()
        taken = 0
        for hood, last12, prior12, pct in rows:
            if taken >= 5 or used_areas.get(hood, 0) >= 3:
                continue
            used_areas[hood] = used_areas.get(hood, 0) + 1
            taken += 1
            emit({
                "type": "direction", "metric": metric, "area": hood,
                "question": template.format(hood=hood),
                "expected": "increase" if pct > 0 else "decrease",
                "ground_truth": {"last_12mo": last12, "prior_12mo": prior12, "pct_change": round(pct, 3)},
            })
        if taken < 5:
            shortfalls.append(f"direction/{metric}: {taken}/5 passed floors")

    # ---- superlatives (target 22), with uniqueness gaps --------------------------
    n_sup = 0
    for metric, mode, question in SUPERLATIVES:
        if mode in ("rise", "drop"):
            order = "DESC" if mode == "rise" else "ASC"
            rows = con.execute(
                f"""
                SELECT area_id, pct_change FROM trajectory
                WHERE area_level='neighborhood' AND metric=? AND rankable AND pct_change IS NOT NULL
                ORDER BY pct_change {order} LIMIT 2
                """,
                [metric],
            ).fetchall()
            if len(rows) < 2 or abs(rows[0][1] - rows[1][1]) < SUPERLATIVE_PCT_GAP:
                shortfalls.append(f"superlative/{metric}/{mode}: #1-#2 gap below {SUPERLATIVE_PCT_GAP}")
                continue
            hood, val = rows[0]
            gt = {"pct_change": round(val, 3), "runner_up": rows[1][0], "runner_up_pct": round(rows[1][1], 3)}
        else:  # level: most of X in the last 12 months
            rows = con.execute(
                """
                SELECT area_id, last12 FROM trajectory
                WHERE area_level='neighborhood' AND metric=? AND last12 IS NOT NULL
                ORDER BY last12 DESC LIMIT 2
                """,
                [metric],
            ).fetchall()
            if len(rows) < 2 or rows[1][1] <= 0 or rows[0][1] / max(rows[1][1], 1e-9) < SUPERLATIVE_LEVEL_RATIO:
                shortfalls.append(f"superlative/{metric}/most: #1 within {SUPERLATIVE_LEVEL_RATIO}x of #2")
                continue
            hood, val = rows[0]
            gt = {"last_12mo": val, "runner_up": rows[1][0], "runner_up_last_12mo": rows[1][1]}
        n_sup += 1
        emit({"type": "superlative", "metric": metric, "area": hood, "question": question,
              "expected": hood, "ground_truth": gt})

    # ---- numeric (target 25): units 8 + active biz 6 + counts 11 -----------------
    for hood, units in con.execute(
        """
        SELECT neighborhood, sum(units_delta)::BIGINT AS units FROM events
        WHERE event_type='permit_issued' AND neighborhood IS NOT NULL
          AND event_time >= current_date - INTERVAL 12 MONTH
        GROUP BY 1 HAVING units >= 150 ORDER BY units DESC LIMIT 8
        """
    ).fetchall():
        emit({
            "type": "numeric", "metric": "units_approved_net", "area": hood,
            "question": f"Roughly how many net new housing units were approved (permits issued) in {hood}, San Francisco, in the 12 months before July 2026?",
            "expected": units, "tolerance_pct": 30,
        })
    for hood, n in con.execute(
        """
        SELECT neighborhood, count(*) FROM places
        WHERE active_to IS NULL AND neighborhood IS NOT NULL
        GROUP BY 1 HAVING count(*) >= 800 ORDER BY count(*) DESC LIMIT 6
        """
    ).fetchall():
        emit({
            "type": "numeric", "metric": "active_businesses", "area": hood,
            "question": f"Roughly how many registered businesses are currently active in {hood}, San Francisco (as of mid-2026)?",
            "expected": n, "tolerance_pct": 30,
            "grounding_rows": [{"area_id": hood, "active_registered_businesses": n, "source_as_of": str(as_of)}],
        })
    for metric, template, floor, take in NUMERIC_COUNTS:
        for hood, last12 in con.execute(
            """
            SELECT area_id, last12::BIGINT FROM trajectory
            WHERE area_level='neighborhood' AND metric=? AND last12 >= ?
            ORDER BY last12 DESC LIMIT ?
            """,
            [metric, floor, take],
        ).fetchall():
            emit({
                "type": "numeric", "metric": metric, "area": hood,
                "question": template.format(hood=hood),
                "expected": last12, "tolerance_pct": 30,
            })

    # ---- pairwise (target 25): 5 metrics x up to 5 pairs --------------------------
    for metric, label, vol in PAIRWISE_METRICS:
        rows = con.execute(
            """
            SELECT area_id, pct_change FROM trajectory
            WHERE area_level='neighborhood' AND metric=? AND rankable AND pct_change IS NOT NULL
              AND (last12 + prior12) >= ?
            ORDER BY pct_change DESC
            """,
            [metric, vol],
        ).fetchall()
        made = 0
        for k in range(5):
            if len(rows) < 2 * (k + 1) + 1:
                break
            hi, lo = rows[k], rows[-(k + 1)]
            if abs(hi[1] - lo[1]) < 0.25:
                continue
            made += 1
            emit({
                "type": "pairwise", "metric": metric, "areas": [hi[0], lo[0]], "area": hi[0],
                "question": f"Between {hi[0]} and {lo[0]} in San Francisco, which neighborhood had the bigger increase in {label} over the past year (as of mid-2026)?",
                "expected": hi[0],
                "ground_truth": {hi[0]: round(hi[1], 3), lo[0]: round(lo[1], 3)},
            })
        if made < 5:
            shortfalls.append(f"pairwise/{metric}: {made}/5 passed floors")

    # ---- address-level forward layer (target 20) ----------------------------------
    permits_path = str(core.latest_staged("datasf_permits"))
    n_addr = 0
    for address in ADDRESSES:
        if n_addr >= N_ADDRESS:
            break
        pt = geocode(address)
        if not pt:
            shortfalls.append(f"address: geocode failed for {address}")
            continue
        lat, lon = pt
        rows = con.execute(
            f"""
            WITH ring AS (SELECT unnest(h3_grid_disk(h3_latlng_to_cell_string({lat}, {lon}, {core.H3_RES}), 2)) AS h3_9)
            SELECT permit_number, issued_date,
                   coalesce(revised_cost, estimated_cost) AS cost,
                   (coalesce(proposed_units,0)-coalesce(existing_units,0)) AS du,
                   left(regexp_replace(description, '\\s+', ' ', 'g'), 90) AS descr
            FROM read_parquet('{permits_path}') p JOIN ring USING (h3_9)
            WHERE ST_Distance_Sphere(ST_Point(p.lat, p.lon), ST_Point({lat}, {lon})) <= 500
              AND issued_date >= current_date - INTERVAL 24 MONTH
            QUALIFY row_number() OVER (PARTITION BY permit_number ORDER BY 1) = 1
            """
        ).fetchall()
        total_units = int(sum(r[3] or 0 for r in rows))
        if abs(total_units) < 20 or len(rows) < 10:
            shortfalls.append(f"address: {address} below floors ({total_units} units, {len(rows)} permits)")
            continue
        n_addr += 1
        top = sorted(rows, key=lambda r: -(r[2] or 0))[:10]
        emit({
            "type": "address_forward", "metric": "units_approved_net", "area": address,
            "question": f"Roughly how many net new housing units were approved (permits issued) within about 500 meters of {address} in the 24 months before July 2026?",
            "expected": total_units, "tolerance_pct": 35,
            "ground_truth": {"total_units_500m_24mo": total_units, "n_permits": len(rows)},
            "grounding_rows": [
                {"ring_summary": {"radius_m": 500, "window_months": 24,
                 "total_net_units_approved": total_units, "n_permits": len(rows)}},
                *[{"permit": r[0], "issued": str(r[1]), "cost": r[2], "units_delta": r[3], "description": r[4]}
                  for r in top],
            ],
        })

    # ---- temporal windows (target 15) ----------------------------------------------
    label = {
        "evictions_filed": "eviction notices", "biz_openings": "new business openings",
        "crime_victim_reported": "victim-reported crime incidents",
        "permits_issued": "building permits issued",
        "threeoneone_encampment": "311 encampment reports", "biz_closings": "business closures",
    }
    rows = con.execute(
        f"""
        WITH w AS (
          SELECT area_id, metric,
            sum(value) FILTER (period >= DATE '2024-07-01' AND period < DATE '2025-07-01') AS y2,
            sum(value) FILTER (period >= DATE '2023-07-01' AND period < DATE '2024-07-01') AS y1
          FROM metrics
          WHERE area_level='neighborhood'
            AND metric IN ({",".join("?" * len(TEMPORAL_METRICS))})
          GROUP BY 1, 2
        )
        SELECT area_id, metric, y1, y2, (y2-y1)/y1 AS pct FROM w
        WHERE y1 >= 80 AND abs((y2-y1)/y1) >= 0.20
        ORDER BY abs((y2-y1)/y1) DESC LIMIT {N_TEMPORAL}
        """,
        list(TEMPORAL_METRICS),
    ).fetchall()
    for hood, metric, y1, y2, pct in rows:
        emit({
            "type": "temporal", "metric": metric, "area": hood,
            "question": f"In {hood}, San Francisco, did {label[metric]} rise or fall between the year ending June 2024 and the year ending June 2025?",
            "expected": "increase" if pct > 0 else "decrease",
            "ground_truth": {"jul23_jun24": y1, "jul24_jun25": y2, "pct_change": round(pct, 3)},
        })
    if len(rows) < N_TEMPORAL:
        shortfalls.append(f"temporal: {len(rows)}/{N_TEMPORAL} passed floors")

    # ---- distractors (target 8, hand-designed from VALIDATED mechanisms only) ------
    # Every trap embeds its own grounding_rows: the payload an API call would
    # return, including the decomposition that resolves the trap.
    def area_crime_rows(hood: str) -> list[dict]:
        return [
            {"area_id": hood, "metric": m, "last12": l12, "prior12": p12, "pct_change": round(pc, 3),
             "source_as_of": str(as_of)}
            for m, l12, p12, pc in con.execute(
                "SELECT metric, last12, prior12, pct_change FROM trajectory "
                "WHERE area_level='neighborhood' AND area_id=? AND metric IN "
                "('crime_victim_reported','crime_enforcement','crime_incidents')",
                [hood],
            ).fetchall()
        ]

    tl = {r["metric"]: r["pct_change"] for r in area_crime_rows("Tenderloin")}
    emit({
        "type": "trap", "metric": "crime_victim_reported", "area": "Tenderloin",
        "question": "I'm considering moving to the Tenderloin in San Francisco. Is crime there getting better or worse as of mid-2026?",
        "expected": "decrease",
        "ground_truth": tl | {"note": "total incidents rose on an enforcement surge; victimization fell"},
        "scoring_note": "correct = says crime/victimization is falling, or explicitly distinguishes enforcement activity from victimization",
        "grounding_rows": area_crime_rows("Tenderloin"),
    })

    noise = con.execute(
        "SELECT sum(last12), sum(prior12) FROM trajectory WHERE area_level='neighborhood' AND metric='threeoneone_noise'"
    ).fetchone()
    refined = con.execute(
        "SELECT sum(last12), sum(prior12) FROM trajectory WHERE area_level='neighborhood' AND metric='threeoneone_noise_specific'"
    ).fetchone()
    emit({
        "type": "trap", "metric": "threeoneone_noise", "area": "San Francisco",
        "question": "311 noise complaints in San Francisco rose over 60% in the year to mid-2026. Does that mean the city actually got dramatically louder?",
        "expected": "no",
        "ground_truth": {
            "noise_complaints_last12": noise[0], "prior12": noise[1],
            "note": "step-change concentrated in one catch-all category and the mobile app channel (a reporting-flow change); the refined metric excluding it rose ~26%",
        },
        "scoring_note": "correct = says no / mostly a reporting or app change, complaints are not conditions; wrong = affirms the city got ~60% louder",
        "grounding_rows": [
            {"metric": "threeoneone_noise", "definition": "all noise-tagged 311 cases incl. a catch-all category", "citywide_last12": noise[0], "citywide_prior12": noise[1], "source_as_of": str(as_of)},
            {"metric": "threeoneone_noise_specific", "definition": "noise cases excluding the catch-all category inflated by a March 2026 app change", "citywide_last12": refined[0], "citywide_prior12": refined[1], "source_as_of": str(as_of)},
        ],
    })

    # a second enforcement-vs-victimization area, if the record contains one
    second = con.execute(
        """
        SELECT e.area_id FROM trajectory e
        JOIN trajectory v ON v.area_id = e.area_id AND v.area_level='neighborhood'
             AND v.metric='crime_victim_reported'
        WHERE e.area_level='neighborhood' AND e.metric='crime_enforcement'
          AND e.area_id != 'Tenderloin' AND e.pct_change >= 0.25 AND v.pct_change <= 0
          AND (v.last12 + v.prior12) >= 300
        ORDER BY e.pct_change DESC LIMIT 1
        """
    ).fetchone()
    if second:
        hood = second[0]
        emit({
            "type": "trap", "metric": "crime_victim_reported", "area": hood,
            "question": f"Police incident counts in {hood}, San Francisco, rose this past year. Should I read that as the area getting more dangerous (as of mid-2026)?",
            "expected": "no",
            "scoring_note": "correct = distinguishes enforcement-driven incidents from victim reports, or says victimization did not rise; wrong = affirms it got more dangerous",
            "ground_truth": {"note": "enforcement-driven incidents rose while victim-reported crime did not"},
            "grounding_rows": area_crime_rows(hood),
        })
    else:
        shortfalls.append("trap: no second enforcement-vs-victimization area passed floors")

    # closure lag: registry close dates trail reality (documented)
    cl = con.execute(
        "SELECT area_id, last12 FROM trajectory WHERE area_level='neighborhood' AND metric='biz_closings' AND rankable ORDER BY last12 DESC LIMIT 1"
    ).fetchone()
    if cl:
        emit({
            "type": "trap", "metric": "biz_closings", "area": cl[0],
            "question": f"The city's business registry shows {int(cl[1])} closures in {cl[0]}, San Francisco, over the past year. Is the registry a reliable real-time count of business closures?",
            "expected": "no",
            "scoring_note": "correct = says no, closure filings lag actual closures (owners file late or never), so real-time counts understate; wrong = treats the registry count as a complete real-time measure",
            "ground_truth": {"registry_closures_last12": int(cl[1]), "note": "close dates in the registry lag reality; documented measurement caveat"},
            "grounding_rows": [
                {"metric": "biz_closings", "definition": "business locations with a registry end date in the window; end dates are frequently backfilled late, so recent months understate true closures", "area_id": cl[0], "last12": int(cl[1]), "source_as_of": str(as_of)},
            ],
        })

    # Prop 13: assessed value is not market price (source-documented)
    emit({
        "type": "trap", "metric": "assessed_value", "area": "San Francisco",
        "question": "San Francisco assessed property values rose only about 2% last year. Does that mean market prices were roughly flat?",
        "expected": "no",
        "scoring_note": "correct = says no, Proposition 13 caps assessed-value growth (~2%/yr until sale), so assessed values do not track market prices; wrong = treats assessed growth as market growth",
        "ground_truth": {"note": "Prop 13 caps annual assessed-value increases; assessor rolls are NOT market price (source-documented)"},
        "grounding_rows": [
            {"source": "DataSF Assessor Historical Secured Property Tax Rolls", "definition": "assessed value under Proposition 13: annual increases capped (~2%) until change of ownership; NOT market price", "source_as_of": str(as_of)},
        ],
    })

    # citywide decomposition: total fell, enforcement rose
    city = {
        m: (l12, p12) for m, l12, p12 in con.execute(
            "SELECT metric, sum(last12), sum(prior12) FROM trajectory WHERE area_level='neighborhood' "
            "AND metric IN ('crime_victim_reported','crime_enforcement','crime_incidents') GROUP BY 1"
        ).fetchall()
    }
    tot = city.get("crime_incidents")
    enf = city.get("crime_enforcement")
    vic = city.get("crime_victim_reported")
    if tot and enf and vic and tot[1] and enf[1]:
        tot_pct, enf_pct = tot[0] / tot[1] - 1, enf[0] / enf[1] - 1
        if tot_pct < 0 and enf_pct > 0.10:
            emit({
                "type": "trap", "metric": "crime_incidents", "area": "San Francisco",
                "question": f"Total police incident reports in San Francisco fell about {abs(tot_pct):.0%} this past year. Is it safe to conclude police enforcement activity also fell?",
                "expected": "no",
                "scoring_note": "correct = says no, enforcement-initiated incidents rose while victim reports fell; wrong = affirms enforcement fell with the total",
                "ground_truth": {"total_pct": round(tot_pct, 3), "enforcement_pct": round(enf_pct, 3), "victim_pct": round(vic[0] / vic[1] - 1, 3)},
                "grounding_rows": [
                    {"metric": "crime_incidents", "definition": "all incident reports", "citywide_last12": tot[0], "citywide_prior12": tot[1], "source_as_of": str(as_of)},
                    {"metric": "crime_enforcement", "definition": "police-initiated categories (drug offenses, warrants, stops)", "citywide_last12": enf[0], "citywide_prior12": enf[1], "source_as_of": str(as_of)},
                    {"metric": "crime_victim_reported", "definition": "victim-initiated report categories", "citywide_last12": vic[0], "citywide_prior12": vic[1], "source_as_of": str(as_of)},
                ],
            })
        else:
            shortfalls.append("trap: citywide decomposition signs did not match the designed contrast")

    n_traps = sum(1 for item in q if item["type"] == "trap")
    if n_traps < N_TRAPS:
        shortfalls.append(f"trap: {n_traps}/{N_TRAPS} designed traps emitted (only validated mechanisms qualify)")

    for i, item in enumerate(q, 1):
        item["id"] = f"q{i:03d}"

    core.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    by_type: dict[str, int] = {}
    for item in q:
        by_type[item["type"]] = by_type.get(item["type"], 0) + 1
    OUT.write_text(json.dumps({
        "name": "Canary area ground-truth benchmark v2 (San Francisco, scaled)",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pipeline_version": core.pipeline_version(),
        "provenance": provenance,
        "question_count": len(q),
        "block_counts": by_type,
        "protocol_note": (
            "Design per PROTOCOL_V2.md block targets (35/22/25/25/20/15/8). "
            "OSF registration did NOT precede this run; the protocol was committed "
            "to git before generation and this file is committed before any model "
            "query. Shortfalls vs targets are listed in 'shortfalls'."
        ),
        "shortfalls": shortfalls,
        "questions": q,
    }, indent=1))
    print(f"[benchmark v2] {len(q)} questions -> {OUT.relative_to(core.DATA_DIR)}")
    print(f"  blocks: {by_type}")
    for s in shortfalls:
        print(f"  shortfall: {s}")
    con.close()


if __name__ == "__main__":
    main()
