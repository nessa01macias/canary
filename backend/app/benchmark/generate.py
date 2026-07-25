"""Generate the area ground-truth benchmark from canary.duckdb.

Test #1's second half (CONTEXT.md): do AI assistants answer neighborhood questions
correctly? Every question here has a ground truth computed from the public record,
with a receipt (source + as_of + the underlying numbers). H2 says their answers are
wrong; this is the instrument that kills or proves it -- and doubles as the launch
asset ("we asked N models 50 checkable questions; here's how wrong they were").

Question types:
  direction      "is X rising or falling in Y?"  -> expected: increase|decrease
  superlative    "which SF neighborhood had the biggest X?" -> expected: name
  numeric        "roughly how many X in Y last year?" -> expected: value +/- 25%
  fact           "was anything major approved in Y?" -> expected: key facts present

Only unambiguous ground truths are emitted (rankable areas, |change| above a floor,
minimum volume), so a wrong answer can't hide behind noise.

Usage:
    python -m app.benchmark.generate     # -> data/processed/benchmark_v0.json
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from app.pipeline import core

OUT = core.PROCESSED_DIR / "benchmark_v0.json"
TARGET = 50

PROVENANCE = "DataSF (data.sfgov.org) snapshots as_of 2026-07-24, Canary pipeline"


def direction_questions(con, metric: str, template: str, floor_pct: float, floor_vol: float, limit: int) -> list[dict]:
    rows = con.execute(
        """
        SELECT area_id, last12, prior12, pct_change FROM trajectory
        WHERE area_level = 'neighborhood' AND metric = ? AND rankable
          AND abs(pct_change) >= ? AND (last12 + prior12) >= ?
        ORDER BY abs(pct_change) DESC LIMIT ?
        """,
        [metric, floor_pct, floor_vol, limit],
    ).fetchall()
    out = []
    for hood, last12, prior12, pct in rows:
        out.append(
            {
                "type": "direction",
                "metric": metric,
                "area": hood,
                "question": template.format(hood=hood),
                "expected": "increase" if pct > 0 else "decrease",
                "ground_truth": {
                    "last_12mo": last12,
                    "prior_12mo": prior12,
                    "pct_change": round(pct, 3),
                },
                "receipt": PROVENANCE,
            }
        )
    return out


def main() -> None:
    con = core.connect(read_only=True)
    q: list[dict] = []

    # 1. The trap question: the naive answer ("crime is up 11%") is directionally
    #    wrong about what matters. Scored correct only if the answer says crime/
    #    victimization is falling OR distinguishes enforcement from victimization.
    q.append(
        {
            "type": "direction",
            "metric": "crime_victim_reported",
            "area": "Tenderloin",
            "question": (
                "I'm considering moving to the Tenderloin in San Francisco. "
                "Is crime there getting better or worse as of mid-2026?"
            ),
            "expected": "decrease",
            "ground_truth": {
                "victim_reported_pct": -0.080,
                "enforcement_pct": +0.436,
                "note": "total incidents +11% is an enforcement surge; victimization fell",
            },
            "scoring_note": (
                "correct = says crime/victimization is falling, or explicitly "
                "distinguishes enforcement activity from victimization"
            ),
            "receipt": PROVENANCE,
        }
    )

    q += direction_questions(
        con, "crime_victim_reported",
        "Is crime rising or falling in {hood}, San Francisco, as of mid-2026 (past year vs the year before)?",
        floor_pct=0.15, floor_vol=400, limit=9,
    )
    q += direction_questions(
        con, "biz_openings",
        "Are more or fewer new businesses opening in {hood}, San Francisco, this past year compared to the year before (as of mid-2026)?",
        floor_pct=0.15, floor_vol=150, limit=9,
    )
    q += direction_questions(
        con, "evictions_filed",
        "Are eviction notices in {hood}, San Francisco, increasing or decreasing as of mid-2026 (past year vs the year before)?",
        floor_pct=0.20, floor_vol=60, limit=6,
    )
    q += direction_questions(
        con, "threeoneone_noise",
        "Are 311 noise complaints in {hood}, San Francisco, up or down over the past year (as of mid-2026)?",
        floor_pct=0.25, floor_vol=100, limit=5,
    )
    q += direction_questions(
        con, "units_approved_net",
        "Is the number of new housing units approved in {hood}, San Francisco, going up or down (past 12 months vs the 12 before, as of mid-2026)?",
        floor_pct=0.30, floor_vol=150, limit=5,
    )

    # superlatives
    for metric, order, question in [
        ("biz_openings", "DESC", "Which San Francisco neighborhood had the biggest increase in new business openings over the past year (as of mid-2026)?"),
        ("crime_victim_reported", "ASC", "Which San Francisco neighborhood saw the largest drop in reported crime victimization over the past year (as of mid-2026)?"),
        ("permits_issued", "DESC", "Which San Francisco neighborhood had the largest increase in building permits issued over the past year (as of mid-2026)?"),
        ("evictions_filed", "DESC", "Which San Francisco neighborhood had the largest rise in eviction filings over the past year (as of mid-2026)?"),
    ]:
        hood, pct = con.execute(
            f"""
            SELECT area_id, pct_change FROM trajectory
            WHERE area_level='neighborhood' AND metric=? AND rankable AND pct_change IS NOT NULL
            ORDER BY pct_change {order} LIMIT 1
            """,
            [metric],
        ).fetchone()
        q.append(
            {
                "type": "superlative",
                "metric": metric,
                "area": hood,
                "question": question,
                "expected": hood,
                "ground_truth": {"pct_change": round(pct, 3)},
                "receipt": PROVENANCE,
            }
        )

    # numeric: housing units approved, by neighborhood (only clearly nonzero ones)
    for hood, units in con.execute(
        """
        SELECT neighborhood, sum(units_delta)::BIGINT AS units FROM events
        WHERE event_type='permit_issued' AND neighborhood IS NOT NULL
          AND event_time >= current_date - INTERVAL 12 MONTH
        GROUP BY 1 HAVING units >= 150 ORDER BY units DESC LIMIT 6
        """
    ).fetchall():
        q.append(
            {
                "type": "numeric",
                "metric": "units_approved_net",
                "area": hood,
                "question": f"Roughly how many net new housing units were approved (permits issued) in {hood}, San Francisco, in the 12 months before July 2026?",
                "expected": units,
                "tolerance_pct": 25,
                "receipt": PROVENANCE,
            }
        )

    # facts: the biggest recent project per storied area, from the permit record
    for hood in ["Treasure Island", "Mission", "Hayes Valley"]:
        row = con.execute(
            """
            SELECT coalesce(revised_cost, estimated_cost) AS cost,
                   (coalesce(proposed_units,0)-coalesce(existing_units,0))::BIGINT AS du,
                   left(description, 120), permit_number
            FROM read_parquet(?)
            WHERE neighborhood = ? AND issued_date >= current_date - INTERVAL 12 MONTH
              AND (coalesce(proposed_units,0)-coalesce(existing_units,0)) >= 20
            QUALIFY row_number() OVER (PARTITION BY permit_number ORDER BY 1) = 1
            ORDER BY cost DESC NULLS LAST LIMIT 1
            """,
            [str(core.latest_staged("datasf_permits")), hood],
        ).fetchone()
        if row:
            cost, du, descr, permit = row
            q.append(
                {
                    "type": "fact",
                    "metric": "permits",
                    "area": hood,
                    "question": f"Has any major new residential building been approved recently in {hood}, San Francisco? If so, roughly how large?",
                    "expected": f"yes; ~{du} units (~${cost:,.0f})",
                    "ground_truth": {"units": du, "cost": cost, "permit": permit, "description": descr},
                    "receipt": PROVENANCE,
                }
            )

    q = q[:TARGET]
    for i, item in enumerate(q, 1):
        item["id"] = f"q{i:03d}"

    core.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "name": "Canary area ground-truth benchmark v0 (San Francisco)",
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "pipeline_version": core.pipeline_version(),
                "provenance": PROVENANCE,
                "question_count": len(q),
                "questions": q,
            },
            indent=1,
        )
    )
    by_type: dict[str, int] = {}
    for item in q:
        by_type[item["type"]] = by_type.get(item["type"], 0) + 1
    print(f"[benchmark] {len(q)} questions -> {OUT.relative_to(core.DATA_DIR)}  {by_type}")
    con.close()


if __name__ == "__main__":
    main()
