"""Pull Inside Airbnb's full SF snapshot and derive a neighbourhood-level summary.

Direct file downloads from data.insideairbnb.com (their published bulk-data host,
not the interactive site) -- this is the intended distribution mechanism, not scraping.
Data is CC BY 4.0: https://insideairbnb.com/data-policies/

Pulls BOTH tiers Inside Airbnb publishes for each snapshot:
  - "data/"           -- detailed: listings.csv.gz, calendar.csv.gz, reviews.csv.gz
                         (full fields, nightly price/availability, full review text --
                         includes host/reviewer names, so this tier stays in data/raw/,
                         which is gitignored, and is never republished as-is)
  - "visualisations/" -- summary: listings.csv, reviews.csv, neighbourhoods.{csv,geojson}
                         (host-free, used below to compute the aggregate we publish)

Every snapshot directory gets a metadata.json recording Inside Airbnb's OWN publish
date for that snapshot vs. when *we* pulled it -- the data is only ever as fresh as
Inside Airbnb's last scrape, no matter when we run this, so that distinction is
tracked explicitly rather than left implicit in a directory name.

Usage:
    python -m app.ingestion.insideairbnb
"""

import csv
import gzip
import json
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

from app.ingestion import base

CITY_PATH = "united-states/ca/san-francisco"
CITY_LABEL = "San Francisco, California, United States"
GET_DATA_URL = "https://insideairbnb.com/get-the-data/"
ATTRIBUTION = "Inside Airbnb (insideairbnb.com), CC BY 4.0"

SPEC = base.SourceSpec(
    key="insideairbnb",
    name="Inside Airbnb — San Francisco",
    geography="san_francisco",
    temporal_shape="recurring_snapshot",
    cadence="quarterly",
    fmt="csv",
    license=ATTRIBUTION,
    homepage="https://insideairbnb.com/san-francisco/",
    canonical_source="insideairbnb",
    tier="T6.5",
    notes="Quarterly snapshot; diff listings across snapshots for STR-density change; reviews.csv => review-velocity signal. Detailed tier has host PII (gitignored, never republished).",
)

BACKEND_DIR = Path(__file__).resolve().parents[2]
RAW_DIR = BACKEND_DIR / "data" / "raw" / "insideairbnb"
PROCESSED_DIR = BACKEND_DIR / "data" / "processed"
MANIFEST_PATH = BACKEND_DIR / "data" / "raw" / "manifest.jsonl"

DETAILED_FILES = ["listings.csv.gz", "calendar.csv.gz", "reviews.csv.gz"]
SUMMARY_FILES = ["listings.csv", "reviews.csv", "neighbourhoods.csv", "neighbourhoods.geojson"]

SNAPSHOT_RE = re.compile(
    rf"data\.insideairbnb\.com/{re.escape(CITY_PATH)}/(\d{{4}}-\d{{2}}-\d{{2}})/visualisations/listings\.csv"
)


def discover_latest_snapshot() -> str:
    resp = requests.get(GET_DATA_URL, timeout=30)
    resp.raise_for_status()
    match = SNAPSHOT_RE.search(resp.text)
    if not match:
        raise RuntimeError("Could not find a San Francisco snapshot date on get-the-data page")
    return match.group(1)


def _file_url(snapshot_date: str, subfolder: str, name: str) -> str:
    return f"https://data.insideairbnb.com/{CITY_PATH}/{snapshot_date}/{subfolder}/{name}"


def append_manifest(entry: dict) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST_PATH.open("a") as f:
        f.write(json.dumps(entry) + "\n")


def _download_one(url: str, out_path: Path) -> dict:
    entry = {
        "slug": f"insideairbnb-sf-{out_path.name}",
        "url": url,
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "status": "error",
        "output_path": None,
        "bytes": None,
        "error": None,
    }
    try:
        with requests.get(url, timeout=120, stream=True) as resp:
            resp.raise_for_status()
            with out_path.open("wb") as f:
                for chunk in resp.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
        entry["status"] = "ok"
        entry["output_path"] = str(out_path.relative_to(BACKEND_DIR / "data"))
        entry["bytes"] = out_path.stat().st_size
    except requests.RequestException as exc:
        entry["error"] = str(exc)
    return entry


def download_snapshot(snapshot_date: str) -> Path:
    out_dir = RAW_DIR / snapshot_date
    out_dir.mkdir(parents=True, exist_ok=True)

    files_meta = {}
    for subfolder, names in (("data", DETAILED_FILES), ("visualisations", SUMMARY_FILES)):
        for name in names:
            url = _file_url(snapshot_date, subfolder, name)
            entry = _download_one(url, out_dir / name)
            append_manifest({"scraped_at": entry["downloaded_at"], **entry})
            files_meta[name] = {k: v for k, v in entry.items() if k not in ("slug",)}
            print(f"[{entry['status']}] {name} -> {entry.get('output_path') or entry.get('error')}")

    write_snapshot_metadata(out_dir, snapshot_date, files_meta)
    return out_dir


