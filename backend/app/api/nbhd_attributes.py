"""Per-neighborhood attribute signals, precomputed from L0 raw snapshots.

Grounds the preference chips that need no time-series staging — computed straight
from the dated raw snapshots (data/raw/*) into one processed JSON that the serving
layer merges into /api/sf/neighborhoods properties. Each attribute carries its
source key and source_as_of (the snapshot's own date), so provenance survives all
the way to the map.

This deliberately does NOT touch canary.duckdb or app/pipeline — reference-style
attributes (how many trees / transit stops / grocery stores are HERE) don't need
the event pipeline; recomputing them from the newest snapshot on each run IS the
correct freshness model. When the pipeline later stages these sources properly,
the serve layer can switch to areas-table columns without the frontend noticing.

Usage:
    python -m app.api.nbhd_attributes          # build data/processed/neighborhood_attributes.json
"""

from __future__ import annotations

import glob
import json
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import requests

BACKEND_DIR = Path(__file__).resolve().parents[2]
RAW = BACKEND_DIR / "data" / "raw"
PROCESSED = BACKEND_DIR / "data" / "processed"
OUT_PATH = PROCESSED / "neighborhood_attributes.json"
NBHD_GEOJSON_PATH = PROCESSED / "sf_neighborhoods.geojson"

# Same export sf_live.py serves the frontend from — SF Analysis Neighborhoods (41).
NBHD_GEOJSON_URL = "https://data.sfgov.org/api/geospatial/j2bu-swwd?method=export&format=GeoJSON"

# SF bbox for filtering statewide point files (GTFS stops, TRI).
SF = {"xmin": -122.55, "xmax": -122.35, "ymin": 37.70, "ymax": 37.84}


def _latest_snapshot(source: str) -> tuple[Path, str] | None:
    """Newest snapshot dir for a source + its as_of date (the dir name)."""
    dirs = sorted(glob.glob(str(RAW / source / "*")))
    for d in reversed(dirs):
        if (Path(d) / "metadata.json").exists():
            return Path(d), Path(d).name
    return None


def _ensure_neighborhoods() -> Path:
    if not NBHD_GEOJSON_PATH.exists():
        resp = requests.get(NBHD_GEOJSON_URL, timeout=60)
        resp.raise_for_status()
        PROCESSED.mkdir(parents=True, exist_ok=True)
        NBHD_GEOJSON_PATH.write_bytes(resp.content)
    return NBHD_GEOJSON_PATH


