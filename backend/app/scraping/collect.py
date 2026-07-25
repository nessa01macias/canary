"""Scrape the queued source list into data/raw and append a run manifest.

Usage:
    python -m app.scraping.collect
    python -m app.scraping.collect --slug safetipin
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from app.scraping.client import get_client
from app.scraping.sources import SOURCES

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "raw"
MANIFEST_PATH = DATA_DIR / "manifest.jsonl"


def scrape_source(slug: str, url: str) -> dict:
    client = get_client()
    scraped_at = datetime.now(timezone.utc).isoformat()

    result = {
        "slug": slug,
        "url": url,
        "scraped_at": scraped_at,
        "status": "error",
        "output_path": None,
        "error": None,
    }

    try:
        doc = client.scrape(url, formats=["markdown"])
        out_dir = DATA_DIR / slug
        out_dir.mkdir(parents=True, exist_ok=True)
        timestamp = scraped_at.replace(":", "").replace("+00:00", "Z")
        out_path = out_dir / f"{timestamp}.md"
        out_path.write_text(doc.markdown or "")
        result["status"] = "ok"
        result["output_path"] = str(out_path.relative_to(DATA_DIR.parents[0]))
    except Exception as exc:  # noqa: BLE001 - record and move on to the next source
        result["error"] = str(exc)

    return result


def append_manifest(entry: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with MANIFEST_PATH.open("a") as f:
        f.write(json.dumps(entry) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slug", help="Only scrape the source with this slug")
    args = parser.parse_args()

    sources = SOURCES
    if args.slug:
        sources = [s for s in SOURCES if s.slug == args.slug]
        if not sources:
            raise SystemExit(f"No source with slug {args.slug!r}")

    for source in sources:
        result = scrape_source(source.slug, source.url)
        append_manifest(result)
        status = result["status"]
        print(f"[{status}] {source.slug} -> {result.get('output_path') or result.get('error')}")


if __name__ == "__main__":
    main()