def write_snapshot_metadata(out_dir: Path, snapshot_date: str, files_meta: dict) -> None:
    published = date.fromisoformat(snapshot_date)
    today = datetime.now(timezone.utc).date()
    metadata = {
        "city": CITY_LABEL,
        "source": ATTRIBUTION,
        "published_date": snapshot_date,
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "data_age_days_at_download": (today - published).days,
        "note": (
            "published_date is Inside Airbnb's own snapshot date -- the data is only "
            "as fresh as their last scrape regardless of downloaded_at. Re-run this "
            "ingestion periodically and diff against the previous snapshot_date to "
            "track when a new one is actually published."
        ),
        "files": files_meta,
    }
    (out_dir / "metadata.json").write_text(json.dumps(metadata, indent=2))


CALENDAR_HORIZONS_DAYS = (30, 90, 365)
REVIEW_TRAILING_DAYS = 90


def _parse_date(value: str) -> date | None:
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def _reviews_by_listing(snapshot_dir: Path) -> dict[str, list[date]]:
    reviews: dict[str, list[date]] = defaultdict(list)
    with (snapshot_dir / "reviews.csv").open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            d = _parse_date(row["date"])
            if d is not None:
                reviews[row["listing_id"]].append(d)
    return reviews


def _calendar_unavailable_by_listing(
    snapshot_dir: Path, as_of: date
) -> dict[str, dict[int, dict[str, int]]]:
    """For each listing: per horizon, count of nights total and nights unavailable.

    Windows are anchored to `as_of` (the snapshot date, the calendar's own reference
    point) -- NOT wall-clock now -- so the forward horizons line up with the dates the
    calendar actually covers regardless of when this ingestion runs.
    'available == f' means booked OR host-blocked; we label it "unavailable", not
    "booked", since Inside Airbnb's calendar cannot distinguish the two.
    """
    horizon_cutoffs = {h: as_of + timedelta(days=h) for h in CALENDAR_HORIZONS_DAYS}
    per_listing: dict[str, dict[int, dict[str, int]]] = defaultdict(
        lambda: {h: {"nights": 0, "unavailable": 0} for h in CALENDAR_HORIZONS_DAYS}
    )
    with gzip.open(snapshot_dir / "calendar.csv.gz", "rt", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            d = _parse_date(row["date"])
            if d is None or d < as_of:
                continue
            is_unavailable = row.get("available") == "f"
            buckets = per_listing[row["listing_id"]]
            for horizon, cutoff in horizon_cutoffs.items():
                if d < cutoff:
                    buckets[horizon]["nights"] += 1
                    if is_unavailable:
                        buckets[horizon]["unavailable"] += 1
    return per_listing


def summarize(snapshot_dir: Path, snapshot_date: str) -> dict:
    as_of = date.fromisoformat(snapshot_date)

    listings_by_neighbourhood: dict[str, list[dict]] = defaultdict(list)
    with (snapshot_dir / "listings.csv").open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            listings_by_neighbourhood[row["neighbourhood"]].append(row)

    reviews_by_listing = _reviews_by_listing(snapshot_dir)
    calendar_by_listing = _calendar_unavailable_by_listing(snapshot_dir, as_of)

    review_cutoff = as_of - timedelta(days=REVIEW_TRAILING_DAYS)

    def trailing_reviews(listing_ids: list[str]) -> int:
        # Anchored to the snapshot date: reviews in (as_of - 90d, as_of].
        return sum(
            1
            for listing_id in listing_ids
            for d in reviews_by_listing.get(listing_id, [])
            if review_cutoff < d <= as_of
        )

    neighbourhoods = {}
    for neighbourhood, rows in listings_by_neighbourhood.items():
        prices = [float(r["price"]) for r in rows if r.get("price")]
        entire_home = sum(1 for r in rows if r["room_type"] == "Entire home/apt")
        listing_ids = [r["id"] for r in rows]

        horizon_totals = {h: {"nights": 0, "unavailable": 0} for h in CALENDAR_HORIZONS_DAYS}
        listings_with_calendar = 0
        for listing_id in listing_ids:
            if listing_id in calendar_by_listing:
                listings_with_calendar += 1
                for horizon, counts in calendar_by_listing[listing_id].items():
                    horizon_totals[horizon]["nights"] += counts["nights"]
                    horizon_totals[horizon]["unavailable"] += counts["unavailable"]

        unavailable_rates = {
            f"calendar_unavailable_rate_{h}d": (
                round(horizon_totals[h]["unavailable"] / horizon_totals[h]["nights"], 4)
                if horizon_totals[h]["nights"]
                else None
            )
            for h in CALENDAR_HORIZONS_DAYS
        }

        neighbourhoods[neighbourhood] = {
            "listing_count": len(rows),
            "entire_home_share": round(entire_home / len(rows), 3) if rows else None,
            "median_price_usd": round(sorted(prices)[len(prices) // 2], 2) if prices else None,
            "reviews_trailing_90d": trailing_reviews(listing_ids),
            "listings_with_calendar": listings_with_calendar,
            **unavailable_rates,
        }

    windows = {
        "reviews_trailing_90d": {
            "from": (review_cutoff + timedelta(days=1)).isoformat(),
            "to": as_of.isoformat(),
        },
    }
    for h in CALENDAR_HORIZONS_DAYS:
        windows[f"calendar_forward_{h}d"] = {
            "from": as_of.isoformat(),
            "to": (as_of + timedelta(days=h)).isoformat(),
        }

    return {
        "source": ATTRIBUTION,
        "snapshot_date": snapshot_date,
        "data_as_of": snapshot_date,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metric_notes": {
            "reviews_trailing_90d": "Count of guest reviews in the 90 days ending on data_as_of. Anchored to the snapshot date, not wall-clock now.",
            "calendar_unavailable_rate": "Fraction of forward listing-nights marked unavailable (booked OR host-blocked -- Inside Airbnb cannot distinguish) within each horizon starting data_as_of.",
        },
        "windows": windows,
        "neighbourhoods": neighbourhoods,
    }


# --------------------------------------------------------------------------- #
#  Bay Area cities (fan-out 2026-07-26) — RAW capture only; the neighbourhood
#  summary above stays SF (it feeds the SF frontend). Santa Clara County covers
#  San Jose + Palo Alto; San Mateo County covers the Peninsula.
# --------------------------------------------------------------------------- #
BAY_CITIES: dict[str, tuple[str, str]] = {
    "insideairbnb_oakland": ("united-states/ca/oakland", "Oakland"),
    "insideairbnb_santa_clara_co": ("united-states/ca/santa-clara-county", "Santa Clara County"),
    "insideairbnb_san_mateo_co": ("united-states/ca/san-mateo-county", "San Mateo County"),
}

BAY_SPECS = [
    base.SourceSpec(
        key=key,
        name=f"Inside Airbnb — {label}",
        geography=key.removeprefix("insideairbnb_"),
        temporal_shape="recurring_snapshot",
        cadence="quarterly",
        fmt="csv",
        license=ATTRIBUTION,
        homepage=f"https://insideairbnb.com/{path.rsplit('/', 1)[-1]}/",
        canonical_source="insideairbnb",
        tier="T6.5",
        notes="STR density/churn for the Bay fan-out. Raw capture only (SF-style summary not built). Detailed tier has host PII (gitignored, never republished).",
    )
    for key, (path, label) in BAY_CITIES.items()
]


def _discover_city_snapshot(city_path: str) -> str | None:
    resp = requests.get(GET_DATA_URL, timeout=30)
    resp.raise_for_status()
    m = re.search(
        rf"data\.insideairbnb\.com/{re.escape(city_path)}/(\d{{4}}-\d{{2}}-\d{{2}})/visualisations/listings\.csv",
        resp.text,
    )
    return m.group(1) if m else None


def fetch_bay_city(key: str, *, force: bool = False) -> None:
    city_path, label = BAY_CITIES[key]
    snapshot_date = _discover_city_snapshot(city_path)
    if snapshot_date is None:
        print(f"[skip] {key}: no snapshot found on get-the-data page (city not published?)")
        return
    out_dir = base.RAW_DIR / key / snapshot_date
    if not force and (out_dir / "metadata.json").exists():
        print(f"[current] {key}: already have snapshot {snapshot_date}")
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"[pull] {key} snapshot {snapshot_date}")
    files_meta = {}
    for subfolder, names in (("data", DETAILED_FILES), ("visualisations", SUMMARY_FILES)):
        for name in names:
            url = f"https://data.insideairbnb.com/{city_path}/{snapshot_date}/{subfolder}/{name}"
            entry = _download_one(url, out_dir / name)
            append_manifest({"scraped_at": entry["downloaded_at"], **entry})
            files_meta[name] = {k: v for k, v in entry.items() if k != "slug"}
            print(f"  [{entry['status']}] {name}")
    published = date.fromisoformat(snapshot_date)
    (out_dir / "metadata.json").write_text(json.dumps({
        "city": f"{label}, California, United States",
        "source": ATTRIBUTION,
        "published_date": snapshot_date,
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "data_age_days_at_download": (datetime.now(timezone.utc).date() - published).days,
        "note": "published_date is Inside Airbnb's own snapshot date — see SF metadata note.",
        "files": files_meta,
    }, indent=2))


def _bay_fetcher(key: str):
    return lambda force=False: fetch_bay_city(key, force=force)


def main() -> None:
    snapshot_date = discover_latest_snapshot()
    published = date.fromisoformat(snapshot_date)
    age_days = (datetime.now(timezone.utc).date() - published).days
    print(f"Latest SF snapshot published by Inside Airbnb: {snapshot_date} ({age_days} days old)")

    snapshot_dir = download_snapshot(snapshot_date)

    summary = summarize(snapshot_dir, snapshot_date)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out_path = PROCESSED_DIR / "insideairbnb_sf_neighbourhood_summary.json"
    out_path.write_text(json.dumps(summary, indent=2))
    print(f"Wrote summary for {len(summary['neighbourhoods'])} neighbourhoods -> {out_path}")


if __name__ == "__main__":
    main()
