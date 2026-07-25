"""L2 + L3: canonical events/places/areas and the long metrics table, in canary.duckdb.

Full rebuild every run (CREATE OR REPLACE from the latest staged parquet per source) --
at this scale a rebuild is seconds, and it keeps the pipeline honest: L0/L1 are the
only stateful layers, everything here is derived and reproducible.

Canonical model:
  places   interval entities from the business registry (exact open/close dates)
  events   one unified stream: everything that happened, where, and when -- with the
           source's own freshness (source_as_of) carried on every row
  areas    H3 res-9 registry + neighborhood crosswalk (from app.pipeline.areas)
  metrics  (area_id, area_level, metric, period, value, n) monthly, two area levels:
           'h3_9' (restricted to registry hexes) and 'neighborhood' (from the source's
           own neighborhood column, independent of the hex crosswalk)

Trajectory = window functions over metrics.period; the sanity report at the end prints
trailing-12-months vs the 12 before as a first eyeball check.

Known v1 caveats (deliberate, documented rather than hidden):
  - Business close dates lag reality (deregistration lag) -> recent closings undercount.
    Administrative closures are excluded from close counts (flag='administrative').
  - Crime = incident REPORTS (2018+ dataset); 311 = complaint propensity, not ground truth.
  - Permit description parsing (LLM extraction of stories/units/use) not yet done.

Usage:
    python -m app.pipeline.build
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.pipeline import core, crime_categories

EVENT_FLOOR = "DATE '1990-01-01'"  # regbiz backfill reaches decades; bound the grid

# metric name -> (event filter, aggregate expression)
METRICS: list[tuple[str, str, str]] = [
    ("permits_filed", "event_type = 'permit_filed'", "count(*)"),
    ("permits_issued", "event_type = 'permit_issued'", "count(*)"),
    ("permit_cost_issued_usd", "event_type = 'permit_issued'", "sum(value)"),
    ("units_approved_net", "event_type = 'permit_issued'", "sum(units_delta)"),
    ("biz_openings", "event_type = 'place_opened'", "count(*)"),
    ("biz_closings", "event_type = 'place_closed' AND coalesce(flag, '') <> 'administrative'", "count(*)"),
    ("crime_incidents", "event_type = 'crime_incident'", "count(*)"),
    # split per crime_categories.py: victim trends are the user-facing signal,
    # enforcement trends measure policing intensity (VALIDATION.md, Tenderloin)
    (
        "crime_victim_reported",
        f"event_type = 'crime_incident' AND detail IN {crime_categories.sql_in(crime_categories.VICTIM_REPORTED)}",
        "count(*)",
    ),
    (
        "crime_enforcement",
        f"event_type = 'crime_incident' AND detail IN {crime_categories.sql_in(crime_categories.ENFORCEMENT_DRIVEN)}",
        "count(*)",
    ),
    ("evictions_filed", "event_type = 'eviction_notice'", "count(*)"),
    ("threeoneone_cases", "event_type = 'threeoneone_case'", "count(*)"),
    ("threeoneone_noise", "event_type = 'threeoneone_case' AND detail ILIKE '%noise%'", "count(*)"),
    # excludes the 'other_excessive_noise' catch-all: a Mar-2026 mobile-app flow change
    # funnels reports into it (+145% while Phone channel +15%) -- propensity artifact,
    # not conditions; the specific subtypes below are the claimable noise signal
    (
        "threeoneone_noise_specific",
        "event_type = 'threeoneone_case' AND detail ILIKE '%noise%' AND coalesce(flag, '') <> 'other_excessive_noise'",
        "count(*)",
    ),
    ("threeoneone_cleaning", "event_type = 'threeoneone_case' AND detail = 'Street and Sidewalk Cleaning'", "count(*)"),
    ("threeoneone_encampment", "event_type = 'threeoneone_case' AND detail ILIKE '%encampment%'", "count(*)"),
]


def _view(con, name: str, source: str) -> bool:
    """Point a view at the latest staged parquet for `source`; False if not staged yet."""
    path = core.latest_staged(source)
    if path is None:
        print(f"[skip] {source}: not staged yet")
        return False
    con.execute(f"CREATE OR REPLACE TEMP VIEW {name} AS SELECT * FROM read_parquet('{path}')")
    return True


def build(con) -> None:
    have = {
        "permits": _view(con, "sv_permits", "datasf_permits"),
        "regbiz": _view(con, "sv_regbiz", "datasf_business_locations"),
        "crime": _view(con, "sv_crime", "datasf_crime"),
        "threeoneone": _view(con, "sv_311", "datasf_threeoneone"),
        "evictions": _view(con, "sv_evictions", "datasf_evictions"),
    }

    areas_path = core.STAGED_DIR / "areas.parquet"
    if not areas_path.exists():
        raise SystemExit("areas.parquet missing -- run `python -m app.pipeline.areas` first")
    con.execute(f"CREATE OR REPLACE TABLE areas AS SELECT * FROM read_parquet('{areas_path}')")

    # --- places: interval entities from the business registry --------------------
    if have["regbiz"]:
        con.execute(
            """
            CREATE OR REPLACE TABLE places AS
            SELECT
                unique_id            AS place_key,
                'sf_regbiz'          AS source,
                location_id          AS source_id,
                dba_name             AS name,
                naics_code,
                lat, lon, h3_9, neighborhood,
                location_start_date  AS active_from,
                location_end_date    AS active_to,
                administratively_closed,
                'exact'              AS from_precision,
                source_as_of, fetched_at
            FROM sv_regbiz
            WHERE location_start_date IS NOT NULL
            """
        )

    # --- events: the unified stream ----------------------------------------------
    parts = []
    if have["permits"]:
        for event_type, date_col in [
            ("permit_filed", "filed_date"),
            ("permit_issued", "issued_date"),
            ("permit_completed", "completed_date"),
        ]:
            parts.append(
                f"""
                SELECT 'datasf_permits' AS source, '{event_type}' AS event_type,
                       {date_col} AS event_time, h3_9, lat, lon, neighborhood,
                       permit_type AS detail, CAST(NULL AS VARCHAR) AS flag,
                       coalesce(revised_cost, estimated_cost) AS value,
                       (coalesce(proposed_units, 0) - coalesce(existing_units, 0)) AS units_delta,
                       permit_number AS record_key, source_as_of
                FROM sv_permits WHERE {date_col} IS NOT NULL
                """
            )
    if have["regbiz"]:
        parts.append(
            """
            SELECT 'datasf_business_locations', 'place_opened',
                   active_from, h3_9, lat, lon, neighborhood,
                   naics_code, NULL, NULL, NULL, place_key, source_as_of
            FROM places
            """
        )
        parts.append(
            """
            SELECT 'datasf_business_locations', 'place_closed',
                   active_to, h3_9, lat, lon, neighborhood,
                   naics_code,
                   CASE WHEN administratively_closed THEN 'administrative' END,
                   NULL, NULL, place_key, source_as_of
            FROM places WHERE active_to IS NOT NULL
            """
        )
    if have["crime"]:
        parts.append(
            """
            SELECT 'datasf_crime', 'crime_incident',
                   incident_date, h3_9, lat, lon, neighborhood,
                   category, NULL, NULL, NULL, row_id, source_as_of
            FROM sv_crime WHERE incident_date IS NOT NULL
            """
        )
    if have["threeoneone"]:
        parts.append(
            """
            SELECT 'datasf_threeoneone', 'threeoneone_case',
                   opened_date, h3_9, lat, lon, neighborhood,
                   category, request_type, NULL, NULL, case_id, source_as_of
            FROM sv_311 WHERE opened_date IS NOT NULL
            """
        )
    if have["evictions"]:
        parts.append(
            """
            SELECT 'datasf_evictions', 'eviction_notice',
                   file_date, h3_9, lat, lon, neighborhood,
                   CASE
                       WHEN ellis_act_withdrawal THEN 'ellis_act'
                       WHEN owner_move_in        THEN 'owner_move_in'
                       WHEN demolition           THEN 'demolition'
                       WHEN development          THEN 'development'
                       WHEN capital_improvement  THEN 'capital_improvement'
                       WHEN substantial_rehab    THEN 'substantial_rehab'
                       WHEN condo_conversion     THEN 'condo_conversion'
                       WHEN non_payment          THEN 'non_payment'
                       WHEN breach               THEN 'breach'
                       WHEN nuisance             THEN 'nuisance'
                       WHEN illegal_use          THEN 'illegal_use'
                       ELSE 'other'
                   END, NULL, NULL, NULL, eviction_id, source_as_of
            FROM sv_evictions WHERE file_date IS NOT NULL
            """
        )
    con.execute(f"CREATE OR REPLACE TABLE events AS {' UNION ALL '.join(parts)}")

    # --- metrics: monthly, two area levels ----------------------------------------
    version = core.pipeline_version()
    computed_at = datetime.now(timezone.utc).isoformat()
    metric_parts = []
    for metric, where, agg in METRICS:
        for area_level, area_expr, area_filter in [
            # hex metrics restricted to the SF registry (drops out-of-town noise)
            ("h3_9", "e.h3_9", "e.h3_9 IN (SELECT h3_9 FROM areas)"),
            # neighborhood metrics from the source's own column, crosswalk-independent
            ("neighborhood", "e.neighborhood", "e.neighborhood IS NOT NULL"),
        ]:
            metric_parts.append(
                f"""
                SELECT {area_expr} AS area_id, '{area_level}' AS area_level,
                       '{metric}' AS metric,
                       date_trunc('month', e.event_time)::DATE AS period,
                       CAST({agg} AS DOUBLE) AS value, count(*) AS n,
                       any_value(e.source) AS source, max(e.source_as_of) AS source_as_of
                FROM events e
                WHERE ({where}) AND {area_filter}
                  AND e.event_time >= {EVENT_FLOOR}
                  AND e.event_time < date_trunc('month', current_date)
                GROUP BY 1, 4
                """
            )
    con.execute(
        f"""
        CREATE OR REPLACE TABLE metrics AS
        SELECT *, TIMESTAMPTZ '{computed_at}' AS computed_at, '{version}' AS pipeline_version
        FROM ({' UNION ALL '.join(metric_parts)})
        """
    )


def report(con) -> None:
    print("\n=== canary.duckdb build report ===")
    for table in ["areas", "places", "events", "metrics"]:
        n = con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        print(f"  {table:<8} {n:>12,} rows")

    print("\n--- events by type (coverage check: nulled dates/points show up here) ---")
    rows = con.execute(
        """
        SELECT event_type, count(*) AS n, min(event_time), max(event_time),
               round(100.0 * count(h3_9) / count(*), 1) AS pct_hex
        FROM events GROUP BY 1 ORDER BY n DESC
        """
    ).fetchall()
    print(f"  {'event_type':<22}{'count':>12}  {'first':<12}{'last':<12}{'% hex':>7}")
    for t, n, lo, hi, pct in rows:
        print(f"  {t:<22}{n:>12,}  {str(lo):<12}{str(hi):<12}{pct:>6.1f}%")

    print("\n--- first trajectory read: trailing 12mo vs the 12mo before ---")
    print("    (neighborhood level; biz close-lag caveat applies to biz_* recents)\n")
    rows = con.execute(
        """
        WITH windows AS (
            SELECT area_id, metric,
                sum(value) FILTER (period >= date_trunc('month', current_date) - INTERVAL 12 MONTH) AS last12,
                sum(value) FILTER (period >= date_trunc('month', current_date) - INTERVAL 24 MONTH
                               AND period <  date_trunc('month', current_date) - INTERVAL 12 MONTH) AS prior12
            FROM metrics
            WHERE area_level = 'neighborhood'
              AND metric IN ('permits_issued', 'biz_openings', 'biz_closings',
                             'evictions_filed', 'crime_incidents')
            GROUP BY 1, 2
        )
        SELECT metric,
               sum(last12)::BIGINT AS city_last12, sum(prior12)::BIGINT AS city_prior12,
               round(100.0 * (sum(last12) - sum(prior12)) / nullif(sum(prior12), 0), 1) AS city_pct
        FROM windows GROUP BY 1 ORDER BY 1
        """
    ).fetchall()
    print(f"  {'metric':<18}{'last 12mo':>12}{'prior 12mo':>12}{'Δ%':>8}")
    for m, a, b, pct in rows:
        print(f"  {m:<18}{a:>12,}{b:>12,}{(str(pct) + '%') if pct is not None else '—':>8}")

    print("\n--- neighborhoods by net business churn, trailing 12mo (top/bottom 5) ---\n")
    rows = con.execute(
        """
        WITH w AS (
            SELECT area_id,
                sum(value) FILTER (metric = 'biz_openings') AS opens,
                sum(value) FILTER (metric = 'biz_closings') AS closes
            FROM metrics
            WHERE area_level = 'neighborhood'
              AND period >= date_trunc('month', current_date) - INTERVAL 12 MONTH
            GROUP BY 1
        ),
        ranked AS (
            SELECT area_id, opens::BIGINT AS opens, closes::BIGINT AS closes,
                   (opens - closes)::BIGINT AS net,
                   row_number() OVER (ORDER BY opens - closes DESC) AS rk_top,
                   row_number() OVER (ORDER BY opens - closes ASC)  AS rk_bot
            FROM w WHERE opens IS NOT NULL
        )
        SELECT area_id, opens, closes, net FROM ranked
        WHERE rk_top <= 5 OR rk_bot <= 5 ORDER BY net DESC
        """
    ).fetchall()
    print(f"  {'neighborhood':<32}{'opens':>8}{'closes':>8}{'net':>8}")
    for hood, opens, closes, net in rows:
        print(f"  {hood:<32}{opens:>8,}{closes:>8,}{net:>+8,}")


def main() -> None:
    con = core.connect()
    build(con)
    report(con)
    con.close()
    print(f"\nDone -> {core.DB_PATH.relative_to(core.BACKEND_DIR)}")


if __name__ == "__main__":
    main()
