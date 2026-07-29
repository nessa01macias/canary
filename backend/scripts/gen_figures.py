"""Generate the research-note figures (SVG) from the computed benchmark statistics.

Single source of truth: data/processed/benchmark_v1_stats.json, produced by
`python -m app.benchmark.stats` from the judged run artifacts (question set frozen
at 064dc90). Whiskers are Wilson 95% intervals from that file. The figures ship to
frontend/public/research/ and are embedded by RESEARCH.md.

Palette: brand orange #FF6624 (grounded) and indigo snapped to #3A43C9
(unassisted; the brand #2329A8 sits below the mark-lightness band, so the hue is
kept and the step lightened). Pair validated for CVD separation and contrast on
the white paper surface; the orange sits at 2.93:1, which is legal because every
bar carries a value label and Tables 1-2 are the table view of the same data.

Usage:  python scripts/gen_figures.py   (after `python -m app.benchmark.stats`)
"""

from __future__ import annotations

import json
import os
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
# Same env contract as the benchmark harness: BENCH_FILE picks the version,
# and the figures read that version's stats artifact.
_BENCH = os.environ.get("BENCH_FILE", "benchmark_v1.json").removesuffix(".json")
STATS = BACKEND / "data" / "processed" / f"{_BENCH}_stats.json"
OUT = BACKEND.parent / "frontend" / "public" / "research"

UNASSISTED = "#3A43C9"
GROUNDED = "#FF6624"
INK = "#1c1a17"
SECONDARY = "#45403a"
MUTED = "#8a837b"
GRID = "#efe8dc"
BASELINE = "#d9d2c7"
FONT = "ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

SHORT_MODEL = {
    "Claude Fable 5": "Claude Fable 5",
    "Grok 4.5": "Grok 4.5",
    "GPT-5.6 Sol": "GPT-5.6 Sol",
    "GPT-5 search": "GPT-5 search",
    "Perplexity sonar-pro": "Sonar-pro",
}
SHORT_BLOCK = {
    "Superlative": "Superlative",
    "Numeric": "Numeric",
    "Pairwise (chance = 50%)": "Pairwise",
    "Direction": "Direction",
    "Address-level": "Address-level",
    "Temporal (in training window)": "Temporal",
    "Distractors": "Distractors",
}


def load() -> tuple[list, list]:
    s = json.loads(STATS.read_text())
    models = [
        (SHORT_MODEL[r["model"]],
         (round(r["unassisted"]["acc"] * 100), r["unassisted"]["ci"]),
         (round(r["grounded"]["acc"] * 100), r["grounded"]["ci"]))
        for r in s["per_model"]
    ]
    blocks = [
        (SHORT_BLOCK[e["block"]],
         (round(e["unassisted"]["acc"] * 100), e["unassisted"]["ci"]),
         (round(e["grounded"]["acc"] * 100), e["grounded"]["ci"]))
        for e in s["per_block"]
    ]
    return models, blocks


def text(x: float, y: float, s: str, size: float, fill: str, anchor: str = "middle",
         weight: str = "400") -> str:
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" '
            f'text-anchor="{anchor}" font-weight="{weight}">{s}</text>')


def column(x: float, y_base: float, y_top: float, w: float, fill: str) -> str:
    """Vertical bar: 4px rounded data-end (top), square at the baseline."""
    h = y_base - y_top
    if h <= 0:
        return ""
    r = min(4.0, h / 2)
    return (f'<path d="M{x:.1f},{y_base:.1f} V{y_top + r:.1f} '
            f'Q{x:.1f},{y_top:.1f} {x + r:.1f},{y_top:.1f} H{x + w - r:.1f} '
            f'Q{x + w:.1f},{y_top:.1f} {x + w:.1f},{y_top + r:.1f} V{y_base:.1f} Z" '
            f'fill="{fill}"/>')


def hbar(x_base: float, x_end: float, y: float, h: float, fill: str) -> str:
    """Horizontal bar: 4px rounded data-end (right), square at the baseline."""
    w = x_end - x_base
    if w <= 0:
        return ""
    r = min(4.0, w / 2)
    return (f'<path d="M{x_base:.1f},{y:.1f} H{x_end - r:.1f} '
            f'Q{x_end:.1f},{y:.1f} {x_end:.1f},{y + r:.1f} V{y + h - r:.1f} '
            f'Q{x_end:.1f},{y + h:.1f} {x_end - r:.1f},{y + h:.1f} H{x_base:.1f} Z" '
            f'fill="{fill}"/>')


def vwhisker(cx: float, y_lo: float, y_hi: float) -> str:
    """Wilson 95% interval on a column: hairline stem + 6px caps, ink-toned."""
    return (f'<line x1="{cx:.1f}" y1="{y_lo:.1f}" x2="{cx:.1f}" y2="{y_hi:.1f}" stroke="{SECONDARY}" stroke-width="1.5"/>'
            f'<line x1="{cx - 3:.1f}" y1="{y_lo:.1f}" x2="{cx + 3:.1f}" y2="{y_lo:.1f}" stroke="{SECONDARY}" stroke-width="1.5"/>'
            f'<line x1="{cx - 3:.1f}" y1="{y_hi:.1f}" x2="{cx + 3:.1f}" y2="{y_hi:.1f}" stroke="{SECONDARY}" stroke-width="1.5"/>')