def build() -> dict:
    nbhd_path = _ensure_neighborhoods()
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial; SET enable_progress_bar=false;")
    con.execute(
        f"""
        CREATE TABLE nbhd AS
        -- area via CA Albers (EPSG:3310, meters); ST_Area_Spheroid NaN'd on these polygons
        SELECT nhood, geom,
               ST_Area(ST_Transform(geom, 'EPSG:4326', 'EPSG:3310', always_xy := true)) / 1e6 AS area_km2
        FROM ST_Read('{nbhd_path}')
        """
    )
    names = [r[0] for r in con.execute("SELECT nhood FROM nbhd").fetchall()]
    attrs: dict[str, dict[str, float | None]] = {n: {} for n in names}
    meta: dict[str, dict] = {}
    notes: list[str] = []

    def record(attr: str, rows: list[tuple], source: str, as_of: str, note: str) -> None:
        got = {r[0]: r[1] for r in rows}
        for n in names:
            attrs[n][attr] = got.get(n, 0)
        meta[attr] = {"source": source, "source_as_of": as_of, "note": note}
        print(f"  [ok] {attr:24} ({len(got)}/{len(names)} nbhds non-zero) src={source}@{as_of}")

    def points_per_nbhd(attr, source, sql_pts, note, per_km2=False):
        snap = _latest_snapshot(source)
        if not snap:
            notes.append(f"{attr}: no snapshot for {source}"); return
        d, as_of = snap
        value = "count(*) / any_value(n.area_km2)" if per_km2 else "count(*)"
        rows = con.execute(
            f"""
            WITH pts AS ({sql_pts.format(dir=d)})
            SELECT n.nhood, {value} AS v
            FROM pts p JOIN nbhd n ON ST_Contains(n.geom, ST_Point(p.lon, p.lat))
            GROUP BY n.nhood
            """
        ).fetchall()
        record(attr, rows, source, as_of, note)

    # --- point-count attributes (spatial join) --------------------------------
    points_per_nbhd(
        "trees_per_km2", "datasf_street_trees",
        'SELECT Longitude AS lon, Latitude AS lat FROM read_csv_auto("{dir}/rows.csv", ignore_errors=true) '
        "WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL",
        "City street-tree inventory, trees per km²", per_km2=True,
    )
    points_per_nbhd(
        "transit_stops", "gtfs_ca_statewide_calitp",
        'SELECT DISTINCT stop_id, any_value(stop_lon) AS lon, any_value(stop_lat) AS lat '
        'FROM read_csv_auto("{dir}/stops.csv", ignore_errors=true) '
        f"WHERE stop_lat BETWEEN {SF['ymin']} AND {SF['ymax']} AND stop_lon BETWEEN {SF['xmin']} AND {SF['xmax']} "
        "GROUP BY stop_id",
        "Distinct transit stops (Cal-ITP statewide GTFS)",
    )
    points_per_nbhd(
        "cannabis_retailers", "ca_cannabis_retailers",
        """SELECT premiseLongitude AS lon, premiseLatitude AS lat
           FROM (SELECT unnest(data) AS r FROM read_json_auto('{dir}/dcc_retailers_ca.json'))
           , LATERAL (SELECT r.premiseLongitude, r.premiseLatitude) t
           WHERE premiseLatitude IS NOT NULL""",
        "Licensed cannabis retailers (DCC, daily API)",
    )
    points_per_nbhd(
        # EPA stores pref_longitude UNSIGNED (west-positive) -> negate; fac_* is DMS, skip it.
        "tri_facilities", "epa_tri_ca",
        """SELECT -pref_longitude AS lon, pref_latitude AS lat
           FROM read_json_auto('{dir}/tri_facilities_ca.json')
           WHERE pref_latitude IS NOT NULL AND pref_longitude IS NOT NULL""",
        "EPA TRI toxic-release facilities in the neighborhood (higher = more industrial)",
    )
    points_per_nbhd(
        "grocery_stores", "fsq_os_places",
        """SELECT lon, lat FROM read_parquet('{dir}/places_sf.parquet')
           WHERE date_closed IS NULL AND len(fsq_category_labels) > 0
             AND lower(fsq_category_labels[1]) LIKE '%grocer%'""",
        "Open grocery stores (Foursquare OS Places, latest snapshot)",
    )

    # --- polygon overlays ------------------------------------------------------
    snap = _latest_snapshot("fema_nfhl_flood")
    if snap:
        d, as_of = snap
        rows = con.execute(
            f"""
            -- union first: overlapping DFIRM panels would double-count area
            WITH fld AS (
              SELECT ST_Union_Agg(geom) AS geom
              FROM ST_Read('{d}/flood_zones.geojson') WHERE SFHA_TF = 'T'
            )
            SELECT n.nhood,
                   least(1.0,
                     ST_Area(ST_Transform(ST_Intersection(n.geom, f.geom),
                                          'EPSG:4326', 'EPSG:3310', always_xy := true)) / 1e6
                     / n.area_km2) AS v
            FROM nbhd n, fld f
            WHERE ST_Intersects(n.geom, f.geom)
            """
        ).fetchall()
        record("flood_zone_share", rows, "fema_nfhl_flood", as_of,
               "Share of area inside FEMA Special Flood Hazard Area (SFHA)")

    snap = _latest_snapshot("datasf_sfmta_projects")
    if snap:
        d, as_of = snap
        rows = con.execute(
            f"""
            WITH prj AS (SELECT geom FROM ST_Read('{d}/rows.geojson'))
            SELECT n.nhood, count(*) AS v
            FROM nbhd n JOIN prj p ON ST_Intersects(n.geom, p.geom)
            GROUP BY n.nhood
            """
        ).fetchall()
        record("sfmta_projects", rows, "datasf_sfmta_projects", as_of,
               "SFMTA transit/street projects intersecting the neighborhood")

    snap = _latest_snapshot("datasf_rpp_zones")
    if snap:
        d, as_of = snap
        rows = con.execute(
            f"""
            WITH rpp AS (
              SELECT ST_Centroid(geom) AS pt FROM ST_Read('{d}/rows.geojson')
              WHERE rppeligib IS NOT NULL AND trim(rppeligib) <> ''
            )
            SELECT n.nhood, count(*) AS v
            FROM rpp r JOIN nbhd n ON ST_Contains(n.geom, r.pt)
            GROUP BY n.nhood
            """
        ).fetchall()
        record("rpp_parcels", rows, "datasf_rpp_zones", as_of,
               "Parcels eligible for a residential parking-permit zone")

    # --- tabular attributes (dataset carries its own neighborhood column) -------
    snap = _latest_snapshot("datasf_commercial_vacancy")
    if snap:
        d, as_of = snap
        rows = con.execute(
            f"""
            WITH v AS (
              SELECT analysis_neighborhood AS nhood, vacant
              FROM read_csv_auto('{d}/rows.csv', ignore_errors=true)
              WHERE taxyear = (SELECT max(taxyear) FROM read_csv_auto('{d}/rows.csv', ignore_errors=true))
                AND analysis_neighborhood IS NOT NULL
            )
            SELECT nhood, avg(CASE WHEN lower(CAST(vacant AS VARCHAR)) IN ('true','t','1','yes') THEN 1.0 ELSE 0.0 END) AS v
            FROM v GROUP BY nhood
            """
        ).fetchall()
        record("storefront_vacancy_rate", rows, "datasf_commercial_vacancy", as_of,
               "Share of taxable commercial spaces reported vacant, latest tax year (Prop-D roll)")

    snap = _latest_snapshot("datasf_fire_ems_calls")
    if snap:
        d, as_of = snap
        rows = con.execute(
            f"""
            WITH calls AS (
              -- read_csv_auto already parses these as TIMESTAMP; the NAME column is
              -- the (sic) triple-o "Neighborhooods" one ("Analysis Neighborhoods" = numeric id)
              SELECT "Neighborhooods - Analysis Boundaries" AS nhood,
                     epoch("On Scene DtTm" - "Received DtTm") / 60.0 AS mins,
                     "Received DtTm" AS ts
              FROM read_csv_auto('{d}/rows.csv', ignore_errors=true)
              WHERE "On Scene DtTm" IS NOT NULL AND "Received DtTm" IS NOT NULL
                AND "Neighborhooods - Analysis Boundaries" IS NOT NULL
            )
            SELECT nhood, median(mins) AS v
            FROM calls
            WHERE mins BETWEEN 0 AND 60
              AND ts >= (SELECT max(ts) FROM calls) - INTERVAL 12 MONTH
            GROUP BY nhood
            """
        ).fetchall()
        # dataset uses the same analysis-neighborhood names; unmatched stay None (not 0 — 0 mins would lie)
        got = {r[0]: r[1] for r in rows}
        for n in names:
            attrs[n]["ems_response_median_mins"] = got.get(n)
        meta["ems_response_median_mins"] = {
            "source": "datasf_fire_ems_calls", "source_as_of": as_of,
            "note": "Median minutes received->on-scene, fire/EMS calls, trailing 12 months",
        }
        print(f"  [ok] ems_response_median_mins  ({len(got)}/{len(names)} nbhds) src=datasf_fire_ems_calls@{as_of}")

    # --- schools: CAASPP scores (CDS-coded, no coords) x CDE directory (coords) ---
    caaspp_snap = _latest_snapshot("ca_caaspp")
    dir_snap = _latest_snapshot("ca_school_directory")
    if caaspp_snap and dir_snap:
        import io
        import zipfile

        (cd, c_as_of), (dd, d_as_of) = caaspp_snap, dir_snap
        # extract the caret-delimited scores file next to the zip (idempotent)
        scores_txt = cd / "sb_scores.txt"
        if not scores_txt.exists():
            with zipfile.ZipFile(glob.glob(str(cd / "sb_ca*_1_csv_v1.zip"))[0]) as z:
                member = [n for n in z.namelist() if "entities" not in n][0]
                scores_txt.write_bytes(z.read(member))
        rows = con.execute(
            f"""
            WITH dir AS (
              -- lpad handles CDSCode arriving as number OR string
              SELECT lpad(CAST(CDSCode AS VARCHAR), 14, '0') AS cds, geom
              FROM ST_Read('{dd}/schools.geojson')
              WHERE Status = 'Active'
            ),
            scores AS (
              -- school-level rows, all grades (13), ELA(1)+Math(2), weighted by tested count
              -- '*' = small-n suppression in CAASPP files -> columns parse as VARCHAR; try_cast nulls them out
              SELECT lpad(CAST("County Code" AS VARCHAR), 2, '0')
                     || lpad(CAST("District Code" AS VARCHAR), 5, '0')
                     || lpad(CAST("School Code" AS VARCHAR), 7, '0') AS cds,
                     sum(try_cast("Percentage Standard Met and Above" AS DOUBLE)
                         * try_cast("Total Students Tested with Scores" AS DOUBLE))
                       / sum(try_cast("Total Students Tested with Scores" AS DOUBLE)) AS pct_met,
                     sum(try_cast("Total Students Tested with Scores" AS DOUBLE)) AS n_scores
              FROM read_csv_auto('{scores_txt}', delim='^', ignore_errors=true)
              WHERE "School Code" <> '0000000' AND Grade = 13 AND "Test ID" IN (1, 2)
                AND try_cast("Percentage Standard Met and Above" AS DOUBLE) IS NOT NULL
              GROUP BY 1
            )
            SELECT n.nhood,
                   sum(s.pct_met * s.n_scores) / sum(s.n_scores) AS v,
                   count(*) AS n_schools
            FROM scores s
            JOIN dir d ON s.cds = d.cds
            JOIN nbhd n ON ST_Contains(n.geom, d.geom)
            GROUP BY n.nhood
            """
        ).fetchall()
        got = {r[0]: round(r[1], 1) for r in rows}
        for n in names:  # None, not 0 — a neighborhood without a public school has no score
            attrs[n]["school_pct_met"] = got.get(n)
        meta["school_pct_met"] = {
            "source": "ca_caaspp + ca_school_directory",
            "source_as_of": f"{c_as_of} (scores) / {d_as_of} (locations)",
            "note": "CAASPP % met-or-exceeded standard (ELA+Math, all grades, all students), "
                    "tested-count weighted across public schools located in the neighborhood. "
                    "Null = no public school in the area.",
        }
        print(f"  [ok] school_pct_met           ({len(got)}/{len(names)} nbhds) src=caaspp@{c_as_of}+dir@{d_as_of}")

    # deliberately skipped, with reasons the serving layer can surface
    notes.extend([
        "fire_hazard: CAL FIRE FHSZ has no severity zones inside SF proper — attribute would be uniformly empty",
        "rezoning_apps: datasf_planning_records has no coordinates in the export — needs geocoding/staging",
        "political_lean: precinct returns landed but chip is a founder decision (constraint #2 adjacency)",
    ])

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "neighborhood_property": "nhood",
        "attributes": attrs,
        "attribute_meta": meta,
        "skipped": notes,
    }
    PROCESSED.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=1))
    print(f"Wrote {OUT_PATH} ({len(meta)} attributes x {len(names)} neighborhoods)")
    return out


