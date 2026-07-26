"""The freshness manifest: exactly how current every piece of data is, in one place.

Answers "from WHEN is this data?" with full specificity, per source AND per served
attribute — the checkable version of "as updated as possible":

  - source_as_of : the source's OWN currency (its publish/ETL date — the real freshness)
  - fetched_at   : when we last pulled it
  - age_days     : today minus source_as_of
  - status       : fresh / due / overdue, judged against the source's declared cadence

Writes data/processed/freshness.json (servable; the UI/API can read it directly) and
prints a table.

    python -m app.ingestion.freshness
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

from app.ingestion import base

# Max acceptable age of source_as_of per declared cadence, in days. Beyond "due"
# is tolerated up to 2x before "overdue". Cadences with no expectation are
# informational only (reference layers that change when they change).
CADENCE_MAX_AGE_DAYS: dict[str, int] = {
    "daily": 2,
    "continuous": 2,
    "weekly": 9,
    "monthly": 40,
    "quarterly": 110,
    "annual": 430,
}
NO_EXPECTATION = {"per_election", "irregular"}


def _pull_tiers() -> dict[str, str]:
    """source key -> pull tier from the refresh orchestrator (lazy import, cached)."""
    global _TIERS
    if _TIERS is None:
        try:
            from app.ingestion import refresh

            _TIERS = {k: t for k, t, _ in refresh.JOBS}
        except Exception:  # noqa: BLE001
            _TIERS = {}
    return _TIERS


_TIERS: dict[str, str] | None = None


def _latest_snapshot_meta(source_dir: Path) -> dict | None:
    metas = sorted(source_dir.glob("*/metadata.json"))
    if not metas:
        return None
    # dirs are named by source_as_of -> lexicographic max = newest
    try:
        return json.loads(metas[-1].read_text())
    except (OSError, ValueError):
        return None


def _specs_by_key() -> dict[str, dict]:
    """Cadence/shape per source from the registry (import-light: read the export
    if present, else import the registry module)."""
    reg_path = base.DATA_DIR / "sources_registry.json"
    try:
        reg = json.loads(reg_path.read_text())
        return {s["key"]: s for s in reg.get("sources", [])}
    except (OSError, ValueError):
        from app.ingestion import registry  # fallback: build in-process

        return {s["key"]: s for s in registry.to_registry()["sources"]}


def build_report() -> dict:
    today = datetime.now(timezone.utc).date()
    specs = _specs_by_key()
    rows: list[dict] = []

    for source_dir in sorted(base.RAW_DIR.iterdir()):
        if not source_dir.is_dir():
            continue
        key = source_dir.name
        meta = _latest_snapshot_meta(source_dir)
        spec = specs.get(key, {})
        cadence = spec.get("cadence")
        if meta is None:
            rows.append({"source": key, "status": "no_snapshot", "cadence": cadence})
            continue
        # insideairbnb predates the Snapshot protocol: its key is published_date
        as_of = meta.get("source_as_of") or meta.get("published_date")
        try:
            age_days = (today - date.fromisoformat(str(as_of)[:10])).days
        except ValueError:
            age_days = None

        if cadence in NO_EXPECTATION or cadence is None:
            status = "info"
        elif age_days is None:
            status = "unknown"
        else:
            # judge against the slower of source cadence and OUR pull tier
            # (OSM rebuilds daily but we deliberately pull monthly — not "overdue")
            max_age = CADENCE_MAX_AGE_DAYS.get(cadence, 40)
            tier = _pull_tiers().get(key)
            if tier:
                max_age = max(max_age, CADENCE_MAX_AGE_DAYS.get(tier, 40))
            status = "fresh" if age_days <= max_age else ("due" if age_days <= 2 * max_age else "overdue")

        # Declared-but-unscheduled guard: a spec with a recurring cadence that is
        # NOT in the refresh JOBS will silently rot (caught the hard way: news_sf
        # declared daily, never scheduled — a human noticed before the system did).
        if (
            cadence not in NO_EXPECTATION and cadence is not None
            and key not in _pull_tiers()
        ):
            status = "UNSCHEDULED"

        rows.append(
            {
                "source": key,
                "source_as_of": as_of,
                "fetched_at": meta.get("fetched_at"),
                "age_days": age_days,
                "cadence": cadence,
                "temporal_shape": spec.get("temporal_shape"),
                "status": status,
            }
        )

    # Per-served-attribute freshness (what the map/report actually shows users).
    attributes = {}
    attr_path = base.PROCESSED_DIR / "neighborhood_attributes.json"
    try:
        attr = json.loads(attr_path.read_text())
        attributes = {
            name: {"source": m.get("source"), "source_as_of": m.get("source_as_of")}
            for name, m in attr.get("attribute_meta", {}).items()
        }
        attributes["_generated_at"] = attr.get("generated_at")
    except (OSError, ValueError):
        pass

    counts: dict[str, int] = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1

    return {
        "generated_at": base.now_iso(),
        "summary": counts,
        "sources": rows,
        "served_attributes": attributes,
    }


def main() -> None:
    report = build_report()
    out = base.PROCESSED_DIR / "freshness.json"
    base.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1))

    print(f"{'source':30} {'as_of':12} {'age':>4}  {'cadence':10} status")
    print("-" * 72)
    for r in report["sources"]:
        age = "" if r.get("age_days") is None else str(r["age_days"])
        print(
            f"{r['source'][:30]:30} {str(r.get('source_as_of') or '-')[:10]:12} {age:>4}  "
            f"{str(r.get('cadence') or '-'):10} {r['status']}"
        )
    print("-" * 72)
    print("summary:", report["summary"], f"-> {out}")


if __name__ == "__main__":
    main()