def hwhisker(cy: float, x_lo: float, x_hi: float) -> str:
    return (f'<line x1="{x_lo:.1f}" y1="{cy:.1f}" x2="{x_hi:.1f}" y2="{cy:.1f}" stroke="{SECONDARY}" stroke-width="1.5"/>'
            f'<line x1="{x_lo:.1f}" y1="{cy - 3:.1f}" x2="{x_lo:.1f}" y2="{cy + 3:.1f}" stroke="{SECONDARY}" stroke-width="1.5"/>'
            f'<line x1="{x_hi:.1f}" y1="{cy - 3:.1f}" x2="{x_hi:.1f}" y2="{cy + 3:.1f}" stroke="{SECONDARY}" stroke-width="1.5"/>')


def legend(x: float, y: float) -> str:
    parts = [
        f'<rect x="{x}" y="{y}" width="12" height="12" rx="3" fill="{UNASSISTED}"/>',
        text(x + 18, y + 10, "Unassisted", 11.5, SECONDARY, anchor="start"),
        f'<rect x="{x + 108}" y="{y}" width="12" height="12" rx="3" fill="{GROUNDED}"/>',
        text(x + 126, y + 10, "With Canary data", 11.5, SECONDARY, anchor="start"),
        text(x + 258, y + 10, "whiskers: Wilson 95% CI", 10.5, MUTED, anchor="start"),
    ]
    return "".join(parts)


def fig_models(models: list) -> str:
    W, H = 640, 312
    left, right, top, base = 44.0, 18.0, 54.0, 270.0

    def sy(v: float) -> float:
        return base - v / 100 * (base - top)

    e: list[str] = []
    for v in (0, 25, 50, 75, 100):
        y = sy(v)
        e.append(f'<line x1="{left}" y1="{y:.1f}" x2="{W - right}" y2="{y:.1f}" '
                 f'stroke="{BASELINE if v == 0 else GRID}" stroke-width="1"/>')
        e.append(text(left - 8, y + 3.5, str(v), 10, MUTED, anchor="end"))
    e.append(legend(left, 12))

    pitch = (W - left - right) / len(models)
    bw, gap = 22.0, 2.0
    for i, (name, ua, gr) in enumerate(models):
        cx = left + (i + 0.5) * pitch
        for (v, ci), fill, x in ((ua, UNASSISTED, cx - bw - gap / 2), (gr, GROUNDED, cx + gap / 2)):
            e.append(column(x, base, sy(v), bw, fill))
            y_hi = sy(ci[1] * 100)
            e.append(vwhisker(x + bw / 2, sy(ci[0] * 100), y_hi))
            e.append(text(x + bw / 2, min(sy(v), y_hi) - 6, str(v), 11, INK, weight="600"))
        e.append(text(cx, base + 21, name, 11.5, SECONDARY))

    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
            f'font-family="{FONT}" role="img" aria-labelledby="f1t f1d">'
            f'<title id="f1t">Overall accuracy by model and condition</title>'
            f'<desc id="f1d">Grouped bar chart with Wilson 95 percent confidence whiskers. '
            f'Values: {"; ".join(f"{n} {u[0]} to {g[0]}" for n, u, g in models)} percent.</desc>'
            + "".join(e) + "</svg>")


def fig_blocks(blocks: list) -> str:
    W, H = 640, 408
    left, right, top = 134.0, 36.0, 46.0
    pitch, bh, gap = 46.0, 15.0, 2.0
    bottom = top + pitch * len(blocks)

    def sx(v: float) -> float:
        return left + v / 100 * (W - left - right)

    e: list[str] = []
    for v in (0, 25, 50, 75, 100):
        x = sx(v)
        e.append(f'<line x1="{x:.1f}" y1="{top}" x2="{x:.1f}" y2="{bottom}" '
                 f'stroke="{BASELINE if v == 0 else GRID}" stroke-width="1"/>')
        e.append(text(x, bottom + 16, str(v), 10, MUTED))
    e.append(legend(left, 12))

    for j, (name, ua, gr) in enumerate(blocks):
        gy = top + j * pitch
        e.append(text(left - 10, gy + pitch / 2 + 3.5, name, 11.5, SECONDARY, anchor="end"))
        for (v, ci), fill, y in ((ua, UNASSISTED, gy + 7), (gr, GROUNDED, gy + 7 + bh + gap)):
            e.append(hbar(left, sx(v), y, bh, fill))
            x_hi = sx(ci[1] * 100)
            e.append(hwhisker(y + bh / 2, sx(ci[0] * 100), x_hi))
            e.append(text(max(sx(v), x_hi) + 5, y + bh / 2 + 3.5, str(v), 10.5, INK,
                          anchor="start", weight="600"))

    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
            f'font-family="{FONT}" role="img" aria-labelledby="f2t f2d">'
            f'<title id="f2t">Accuracy by question block, pooled across the five models</title>'
            f'<desc id="f2d">Grouped horizontal bar chart with Wilson 95 percent confidence whiskers. '
            f'Values: {"; ".join(f"{n} {u[0]} to {g[0]}" for n, u, g in blocks)} percent.</desc>'
            + "".join(e) + "</svg>")


def main() -> None:
    models, blocks = load()
    OUT.mkdir(parents=True, exist_ok=True)
    for name, svg in (("fig1_models.svg", fig_models(models)), ("fig2_blocks.svg", fig_blocks(blocks))):
        (OUT / name).write_text(svg)
        print(f"[figures] wrote {OUT / name}")


if __name__ == "__main__":
    main()
