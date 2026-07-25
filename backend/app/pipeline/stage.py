"""L1 staging: raw CSV snapshots -> typed, H3-indexed parquet.

One parquet per (source, source_as_of). Each source has a SQL spec that reads the raw
CSV as all-varchar (no sniffer surprises on multi-hundred-MB files) and produces typed
columns including `lat`/`lon`; the shared wrapper then adds `h3_9` plus the provenance
columns (`source`, `source_as_of`, `fetched_at`) from the snapshot's metadata.json.

try_strptime/try_cast/TRY() are used throughout: a malformed value becomes NULL rather
than failing a 700MB load. Coverage (how many rows got a date / a hex) is reported by
the build step, so silent nulling is visible rather than invisible.

Usage:
    python -m app.pipeline.stage                 # stage every finalized, unstaged snapshot
    python -m app.pipeline.stage --only datasf_permits
    python -m app.pipeline.stage --force         # restage even if the parquet exists
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

from app.pipeline import core


@dataclass(frozen=True)
class Spec:
    sql: str  # SELECT over 'src' producing typed columns incl. lat/lon
    filename: str = "rows.csv"
    fmt: str = "csv"  # 'csv' (read all-varchar) | 'parquet' (already typed)

# Date/point formats verified against the actual 2026-07-24 exports:
#   permits    dates 'YYYY/MM/DD hh:MM:SS AM', point 'POINT (lon lat)'
#   regbiz     dates 'MM/DD/YYYY',             point 'POINT (lon lat)'
#   crime      dates 'YYYY/MM/DD',             separate Latitude/Longitude
#   311        dates 'MM/DD/YYYY hh:MM:SS AM', separate Latitude/Longitude
#   evictions  dates 'MM/DD/YYYY',             point sparse (older rows have none)
TS_SLASH_12H = "%Y/%m/%d %I:%M:%S %p"
DATE_SLASH = "%Y/%m/%d"
DATE_US = "%m/%d/%Y"
TS_US_12H = "%m/%d/%Y %I:%M:%S %p"

SPECS: dict[str, Spec] = {
    "overture_places": Spec(
        filename="places.parquet",
        fmt="parquet",
        sql="""
        SELECT gers_id, name, category, confidence, source_dataset, lat, lon
        FROM src
        """,
    ),
    "datasf_permits": Spec(sql=f"""
        SELECT
            "Permit Number"                         AS permit_number,
            "Permit Type Definition"                AS permit_type,
            lower("Current Status")                 AS status,
            "Description"                           AS description,
            CAST(try_strptime(nullif("Filed Date", ''),     '{TS_SLASH_12H}') AS DATE) AS filed_date,
            CAST(try_strptime(nullif("Issued Date", ''),    '{TS_SLASH_12H}') AS DATE) AS issued_date,
            CAST(try_strptime(nullif("Completed Date", ''), '{TS_SLASH_12H}') AS DATE) AS completed_date,
            try_cast("Estimated Cost" AS DOUBLE)    AS estimated_cost,
            try_cast("Revised Cost" AS DOUBLE)      AS revised_cost,
            try_cast("Existing Units" AS DOUBLE)    AS existing_units,
            try_cast("Proposed Units" AS DOUBLE)    AS proposed_units,
            "Existing Use"                          AS existing_use,
            "Proposed Use"                          AS proposed_use,
            nullif("neighborhoods_analysis_boundaries", '') AS neighborhood,
            TRY(ST_Y(ST_GeomFromText(nullif("Location", '')))) AS lat,
            TRY(ST_X(ST_GeomFromText(nullif("Location", '')))) AS lon
        FROM src
    """),
    "datasf_business_locations": Spec(sql=f"""
        SELECT
            "UniqueID"                              AS unique_id,
            "Location Id"                           AS location_id,
            "Business Account Number"               AS business_account,
            "DBA Name"                              AS dba_name,
            nullif("Self-Reported NAICS Code", '')  AS naics_code,
            CAST(try_strptime(nullif("Business Start Date", ''), '{DATE_US}') AS DATE) AS business_start_date,
            CAST(try_strptime(nullif("Business End Date", ''),   '{DATE_US}') AS DATE) AS business_end_date,
            CAST(try_strptime(nullif("Location Start Date", ''), '{DATE_US}') AS DATE) AS location_start_date,
            CAST(try_strptime(nullif("Location End Date", ''),   '{DATE_US}') AS DATE) AS location_end_date,
            lower(coalesce(nullif("Administratively Closed", ''), '')) IN ('true', 'yes', 'y', '1')
                                                    AS administratively_closed,
            nullif("City", '')                      AS city,
            nullif("Neighborhoods - Analysis Boundaries", '') AS neighborhood,
            TRY(ST_Y(ST_GeomFromText(nullif("Business Location", '')))) AS lat,
            TRY(ST_X(ST_GeomFromText(nullif("Business Location", '')))) AS lon
        FROM src
    """),
    "datasf_crime": Spec(sql=f"""
        SELECT
            "Row ID"                                AS row_id,
            "Incident ID"                           AS incident_id,
            CAST(try_strptime(nullif("Incident Date", ''), '{DATE_SLASH}') AS DATE) AS incident_date,
            "Incident Category"                     AS category,
            "Incident Subcategory"                  AS subcategory,
            "Incident Description"                  AS description,
            "Resolution"                            AS resolution,
            nullif("Analysis Neighborhood", '')     AS neighborhood,
            try_cast(nullif("Latitude", '') AS DOUBLE)  AS lat,
            try_cast(nullif("Longitude", '') AS DOUBLE) AS lon
        FROM src
    """),
    "datasf_threeoneone": Spec(sql=f"""
        SELECT
            "CaseID"                                AS case_id,
            CAST(try_strptime(nullif("Opened", ''), '{TS_US_12H}') AS DATE) AS opened_date,
            CAST(try_strptime(nullif("Closed", ''), '{TS_US_12H}') AS DATE) AS closed_date,
            "Status"                                AS status,
            "Category"                              AS category,
            "Request Type"                          AS request_type,
            nullif("Analysis Neighborhood", '')     AS neighborhood,
            try_cast(nullif("Latitude", '') AS DOUBLE)  AS lat,
            try_cast(nullif("Longitude", '') AS DOUBLE) AS lon
        FROM src
    """),
    "datasf_evictions": Spec(sql=f"""
        SELECT
            "Eviction ID"                           AS eviction_id,
            "Address"                               AS address,
            CAST(try_strptime(nullif("File Date", ''), '{DATE_US}') AS DATE) AS file_date,
            lower("Non Payment") = 'true'           AS non_payment,
            lower("Breach") = 'true'                AS breach,
            lower("Nuisance") = 'true'              AS nuisance,
            lower("Illegal Use") = 'true'           AS illegal_use,
            lower("Owner Move In") = 'true'         AS owner_move_in,
            lower("Demolition") = 'true'            AS demolition,
            lower("Capital Improvement") = 'true'   AS capital_improvement,
            lower("Substantial Rehab") = 'true'     AS substantial_rehab,
            lower("Ellis Act WithDrawal") = 'true'  AS ellis_act_withdrawal,
            lower("Condo Conversion") = 'true'      AS condo_conversion,
            lower("Development") = 'true'           AS development,
            nullif("Neighborhoods - Analysis Boundaries", '') AS neighborhood,
            -- evictions' "Location" is a legacy '(lat, lon)' tuple; "Shape" is real WKT
            TRY(ST_Y(ST_GeomFromText(nullif("Shape", '')))) AS lat,
            TRY(ST_X(ST_GeomFromText(nullif("Shape", '')))) AS lon
        FROM src
    """),
    # Reference layer, not events: polygons kept as WKT for later hex attribution.
    "datasf_zoning": Spec(sql="""
        SELECT
            "zoning_sim"                            AS zoning_code,
            "districtname"                          AS district_name,
            "gen"                                   AS zoning_gen,
            "codesection"                           AS code_section,
            "the_geom"                              AS geom_wkt,
            CAST(NULL AS DOUBLE)                    AS lat,
            CAST(NULL AS DOUBLE)                    AS lon
        FROM src
    """),
}


def stage_snapshot(snap: core.RawSnapshot, *, force: bool = False) -> None:
    out_path = core.staged_path(snap.source, snap.source_as_of)
    if out_path.exists() and not force:
        print(f"[current] {snap.source} as_of {snap.source_as_of} already staged")
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # In-memory connection: staging is pure file->file, no need to touch canary.duckdb.
    import duckdb

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("INSTALL h3 FROM community; LOAD h3;")

    spec = SPECS[snap.source]
    raw_file = snap.dir / spec.filename
    reader = (
        f"read_csv('{raw_file}', header=true, all_varchar=true)"
        if spec.fmt == "csv"
        else f"read_parquet('{raw_file}')"
    )
    print(f"[stage] {snap.source} as_of {snap.source_as_of} <- {raw_file.name}")
    con.execute(f"CREATE TEMP VIEW src AS SELECT * FROM {reader}")
    # COPY can't be a prepared statement in DuckDB, so provenance values are inlined;
    # they come from our own snapshot registry/metadata, not user input.
    # Write to a temp name and rename on success: a failed COPY must never leave a
    # partial file that the idempotency check would mistake for a finished stage.
    tmp_path = out_path.with_suffix(".parquet.tmp")
    try:
        con.execute(
            f"""
            COPY (
                SELECT
                    s.*,
                    CASE
                        WHEN s.lat IS NOT NULL AND s.lon IS NOT NULL
                             AND s.lat BETWEEN -90 AND 90 AND s.lon BETWEEN -180 AND 180
                        THEN h3_latlng_to_cell_string(s.lat, s.lon, {core.H3_RES})
                    END AS h3_9,
                    '{snap.source}' AS source,
                    DATE '{snap.source_as_of}' AS source_as_of,
                    TIMESTAMPTZ '{snap.fetched_at}' AS fetched_at
                FROM ({spec.sql}) s
            ) TO '{tmp_path}' (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )
        tmp_path.replace(out_path)
    finally:
        tmp_path.unlink(missing_ok=True)
    n, n_hex = con.execute(
        f"SELECT count(*), count(h3_9) FROM read_parquet('{out_path}')"
    ).fetchone()
    print(f"        {n:,} rows ({n_hex / n:.1%} h3-indexed) -> {out_path.relative_to(core.DATA_DIR)}")
    con.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="stage only this source slug")
    parser.add_argument("--force", action="store_true", help="restage even if parquet exists")
    args = parser.parse_args()

    sources = [args.only] if args.only else list(SPECS)
    if args.only and args.only not in SPECS:
        raise SystemExit(f"No staging spec for {args.only!r}. Options: {list(SPECS)}")

    for source in sources:
        snaps = core.finalized_snapshots(source)
        if not snaps:
            print(f"[skip] {source}: no finalized raw snapshot yet")
            continue
        for snap in snaps:
            stage_snapshot(snap, force=args.force)


if __name__ == "__main__":
    main()
