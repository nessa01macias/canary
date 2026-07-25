"""Build the spatial spine: an H3 res-9 registry of San Francisco with crosswalks.

H3 hexes are the atomic compute unit (metro-agnostic, hierarchical -- adding a second
city changes no schema). Neighborhood names exist for DISPLAY and for joining sources
that only carry a neighborhood string; computation happens on hexes.

v1 boundary source: the Inside Airbnb neighbourhoods.geojson already in raw/, whose
names match DataSF's 'Analysis Neighborhoods' taxonomy (verified: Castro/Upper Market,
Western Addition, ... appear identically in both). Swap in DataSF's official Analysis
Neighborhoods dataset later without changing this table's shape.

Polyfill uses H3's center-containment rule, so each hex lands in exactly one
(non-overlapping) neighborhood polygon; rare boundary duplicates are deduped
deterministically via min().

Usage:
    python -m app.pipeline.areas
"""

from __future__ import annotations

import json

from app.pipeline import core


def find_boundaries_geojson():
    candidates = sorted(core.RAW_DIR.glob("insideairbnb/*/neighbourhoods.geojson"))
    if not candidates:
        raise SystemExit("No neighbourhoods.geojson found under raw/insideairbnb/*/")
    return candidates[-1]


def main() -> None:
    geojson_path = find_boundaries_geojson()
    out_path = core.STAGED_DIR / "areas.parquet"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    import duckdb

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("INSTALL h3 FROM community; LOAD h3;")

    con.execute(
        f"""
        COPY (
            WITH parts AS (
                SELECT neighbourhood, UNNEST(ST_Dump(geom), recursive := true)
                FROM ST_Read('{geojson_path}')
            ),
            cells AS (
                SELECT
                    neighbourhood,
                    UNNEST(h3_polygon_wkt_to_cells_string(ST_AsText(geom), {core.H3_RES})) AS h3_9
                FROM parts
            )
            SELECT
                h3_9,
                h3_cell_to_parent(h3_9, 8) AS h3_8,
                h3_cell_to_parent(h3_9, 7) AS h3_7,
                min(neighbourhood)         AS neighborhood
            FROM cells
            GROUP BY h3_9
        ) TO '{out_path}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """
    )
    n, n_hoods = con.execute(
        f"SELECT count(*), count(DISTINCT neighborhood) FROM read_parquet('{out_path}')"
    ).fetchone()
    print(f"[areas] {n:,} res-{core.H3_RES} hexes across {n_hoods} neighborhoods -> {out_path.relative_to(core.DATA_DIR)}")

    provenance = {
        "boundaries_source": str(geojson_path.relative_to(core.DATA_DIR)),
        "note": (
            "Neighborhood names follow DataSF 'Analysis Neighborhoods' taxonomy via "
            "Inside Airbnb's SF boundary file. Hexes assigned by H3 center-containment."
        ),
        "h3_resolution": core.H3_RES,
    }
    (core.STAGED_DIR / "areas.provenance.json").write_text(json.dumps(provenance, indent=2))
    con.close()


if __name__ == "__main__":
    main()