def load() -> dict | None:
    """Serving helper: the precomputed attributes, or None if not built yet."""
    try:
        return json.loads(OUT_PATH.read_text())
    except (OSError, ValueError):
        return None


# --- per-address report enrichment -------------------------------------------
# The report card renders `attributes` as flat "key: String(value)" chips, so we
# emit pre-formatted, unit-carrying display values (neighborhood-level facts for
# the containing area — hex-level values from the pipeline's areas table override
# these on key collision, being finer-grained).
_REPORT_FORMATS: list[tuple[str, str, Any]] = [
    # (display key, attribute, formatter)
    ("school_scores", "school_pct_met", lambda v: f"{v:.0f}% met standard (CAASPP)"),
    ("flood_zone", "flood_zone_share", lambda v: f"{v * 100:.0f}% of neighborhood in FEMA flood zone"),
    ("ems_response", "ems_response_median_mins", lambda v: f"{v:.1f} min median (fire/EMS)"),
    ("transit_stops", "transit_stops", lambda v: int(v)),
    ("street_trees_per_km2", "trees_per_km2", lambda v: int(round(v))),
    ("grocery_stores", "grocery_stores", lambda v: int(v)),
    ("industrial_facilities", "tri_facilities", lambda v: int(v)),
    ("cannabis_retailers", "cannabis_retailers", lambda v: int(v)),
    ("storefront_vacancy", "storefront_vacancy_rate", lambda v: f"{v * 100:.1f}% (Prop-D roll)"),
    ("transport_projects", "sfmta_projects", lambda v: int(v)),
    ("permit_parking_parcels", "rpp_parcels", lambda v: int(v)),
]


