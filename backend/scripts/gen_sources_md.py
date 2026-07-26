"""Generate the public SOURCES.md (the site's Data sources tab) from the registry.

Single source of truth: backend/data/sources_registry.json (export it first with
`python -m app.ingestion.registry --export`). Every entry ships with its URL,
cadence, and license so the whole acquisition layer is reproducible by a reader.

Usage:  python scripts/gen_sources_md.py
"""

from __future__ import annotations

import json
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
OUT = BACKEND.parent / "SOURCES.md"

GROUP_ORDER = [
    ("san_francisco", "San Francisco (city records)"),
    ("california", "California (statewide)"),
    ("usa", "Federal"),
    ("global", "Points of interest and base map"),
]


def group_of(src: dict) -> str:
    g = src.get("geography", "")
    if g.startswith("san_francisco"):
        return "san_francisco"
    if g in ("california", "ca"):
        return "california"
    if g in ("usa", "us", "federal", "national"):
        return "usa"
    return "global"


def main() -> None:
    items = json.loads((BACKEND / "data" / "sources_registry.json").read_text())
    if isinstance(items, dict):
        items = items.get("sources", list(items.values()))
    implemented = [s for s in items if s.get("implemented")]
    planned = [s for s in items if not s.get("implemented")]

    lines = [
        "# Where the data comes from",
        "",
        "Every number in Canary traces back to a public record. This page lists every",
        "source we read, with the exact link, how often we pull it, and the license it",
        "is published under, so that anyone can reproduce the acquisition layer. Nothing",
        "is scraped from private platforms; everything below is published by a",
        "government agency or under an open license.",
        "",
        f"*{len(implemented)} sources live, {len(planned)} planned. Generated from the*",
        "*machine-readable registry (`backend/data/sources_registry.json`); regenerate*",
        "*with `python scripts/gen_sources_md.py`.*",
        "",
    ]

    for gkey, gtitle in GROUP_ORDER:
        rows = sorted((s for s in implemented if group_of(s) == gkey), key=lambda s: s["name"])
        if not rows:
            continue
        lines += [f"## {gtitle}", "", "| Source | What it provides | Updated | License | Link |", "|---|---|---|---|---|"]
        for s in rows:
            note = (s.get("notes") or "").rstrip(".")
            lines.append(
                f"| {s['name']} | {note or s.get('temporal_shape','')} | {s.get('cadence','')} "
                f"| {s.get('license','')} | [{s['homepage'].split('//')[-1][:42]}]({s['homepage']}) |"
            )
        lines.append("")

    if planned:
        lines += ["## Planned (not yet live)", ""]
        for s in sorted(planned, key=lambda s: s["name"]):
            lines.append(f"- **{s['name']}**: {(s.get('notes') or '').rstrip('.')} ([link]({s['homepage']}))")
        lines.append("")

    lines += [
        "## The rules the data lives by",
        "",
        "- **Two dates on everything.** Every record carries the source's own",
        "  publication date and the date we fetched it. \"Fresh\" is checkable, not a",
        "  slogan.",
        "- **Citations, never verdicts.** We publish what happened, with the record",
        "  behind it. We never label a neighborhood \"good\" or \"bad\".",
        "- **No protected-class data.** Race, ethnicity, and income are excluded from",
        "  every metric and every model, everywhere, by design.",
        "- **Complaints are complaints.** Report-based data (police reports, 311)",
        "  measures reporting behavior as well as reality. Where the two diverge we say",
        "  so; the corrections we have published about our own data are in the research",
        "  note's appendix.",
        "",
    ]
    OUT.write_text("\n".join(lines))
    print(f"[sources] {len(implemented)} live + {len(planned)} planned -> {OUT}")


if __name__ == "__main__":
    main()
