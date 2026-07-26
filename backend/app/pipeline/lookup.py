"""The magic-moment primitive: one address -> what's changing within walking distance.

This is the $29 report's core query (and the future API response) in CLI form:
  - approved & pending construction within RADIUS_M, with cost/units/description,
    each row citable (permit number + source + source_as_of)
  - business openings/closings nearby, trailing 12 months
  - the surrounding neighborhood's per-dimension trajectory

Geocoding uses the US Census Bureau geocoder: free, keyless, public infrastructure --
consistent with the open-government data stack (no Google/Yelp ToS entanglement).

All reads are read-only; safe to run while the API server or pipeline is up.

Usage:
    python -m app.pipeline.lookup "600 Valencia St, San Francisco, CA"
    python -m app.pipeline.lookup "..." --radius 300 --months 24
"""

from __future__ import annotations

import argparse

import requests

from app.pipeline import core

CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"


def geocode(address: str) -> tuple[float, float, str]:
    """Address -> (lat, lon, matched_address) via the Census geocoder."""
    resp = requests.get(
        CENSUS_GEOCODER,
        params={"address": address, "benchmark": "Public_AR_Current", "format": "json"},
        timeout=30,
    )
    resp.raise_for_status()
    matches = resp.json().get("result", {}).get("addressMatches", [])
    if not matches:
        raise SystemExit(f"Census geocoder found no match for: {address!r}")
    m = matches[0]
    return m["coordinates"]["y"], m["coordinates"]["x"], m["matchedAddress"]


def lookup(address: str, radius_m: int, months: int) -> None:
    lat, lon, matched = geocode(address)
    con = core.connect(read_only=True)

    hood, hex_id = con.execute(
        f"""
        WITH here AS (SELECT h3_latlng_to_cell_string({lat}, {lon}, {core.H3_RES}) AS h)
        SELECT a.neighborhood, here.h FROM here LEFT JOIN areas a ON a.h3_9 = here.h
        """
    ).fetchone()
    print(f"\n{matched}")
    print(f"({lat:.6f}, {lon:.6f})  hex {hex_id}  neighborhood: {hood or 'outside registry'}")

    # ring of hexes as a cheap index, exact haversine as the precise filter
    con.execute(
        f"""
        CREATE TEMP VIEW nearby_permits AS
        WITH ring AS (SELECT unnest(h3_grid_disk(h3_latlng_to_cell_string({lat}, {lon}, {core.H3_RES}), 2)) AS h3_9)
        SELECT p.*,
               -- DuckDB ST_Distance_Sphere follows EPSG:4326 authority axis order
               -- (latitude first); passing (lon, lat) squashes rings into ~395m x
               -- ~933m ellipses at SF latitude. Found by the independent benchmark
               -- verification (RESEARCH.md, erratum in the verification section).
               ST_Distance_Sphere(ST_Point(p.lat, p.lon), ST_Point({lat}, {lon})) AS dist_m
        FROM read_parquet('{core.latest_staged("datasf_permits")}') p
        JOIN ring USING (h3_9)
        WHERE ST_Distance_Sphere(ST_Point(p.lat, p.lon), ST_Point({lat}, {lon})) <= {radius_m}
        -- one row per permit: the source repeats permits (e.g. one row per address range)
        QUALIFY row_number() OVER (PARTITION BY permit_number ORDER BY dist_m) = 1
        """
    )

    print(f"\n--- construction within {radius_m}m, last {months} months (issued or newly filed) ---")
    rows = con.execute(
        f"""
        SELECT
            round(dist_m)                                   AS m,
            coalesce(issued_date, filed_date)               AS d,
            CASE WHEN issued_date IS NOT NULL THEN 'ISSUED' ELSE 'filed' END AS st,
            coalesce(revised_cost, estimated_cost)          AS cost,
            (coalesce(proposed_units, 0) - coalesce(existing_units, 0)) AS du,
            left(regexp_replace(description, '\\s+', ' ', 'g'), 68) AS descr,
            permit_number, source_as_of
        FROM nearby_permits
        WHERE coalesce(issued_date, filed_date) >= current_date - INTERVAL {months} MONTH
        ORDER BY coalesce(cost, 0) DESC
        LIMIT 12
        """
    ).fetchall()
    if not rows:
        print("  none found")
    for m, d, st, cost, du, descr, permit, as_of in rows:
        cost_s = f"${cost:,.0f}" if cost else "—"
        du_s = f"{du:+.0f} units" if du else ""
        print(f"  {m:>4.0f}m  {d}  {st:<6} {cost_s:>12}  {du_s:<10} {descr}")
        print(f"         [permit {permit}, DataSF as of {as_of}]")

    total_cost, total_units, n_permits = con.execute(
        f"""
        SELECT sum(coalesce(revised_cost, estimated_cost)),
               sum(coalesce(proposed_units, 0) - coalesce(existing_units, 0)), count(*)
        FROM nearby_permits
        WHERE coalesce(issued_date, filed_date) >= current_date - INTERVAL {months} MONTH
        """
    ).fetchone()
    print(
        f"\n  TOTAL within {radius_m}m / {months}mo: {n_permits} permits, "
        f"~${(total_cost or 0):,.0f} construction value, {(total_units or 0):+.0f} housing units"
    )

    print(f"\n--- businesses within {radius_m}m, trailing 12 months ---")
    opens, closes, active = con.execute(
        f"""
        WITH ring AS (SELECT unnest(h3_grid_disk(h3_latlng_to_cell_string({lat}, {lon}, {core.H3_RES}), 2)) AS h3_9),
        nearby AS (
            SELECT p.* FROM places p JOIN ring USING (h3_9)
            WHERE ST_Distance_Sphere(ST_Point(p.lat, p.lon), ST_Point({lat}, {lon})) <= {radius_m}
        )
        SELECT
            count(*) FILTER (active_from >= current_date - INTERVAL 12 MONTH),
            count(*) FILTER (active_to >= current_date - INTERVAL 12 MONTH
                             AND active_to <= current_date AND NOT administratively_closed),
            count(*) FILTER (active_to IS NULL)
        FROM nearby
        """
    ).fetchone()
    print(f"  {active:,} active registered businesses; last 12mo: +{opens} opened, -{closes} closed")

    if hood:
        print(f"\n--- {hood}: per-dimension trajectory (12mo vs prior 12mo, z vs city) ---")
        rows = con.execute(
            """
            SELECT metric, last12, prior12, pct_change, z FROM trajectory
            WHERE area_level = 'neighborhood' AND area_id = ? AND rankable
            ORDER BY metric
            """,
            [hood],
        ).fetchall()
        for metric, last12, prior12, pct, z in rows:
            pct_s = f"{pct:+.1%}" if pct is not None else "—"
            z_s = f"z{z:+.1f}" if z is not None else ""
            print(f"  {metric:<26}{last12:>9,.0f} vs {prior12:>9,.0f}   {pct_s:>8} {z_s}")

    con.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("address", help='e.g. "600 Valencia St, San Francisco, CA"')
    parser.add_argument("--radius", type=int, default=300, help="meters (default 300)")
    parser.add_argument("--months", type=int, default=24, help="lookback (default 24)")
    args = parser.parse_args()
    lookup(args.address, args.radius, args.months)


if __name__ == "__main__":
    main()