def _leading_date(as_of: str | None):
    """Best-effort ISO date from an as_of string (handles composite ones like
    '2024-10-09 (scores) / 2026-05-19 (locations)')."""
    from datetime import date as _date

    try:
        return _date.fromisoformat((as_of or "")[:10])
    except ValueError:
        return None


def report_attributes(neighborhood: str | None) -> tuple[dict[str, Any], list[dict]]:
    """(flat display attributes, citation dicts) for the containing neighborhood.

    Values are neighborhood-level (the H3 spine maps hex -> neighborhood); nulls
    (e.g. no public school in the area) are simply omitted, never zero-filled.
    """
    data = load() if neighborhood else None
    if not data:
        return {}, []
    vals = data.get("attributes", {}).get(neighborhood, {})
    meta = data.get("attribute_meta", {})
    out: dict[str, Any] = {}
    cites: dict[str, dict] = {}
    for key, attr, fmt in _REPORT_FORMATS:
        v = vals.get(attr)
        if v is None:
            continue
        out[key] = fmt(v)
        m = meta.get(attr, {})
        src = m.get("source") or attr
        cites.setdefault(src, {"source": src, "source_as_of": _leading_date(m.get("source_as_of"))})
    return out, list(cites.values())


if __name__ == "__main__":
    build()
