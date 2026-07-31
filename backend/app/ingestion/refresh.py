"""The ratchet: scheduled refresh of every source, tiered by pull weight.

One command, safe to run every day (launchd/cron); each source declares a PULL TIER
and only fires when due. Inside each fetcher the source_as_of probe still applies,
so even a due pull downloads nothing if the source hasn't advanced — dirs are named
by the source's own as_of, never by run date.

PULL TIER != source cadence: OSM rebuilds daily (1.3GB — we pull monthly); SF 311
updates daily (3.2GB full archive — weekly keeps events' own timestamps complete
while capping disk/bandwidth). Light or diff-critical sources pull daily.

    python -m app.ingestion.refresh --dry-run    # show what's due, do nothing
    python -m app.ingestion.refresh              # run due fetches + rebuild attrs + freshness
    python -m app.ingestion.refresh --only ca_abc_licenses --force
    python -m app.ingestion.refresh --tier daily --fetch-only   # the Hetzner runner

`--tier`/`--fetch-only` carve out the subset the off-laptop runner can safely do.
The server is a 2 vCPU / 2GB / 40GB box that also serves canarylayer.com, so it
captures the perishable daily sources (state dumps and rolling windows that are
gone tomorrow) and skips every downstream rebuild. The heavy weekly/monthly
archives and `make pipeline` need a workstation and stay off the server.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from app.ingestion import base, bayarea, california, census, datasf, federal, fhfa, fsq, gtfs, news, osm, sanjose

# Due thresholds per tier (hours since last *fetched_at*). Slightly under the
# nominal period so a daily 07:00 job never misses by minutes.
TIER_HOURS = {"daily": 20, "weekly": 6 * 24 + 12, "monthly": 27 * 24, "quarterly": 80 * 24}

LOCK = base.DATA_DIR / ".refresh.lock"


def _datasf(slug: str):
    ds = next(d for d in datasf.DATASETS if d.slug == slug)
    return lambda force=False: datasf.ingest(ds, force=force)


def _sanjose(slug: str):
    ds = next(d for d in sanjose.DATASETS if d.slug == slug)
    return lambda force=False: sanjose.ingest(ds, force=force)


def _bayarea(key: str):
    ds = next(d for d in bayarea.SOCRATA_DATASETS if d.key == key)
    return lambda force=False: bayarea.ingest_socrata(ds, force=force)


def _alameda(key: str):
    ds = next(d for d in bayarea.ALAMEDA_DATASETS if d.key == key)
    return lambda force=False: bayarea.ingest_alameda(ds, force=force)


def _insideairbnb(force: bool = False):
    from app.ingestion import insideairbnb

    latest = insideairbnb.discover_latest_snapshot()
    if not force and (base.RAW_DIR / "insideairbnb" / latest / "metadata.json").exists():
        print(f"[current] insideairbnb: already have snapshot {latest}")
        return
    insideairbnb.main()


def _insideairbnb_bay(key: str):
    def run(force: bool = False):
        from app.ingestion import insideairbnb

        insideairbnb.fetch_bay_city(key, force=force)

    return run


def _overture(force: bool = False):
    from app.ingestion import overture  # other chat's module; captures all releases still on S3

    overture.main()


# (source key, pull tier, fetch callable). Keys match data/raw/<key>/ dirs.
JOBS: list[tuple[str, str, object]] = [
    # --- daily: light, or diff-critical recurring snapshots ---
    ("ca_abc_licenses", "daily", california.fetch_abc),
    ("ca_cannabis_retailers", "daily", california.fetch_cannabis),
    ("news_sf", "daily", news.fetch_daily),  # tier-zero forward events (claims tier)
    ("datasf_evictions", "daily", _datasf("evictions")),
    ("datasf_business_locations", "daily", _datasf("business_locations")),
    ("datasf_commercial_vacancy", "daily", _datasf("commercial_vacancy")),
    ("datasf_planning_records", "daily", _datasf("planning_records")),
    ("datasf_dev_pipeline", "daily", _datasf("dev_pipeline")),  # probe-cheap; advances quarterly
    # --- San Jose (metro #2) — planning_30d is a rolling window: daily or it's lost ---
    ("sanjose_permits_active", "daily", _sanjose("permits_active")),
    ("sanjose_permits_expired", "daily", _sanjose("permits_expired")),
    ("sanjose_planning_30d", "daily", _sanjose("planning_30d")),
    ("berkeley_business_licenses", "daily", _bayarea("berkeley_business_licenses")),
    # --- weekly: heavy full archives whose events carry their own timestamps ---
    ("datasf_permits", "weekly", _datasf("permits")),
    ("datasf_crime", "weekly", _datasf("crime")),
    ("datasf_threeoneone", "weekly", _datasf("threeoneone")),
    ("datasf_fire_ems_calls", "weekly", _datasf("fire_ems_calls")),
    ("datasf_zoning", "weekly", _datasf("zoning")),
    ("datasf_street_trees", "weekly", _datasf("street_trees")),
    ("datasf_assessor_rolls", "weekly", _datasf("assessor_rolls")),
    ("sanjose_threeoneone", "weekly", _sanjose("threeoneone")),
    ("sanjose_police_calls", "weekly", _sanjose("police_calls")),
    ("oakland_crime", "weekly", _bayarea("oakland_crime")),
    ("oakland_threeoneone", "weekly", _bayarea("oakland_threeoneone")),
    ("berkeley_threeoneone", "weekly", _bayarea("berkeley_threeoneone")),
    ("paloalto_permitviewer", "weekly", bayarea.ingest_paloalto),
    ("alameda_sheriff_crime", "weekly", _alameda("alameda_sheriff_crime")),
    # --- monthly: releases, reference layers, capture-dated federal ---
    ("overture_places", "monthly", _overture),
    ("fsq_os_places", "monthly", fsq.fetch),
    ("gtfs_ca_statewide_calitp", "monthly", gtfs.fetch),
    ("osm_california", "monthly", osm.fetch),
    ("fema_nfhl_flood", "monthly", federal.fetch),
    ("epa_tri_ca", "monthly", federal.fetch_epa_tri),
    ("ca_school_directory", "monthly", california.fetch_schools_dir),
    ("ca_caaspp", "monthly", california.fetch_caaspp),          # advances annually; probe is free
    ("calfire_fhsz", "monthly", california.fetch_fhsz),
    ("ca_precinct_returns", "monthly", california.fetch_precinct),
    ("census_tiger_ca", "monthly", census.fetch_tiger),
    ("census_acs_ca", "monthly", census.fetch_acs),
    ("fhfa_hpi_tract", "monthly", fhfa.fetch),  # advances annually; probe is free
    ("datasf_parking_meters", "monthly", _datasf("parking_meters")),
    ("datasf_rpp_zones", "monthly", _datasf("rpp_zones")),
    ("datasf_sfmta_projects", "monthly", _datasf("sfmta_projects")),
    ("datasf_sfusd_boundaries", "monthly", _datasf("sfusd_boundaries")),
    ("sanjose_zoning", "monthly", _sanjose("zoning")),
    ("sanjose_parcels", "monthly", _sanjose("parcels")),
    ("sanjose_addresses", "monthly", _sanjose("addresses")),
    ("oakland_zoning", "monthly", _bayarea("oakland_zoning")),
    ("oakland_parking_citations", "monthly", _bayarea("oakland_parking_citations")),
    ("berkeley_zoning", "monthly", _bayarea("berkeley_zoning")),
    ("alameda_parcels", "monthly", _alameda("alameda_parcels")),
    ("alameda_tax_roll", "monthly", _alameda("alameda_tax_roll")),       # advances annually; probe-cheap
    ("alameda_ownership_transfers", "monthly", _alameda("alameda_ownership_transfers")),
    # --- quarterly ---
    ("insideairbnb", "quarterly", _insideairbnb),
    ("insideairbnb_oakland", "quarterly", _insideairbnb_bay("insideairbnb_oakland")),
    ("insideairbnb_santa_clara_co", "quarterly", _insideairbnb_bay("insideairbnb_santa_clara_co")),
    ("insideairbnb_san_mateo_co", "quarterly", _insideairbnb_bay("insideairbnb_san_mateo_co")),
]


def _last_fetched_hours(key: str) -> float | None:
    metas = sorted((base.RAW_DIR / key).glob("*/metadata.json"))
    if not metas:
        return None
    try:
        meta = json.loads(metas[-1].read_text())
        # insideairbnb predates the Snapshot protocol: downloaded_at, not fetched_at
        fetched = datetime.fromisoformat(meta.get("fetched_at") or meta["downloaded_at"])
        return (datetime.now(timezone.utc) - fetched).total_seconds() / 3600
    except (OSError, ValueError, KeyError):
        return None


def run(
    *,
    dry_run: bool = False,
    only: str | None = None,
    force: bool = False,
    tiers: set[str] | None = None,
    fetch_only: bool = False,
) -> int:
    """Fetch every due source, then (unless fetch_only) rebuild everything downstream.

    `tiers` and `fetch_only` exist for the off-laptop runner: the Hetzner box is a
    2GB/40GB machine that also serves production, so it captures the perishable
    daily sources and nothing else. The heavy weekly/monthly archives and the full
    `make pipeline` rebuild stay on a workstation with room for them.
    """
    jobs = [(k, t, f) for k, t, f in JOBS if only is None or k == only]
    if only and not jobs:
        raise SystemExit(f"No job {only!r}. Keys: {[k for k, _, _ in JOBS]}")
    if tiers:
        unknown = tiers - set(TIER_HOURS)
        if unknown:
            raise SystemExit(f"Unknown tier(s) {sorted(unknown)}. Known: {sorted(TIER_HOURS)}")
        jobs = [(k, t, f) for k, t, f in jobs if t in tiers]

    failures = 0
    ran = 0
    for key, tier, fn in jobs:
        hours = _last_fetched_hours(key)
        due = force or hours is None or hours >= TIER_HOURS[tier]
        ago = "never" if hours is None else f"{hours / 24:.1f}d ago"
        if not due:
            print(f"[skip] {key:28} {tier:9} fetched {ago}")
            continue
        if dry_run:
            print(f"[DUE ] {key:28} {tier:9} fetched {ago}")
            continue
        print(f"[run ] {key:28} {tier:9} fetched {ago}")
        try:
            fn(force=force) if _accepts_force(fn) else fn()
            ran += 1
        except Exception:  # noqa: BLE001 — one source never halts the ratchet
            failures += 1
            print(f"[FAIL] {key}:\n{traceback.format_exc(limit=2)}")

    if dry_run:
        return 0

    # Downstream rebuilds: served attributes + freshness manifest (ours), then the
    # pipeline (other lane; tolerate failure — e.g. DuckDB locked by a running API).
    if ran and fetch_only:
        print(f"[fetch-only] captured {ran} source(s); skipping attrs/pipeline/claims/publish")
    if ran and not fetch_only:
        try:
            from app.api import nbhd_attributes

            nbhd_attributes.build()
        except Exception:  # noqa: BLE001
            failures += 1
            print(f"[FAIL] nbhd_attributes rebuild:\n{traceback.format_exc(limit=2)}")
        r = subprocess.run(["make", "pipeline"], cwd=base.BACKEND_DIR, capture_output=True, text=True)
        print("[pipeline]", "ok" if r.returncode == 0 else f"FAILED (rc={r.returncode}) — likely DuckDB lock; rerun after stopping the API")
        # Claims lifecycle AFTER the pipeline: corroboration must see the morning's
        # fresh events (the ratchet verifies the news layer as a side effect).
        try:
            news.claims_build()
        except Exception:  # noqa: BLE001
            failures += 1
            print(f"[FAIL] claims_build:\n{traceback.format_exc(limit=2)}")
        # Publish (pipeline lane): serving JSON + Supabase upsert, only off a fresh build.
        if r.returncode == 0:
            p = subprocess.run(
                ["make", "publish-local", "publish"], cwd=base.BACKEND_DIR, capture_output=True, text=True
            )
            print("[publish]", "ok" if p.returncode == 0 else f"FAILED (rc={p.returncode}):\n{p.stdout[-400:]}{p.stderr[-400:]}")

    # NOT in fetch-only mode: freshness.json is a *served* artifact, and the small
    # runner only holds the daily sources — regenerating it there would report every
    # weekly/monthly source as missing on the live site.
    if not fetch_only:
        from app.ingestion import freshness

        freshness.main()
    return failures


def _accepts_force(fn) -> bool:
    import inspect

    try:
        return "force" in inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--only")
    parser.add_argument("--force", action="store_true")
    parser.add_argument(
        "--tier",
        action="append",
        dest="tiers",
        metavar="TIER",
        help="only run sources in this pull tier (repeatable): daily|weekly|monthly|quarterly",
    )
    parser.add_argument(
        "--fetch-only",
        action="store_true",
        help="capture snapshots but skip attrs/pipeline/claims/publish (for the small off-laptop runner)",
    )
    args = parser.parse_args()

    # single-instance lock (stale after 12h)
    if LOCK.exists() and not args.dry_run:
        age_h = (time.time() - LOCK.stat().st_mtime) / 3600
        if age_h < 12:
            raise SystemExit(f"refresh already running (lock {age_h:.1f}h old): {LOCK}")
        LOCK.unlink()
    if not args.dry_run:
        LOCK.write_text(base.now_iso())
    try:
        failures = run(
            dry_run=args.dry_run,
            only=args.only,
            force=args.force,
            tiers=set(args.tiers) if args.tiers else None,
            fetch_only=args.fetch_only,
        )
    finally:
        if not args.dry_run:
            LOCK.unlink(missing_ok=True)
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
