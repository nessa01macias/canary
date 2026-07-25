"""L3.5 trajectory: per-area, per-metric direction signals over the metrics table.

Deliberately NOT a composite "improving/declining" score -- design constraint: facts
with citations, no quality labels. Each metric keeps its own direction; interpretation
stays with the reader (and the eventual report cites each dimension separately).

Per (area, metric):
  last12 / prior12   event totals for the trailing 12 complete months vs the 12 before
  pct_change         (last12 - prior12) / prior12, NULL when prior12 = 0
  slope36            linear slope of monthly values over the trailing 36 complete
                     months, zero-filled on a dense month grid (a missing month means
                     zero events, not missing data -- these are event-count metrics)
  z                  pct_change standardized across areas within (area_level, metric),
                     LOW-VOLUME AREAS EXCLUDED (< MIN_EVENTS total across both windows
                     -> too noisy to rank; they still get last12/prior12 rows)

Usage:
    python -m app.pipeline.trajectory
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.pipeline import core

MIN_EVENTS = 24  # >= ~1 event/month across the 24-month comparison window

# Neighborhoods with well-documented 2020-2026 arcs, printed for eyeball validation.
STORIED = [
    "Tenderloin",
    "South of Market",
    "Financial District/South Beach",
    "Hayes Valley",
    "Mission",
    "Sunset/Parkside",
    "Bayview Hunters Point",
]

REPORT_METRICS = ["biz_openings", "biz_closings", "permits_issued", "crime_incidents", "evictions_filed"]


def build(con) -> None:
    version = core.pipeline_version()
    computed_at = datetime.now(timezone.utc).isoformat()
    con.execute(
        f"""
        CREATE OR REPLACE TABLE trajectory AS
        WITH anchor AS (
            SELECT date_trunc('month', current_date)::DATE AS a
        ),
        windows AS (
            SELECT
                area_id, area_level, metric,
                coalesce(sum(value) FILTER (period >= a - INTERVAL 12 MONTH), 0) AS last12,
                coalesce(sum(value) FILTER (period >= a - INTERVAL 24 MONTH
                                        AND period <  a - INTERVAL 12 MONTH), 0) AS prior12,
                count(*) FILTER (period >= a - INTERVAL 36 MONTH) AS n_active_months,
                any_value(source) AS source, max(source_as_of) AS source_as_of
            FROM metrics, anchor
            WHERE period >= a - INTERVAL 24 MONTH
               OR period >= a - INTERVAL 36 MONTH
            GROUP BY 1, 2, 3
        ),
        -- dense month grid for the slope: absent month = zero events, not missing data
        grid AS (
            SELECT w.area_id, w.area_level, w.metric, gs.month AS period,
                   (year(gs.month) * 12 + month(gs.month)) AS month_idx
            FROM (SELECT DISTINCT area_id, area_level, metric FROM windows) w
            CROSS JOIN anchor
            CROSS JOIN LATERAL (
                SELECT unnest(generate_series(a - INTERVAL 36 MONTH, a - INTERVAL 1 MONTH,
                                              INTERVAL 1 MONTH))::DATE AS month
            ) gs
        ),
        slopes AS (
            SELECT g.area_id, g.area_level, g.metric,
                   regr_slope(coalesce(m.value, 0), g.month_idx) AS slope36
            FROM grid g
            LEFT JOIN metrics m
              ON m.area_id = g.area_id AND m.area_level = g.area_level
             AND m.metric = g.metric AND m.period = g.period
            GROUP BY 1, 2, 3
        ),
        scored AS (
            SELECT
                w.*, s.slope36,
                CASE WHEN w.prior12 > 0 THEN (w.last12 - w.prior12) / w.prior12 END AS pct_change,
                (w.last12 + w.prior12) >= {MIN_EVENTS} AS rankable
            FROM windows w
            LEFT JOIN slopes s USING (area_id, area_level, metric)
        )
        SELECT
            area_id, area_level, metric, last12, prior12, pct_change, slope36,
            CASE WHEN rankable THEN
                (pct_change - avg(pct_change) FILTER (rankable) OVER (PARTITION BY area_level, metric))
                / nullif(stddev_samp(pct_change) FILTER (rankable) OVER (PARTITION BY area_level, metric), 0)
            END AS z,
            rankable, n_active_months, source, source_as_of,
            TIMESTAMPTZ '{computed_at}' AS computed_at,
            '{version}' AS pipeline_version
        FROM scored
        """
    )


def report(con) -> None:
    n, n_rankable = con.execute(
        "SELECT count(*), count(*) FILTER (rankable) FROM trajectory"
    ).fetchone()
    print(f"\n=== trajectory: {n:,} (area, metric) rows, {n_rankable:,} rankable ===")

    print("\n--- storied neighborhoods, per-dimension direction (eyeball validation) ---")
    print("    pct = trailing 12mo vs prior 12mo; z = vs all SF neighborhoods\n")
    header = f"  {'neighborhood':<32}" + "".join(f"{m.replace('threeoneone', '311'):>18}" for m in REPORT_METRICS)
    print(header)
    for hood in STORIED:
        rows = con.execute(
            """
            SELECT metric, pct_change, z FROM trajectory
            WHERE area_level = 'neighborhood' AND area_id = ? AND metric IN (SELECT unnest(?))
            """,
            [hood, REPORT_METRICS],
        ).fetchall()
        by_metric = {m: (p, z) for m, p, z in rows}
        cells = ""
        for m in REPORT_METRICS:
            p, z = by_metric.get(m, (None, None))
            cells += f"{'—':>18}" if p is None else f"{p:>+9.1%} z{z:>+5.1f}" if z is not None else f"{p:>+13.1%}    ·"
        print(f"  {hood:<32}{cells}")

    for metric in ["biz_openings", "permits_issued", "crime_incidents"]:
        rows = con.execute(
            """
            (SELECT area_id, pct_change, z FROM trajectory
             WHERE area_level = 'neighborhood' AND metric = ? AND rankable AND pct_change IS NOT NULL
             ORDER BY z DESC LIMIT 3)
            UNION ALL
            (SELECT area_id, pct_change, z FROM trajectory
             WHERE area_level = 'neighborhood' AND metric = ? AND rankable AND pct_change IS NOT NULL
             ORDER BY z ASC LIMIT 3)
            """,
            [metric, metric],
        ).fetchall()
        print(f"\n--- {metric}: strongest moves vs city (top 3 / bottom 3) ---")
        for area, pct, z in rows:
            print(f"  {area:<32}{pct:>+9.1%}   z{z:>+5.1f}")


def main() -> None:
    con = core.connect()
    build(con)
    report(con)
    con.close()


if __name__ == "__main__":
    main()
