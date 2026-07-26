"""Benchmark v1 generator: 50 questions, 8 blocks, frontier-grade specificity.

v1 over v0 (per the launch-research plan):
  - pairwise comparisons ("which rose more, A or B?") -- require two aggregations
    nobody has published; the block where frontier models should fail hardest
  - address-level forward layer (units approved within ~500m of a named address),
    with PERMIT-LEVEL grounding rows embedded per question (fixes v0's fact gap)
  - temporal windows (mid-2023->mid-2024 vs mid-2024->mid-2025) -- exposes stale
    training data explicitly
  - attribute counts (active registered businesses) + mechanism traps (TL crime
    split; the 311 noise app artifact as a question)

Every question still carries ground truth + receipt, generated and FROZEN before
any model is queried. Only unambiguous truths emit (volume floors, effect-size
floors, sign gaps on pairwise).

Usage:
    python -m app.benchmark.generate_v1     # -> data/processed/benchmark_v1.json
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import requests

from app.pipeline import core

OUT = core.PROCESSED_DIR / "benchmark_v1.json"

# (count targets per block; total 50)
N_DIRECTION, N_SUPERLATIVE, N_NUMERIC, N_PAIRWISE = 15, 5, 8, 8
N_ADDRESS, N_TEMPORAL, N_ATTRIBUTE, N_TRAPS = 5, 4, 3, 2

DIRECTION_METRICS = [
    ("crime_victim_reported", "Is crime rising or falling in {hood}, San Francisco (past year vs the year before, as of mid-2026)?", 0.15, 300),
    ("biz_openings", "Are more or fewer new businesses opening in {hood}, San Francisco, this past year compared to the year before (as of mid-2026)?", 0.15, 120),
    ("evictions_filed", "Are eviction notices in {hood}, San Francisco, increasing or decreasing (past year vs the year before, as of mid-2026)?", 0.20, 50),
    ("threeoneone_encampment", "Are 311 encampment reports in {hood}, San Francisco, up or down over the past year (as of mid-2026)?", 0.25, 80),
    ("units_approved_net", "Is the number of new housing units approved in {hood}, San Francisco, going up or down (past 12 months vs the 12 before, as of mid-2026)?", 0.30, 120),
]

# Recognizable addresses for the forward-layer block (geocoded at generation).
ADDRESSES = [
    "600 Valencia St, San Francisco, CA",
    "3251 20th Ave, San Francisco, CA",      # Stonestown
    "1 Warriors Way, San Francisco, CA",     # Chase Center
    "2301 Chestnut St, San Francisco, CA",   # Marina
    "450 10th St, San Francisco, CA",        # SoMa
]

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


def main() -> None:
    con = core.connect(read_only=True)
    as_of = con.execute("SELECT max(source_as_of) FROM trajectory").fetchone()[0]
    provenance = f"DataSF (data.sfgov.org) snapshots as_of {as_of}, Canary pipeline"
    q: list[dict] = []
    used_areas: dict[str, int] = {}

    def emit(item: dict) -> None:
        item["receipt"] = provenance
        q.append(item)

    # ---- block 1: direction (15) ------------------------------------------------
    for metric, template, floor_pct, floor_vol in DIRECTION_METRICS:
        rows = con.execute(
            """
            SELECT area_id, last12, prior12, pct_change FROM trajectory
            WHERE area_level='neighborhood' AND metric=? AND rankable
              AND abs(pct_change) >= ? AND (last12 + prior12) >= ?
            ORDER BY abs(pct_change) DESC LIMIT 6
            """,
            [metric, floor_pct, floor_vol],
        ).fetchall()
        taken = 0
        for hood, last12, prior12, pct in rows:
            if taken >= 3 or used_areas.get(hood, 0) >= 2:
                continue
            used_areas[hood] = used_areas.get(hood, 0) + 1
            taken += 1
            emit({
                "type": "direction", "metric": metric, "area": hood,
                "question": template.format(hood=hood),
                "expected": "increase" if pct > 0 else "decrease",
                "ground_truth": {"last_12mo": last12, "prior_12mo": prior12, "pct_change": round(pct, 3)},
            })
    q[:] = q[:N_DIRECTION]

    # ---- block 2: superlatives (5) ----------------------------------------------
    for metric, order, question in [
        ("biz_openings", "DESC", "Which San Francisco neighborhood had the biggest increase in new business openings over the past year (as of mid-2026)?"),
        ("crime_victim_reported", "ASC", "Which San Francisco neighborhood saw the largest drop in reported crime victimization over the past year (as of mid-2026)?"),
        ("permits_issued", "DESC", "Which San Francisco neighborhood had the largest increase in building permits issued over the past year (as of mid-2026)?"),
        ("evictions_filed", "DESC", "Which San Francisco neighborhood had the largest rise in eviction filings over the past year (as of mid-2026)?"),
        ("units_approved_net", "DESC", "Which San Francisco neighborhood had the most net new housing units approved in the past 12 months (as of mid-2026)?"),
    ][:N_SUPERLATIVE]:
        if metric == "units_approved_net":
            hood, val = con.execute(
                "SELECT area_id, last12 FROM trajectory WHERE area_level='neighborhood' AND metric=? ORDER BY last12 DESC LIMIT 1",
                [metric],
            ).fetchone()
            gt = {"units_last_12mo": val}
        else:
            hood, val = con.execute(
                f"SELECT area_id, pct_change FROM trajectory WHERE area_level='neighborhood' AND metric=? AND rankable AND pct_change IS NOT NULL ORDER BY pct_change {order} LIMIT 1",
                [metric],
            ).fetchone()
            gt = {"pct_change": round(val, 3)}
        emit({"type": "superlative", "metric": metric, "area": hood, "question": question, "expected": hood, "ground_truth": gt})

    # ---- block 3: numeric (8) ----------------------------------------------------
    for hood, units in con.execute(
        """
        SELECT neighborhood, sum(units_delta)::BIGINT AS units FROM events
        WHERE event_type='permit_issued' AND neighborhood IS NOT NULL
          AND event_time >= current_date - INTERVAL 12 MONTH
        GROUP BY 1 HAVING units >= 150 ORDER BY units DESC LIMIT 5
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
        GROUP BY 1 HAVING count(*) >= 800 ORDER BY count(*) DESC LIMIT 3
        """
    ).fetchall():
        emit({
            "type": "numeric", "metric": "active_businesses", "area": hood,
            "question": f"Roughly how many registered businesses are currently active in {hood}, San Francisco (as of mid-2026)?",
            "expected": n, "tolerance_pct": 30,
            "grounding_rows": [{"area_id": hood, "active_registered_businesses": n, "source_as_of": str(as_of)}],
        })

    # ---- block 4: pairwise comparisons (8) ----------------------------------------
    pair_metrics = ["biz_openings", "crime_victim_reported", "evictions_filed", "units_approved_net"]
    for metric in pair_metrics:
        rows = con.execute(
            """
            SELECT area_id, pct_change FROM trajectory
            WHERE area_level='neighborhood' AND metric=? AND rankable AND pct_change IS NOT NULL
              AND (last12 + prior12) >= 100
            ORDER BY pct_change DESC
            """,
            [metric],
        ).fetchall()
        if len(rows) < 4:
            continue
        for hi, lo in [(rows[0], rows[-1]), (rows[1], rows[-2])]:
            if abs(hi[1] - lo[1]) < 0.25:
                continue
            label = {
                "biz_openings": "new business openings",
                "crime_victim_reported": "reported crime victimization",
                "evictions_filed": "eviction filings",
                "units_approved_net": "net new housing units approved",
            }[metric]
            emit({
                "type": "pairwise", "metric": metric, "areas": [hi[0], lo[0]], "area": hi[0],
                "question": f"Between {hi[0]} and {lo[0]} in San Francisco, which neighborhood had the bigger increase in {label} over the past year (as of mid-2026)?",
                "expected": hi[0],
                "ground_truth": {hi[0]: round(hi[1], 3), lo[0]: round(lo[1], 3)},
            })

    # ---- block 5: address-level forward layer (5) ---------------------------------
    permits_path = str(core.latest_staged("datasf_permits"))
    for address in ADDRESSES:
        pt = geocode(address)
        if not pt:
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
            WHERE ST_Distance_Sphere(ST_Point(p.lon, p.lat), ST_Point({lon}, {lat})) <= 500
              AND issued_date >= current_date - INTERVAL 24 MONTH
            QUALIFY row_number() OVER (PARTITION BY permit_number ORDER BY 1) = 1
            """
        ).fetchall()
        total_units = int(sum(r[3] or 0 for r in rows))
        if abs(total_units) < 10:
            continue
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

    # ---- block 6: temporal windows (4) --------------------------------------------
    rows = con.execute(
        """
        WITH w AS (
          SELECT area_id, metric,
            sum(value) FILTER (period >= DATE '2024-07-01' AND period < DATE '2025-07-01') AS y2,
            sum(value) FILTER (period >= DATE '2023-07-01' AND period < DATE '2024-07-01') AS y1
          FROM metrics
          WHERE area_level='neighborhood'
            AND metric IN ('evictions_filed','biz_openings','crime_victim_reported')
          GROUP BY 1, 2
        )
        SELECT area_id, metric, y1, y2, (y2-y1)/y1 AS pct FROM w
        WHERE y1 >= 80 AND abs((y2-y1)/y1) >= 0.20
        ORDER BY abs((y2-y1)/y1) DESC LIMIT 4
        """
    ).fetchall()
    label = {"evictions_filed": "eviction notices", "biz_openings": "new business openings", "crime_victim_reported": "victim-reported crime incidents"}
    for hood, metric, y1, y2, pct in rows:
        emit({
            "type": "temporal", "metric": metric, "area": hood,
            "question": f"In {hood}, San Francisco, did {label[metric]} rise or fall between the year ending June 2024 and the year ending June 2025?",
            "expected": "increase" if pct > 0 else "decrease",
            "ground_truth": {"jul23_jun24": y1, "jul24_jun25": y2, "pct_change": round(pct, 3)},
        })

    # ---- block 7+8: traps (2, hand-designed from validated mechanisms) -------------
    tl = {r[0]: round(r[1], 3) for r in con.execute(
        "SELECT metric, pct_change FROM trajectory WHERE area_level='neighborhood' AND area_id='Tenderloin' AND metric IN ('crime_victim_reported','crime_enforcement','crime_incidents')"
    ).fetchall()}
    emit({
        "type": "direction", "metric": "crime_victim_reported", "area": "Tenderloin",
        "question": "I'm considering moving to the Tenderloin in San Francisco. Is crime there getting better or worse as of mid-2026?",
        "expected": "decrease",
        "ground_truth": tl | {"note": "total incidents rose on an enforcement surge; victimization fell"},
        "scoring_note": "correct = says crime/victimization is falling, or explicitly distinguishes enforcement activity from victimization",
    })
    noise = con.execute(
        "SELECT sum(last12), sum(prior12) FROM trajectory WHERE area_level='neighborhood' AND metric='threeoneone_noise'"
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
    })

    for i, item in enumerate(q, 1):
        item["id"] = f"q{i:03d}"

    core.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "name": "Canary area ground-truth benchmark v1 (San Francisco)",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pipeline_version": core.pipeline_version(),
        "provenance": provenance,
        "question_count": len(q),
        "questions": q,
    }, indent=1))
    by_type: dict[str, int] = {}
    for item in q:
        by_type[item["type"]] = by_type.get(item["type"], 0) + 1
    print(f"[benchmark v1] {len(q)} questions -> {OUT.relative_to(core.DATA_DIR)}  {by_type}")
    con.close()


if __name__ == "__main__":
    main()
