"""Generate the research-note figures (SVG) from the frozen v1 benchmark results.

Numbers are the judged results in RESEARCH.md Tables 1 and 2 (question set frozen
at 064dc90; raw verdicts in backend/data/processed/benchmark_runs_v1/). The
figures ship to frontend/public/research/ and are embedded by RESEARCH.md.

Palette: brand orange #FF6624 (grounded) and indigo snapped to #3A43C9
(unassisted; the brand #2329A8 sits below the mark-lightness band, so the hue is
kept and the step lightened). Pair validated for CVD separation and contrast on
the white paper surface; the orange sits at 2.93:1, which is legal because every
bar carries a value label and Tables 1-2 are the table view of the same data.

Usage:  python scripts/gen_figures.py
"""

from __future__ import annotations

from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "research"

# Series colors (validated pair; see module docstring).
UNASSISTED = "#3A43C9"
GROUNDED = "#FF6624"
# Text and chrome tokens: ink for values, secondary for names, muted for ticks;
# warm hairlines matched to the paper's rules (#d9d2c7 family).
INK = "#1c1a17"
SECONDARY = "#45403a"
MUTED = "#8a837b"
GRID = "#efe8dc"
BASELINE = "#d9d2c7"
FONT = "ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

# RESEARCH.md Table 1 (overall accuracy, %). Sol's grounded 100 is 41/41 judged;
# the figure caption in RESEARCH.md carries that qualifier.
MODELS = [
    ("Claude Fable 5", 43, 100),
    ("Grok 4.5", 42, 100),
    ("GPT-5.6 Sol", 42, 100),
    ("GPT-5 search", 36, 95),
    ("Sonar-pro", 45, 93),
]

# RESEARCH.md Table 2 (accuracy by block, pooled across the five models, %).
BLOCKS = [
    ("Superlative", 0, 91),
    ("Numeric", 0, 100),
    ("Pairwise", 64, 93),
    ("Direction", 55, 100),
    ("Address-level", 13, 93),
    ("Temporal", 95, 100),
    ("Distractors", 100, 100),
]


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


def legend(x: float, y: float) -> str:
    """Two-series legend; swatches carry identity, text wears text tokens."""
    parts = [
        f'<rect x="{x}" y="{y}" width="12" height="12" rx="3" fill="{UNASSISTED}"/>',
        text(x + 18, y + 10, "Unassisted", 11.5, SECONDARY, anchor="start"),
        f'<rect x="{x + 108}" y="{y}" width="12" height="12" rx="3" fill="{GROUNDED}"/>',
        text(x + 126, y + 10, "Grounded (one Canary response)", 11.5, SECONDARY, anchor="start"),
    ]
    return "".join(parts)


def fig_models() -> str:
    W, H = 640, 312
    left, right, top, base = 44.0, 18.0, 54.0, 270.0

    def sy(v: float) -> float:
        return base - v / 100 * (base - top)

    e: list[str] = []
    # Gridlines: solid hairlines one step off the surface; baseline slightly darker.
    for v in (0, 25, 50, 75, 100):
        y = sy(v)
        e.append(f'<line x1="{left}" y1="{y:.1f}" x2="{W - right}" y2="{y:.1f}" '
                 f'stroke="{BASELINE if v == 0 else GRID}" stroke-width="1"/>')
        e.append(text(left - 8, y + 3.5, str(v), 10, MUTED, anchor="end"))
    e.append(legend(left, 12))

    pitch = (W - left - right) / len(MODELS)
    bw, gap = 22.0, 2.0
    for i, (name, bare, grounded) in enumerate(MODELS):
        cx = left + (i + 0.5) * pitch
        for v, fill, x in ((bare, UNASSISTED, cx - bw - gap / 2), (grounded, GROUNDED, cx + gap / 2)):
            e.append(column(x, base, sy(v), bw, fill))
            e.append(text(x + bw / 2, (sy(v) if v > 0 else base) - 6, str(v), 11, INK, weight="600"))
        e.append(text(cx, base + 21, name, 11.5, SECONDARY))

    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
            f'font-family="{FONT}" role="img" aria-labelledby="f1t f1d">'
            f'<title id="f1t">Overall accuracy by model and condition</title>'
            f'<desc id="f1d">Grouped bar chart. Unassisted accuracy sits between 36 and 45 percent '
            f'for all five models; with one Canary response prepended it rises to between 93 and '
            f'100 percent. Values: {"; ".join(f"{n} {b} to {g}" for n, b, g in MODELS)}.</desc>'
            + "".join(e) + "</svg>")


def fig_blocks() -> str:
    W, H = 640, 408
    left, right, top = 134.0, 36.0, 46.0
    pitch, bh, gap = 46.0, 15.0, 2.0
    bottom = top + pitch * len(BLOCKS)

    def sx(v: float) -> float:
        return left + v / 100 * (W - left - right)

    e: list[str] = []
    for v in (0, 25, 50, 75, 100):
        x = sx(v)
        e.append(f'<line x1="{x:.1f}" y1="{top}" x2="{x:.1f}" y2="{bottom}" '
                 f'stroke="{BASELINE if v == 0 else GRID}" stroke-width="1"/>')
        e.append(text(x, bottom + 16, str(v), 10, MUTED))
    e.append(legend(left, 12))

    for j, (name, bare, grounded) in enumerate(BLOCKS):
        gy = top + j * pitch
        e.append(text(left - 10, gy + pitch / 2 + 3.5, name, 11.5, SECONDARY, anchor="end"))
        for v, fill, y in ((bare, UNASSISTED, gy + 7), (grounded, GROUNDED, gy + 7 + bh + gap)):
            e.append(hbar(left, sx(v), y, bh, fill))
            e.append(text((sx(v) if v > 0 else left) + 5, y + bh / 2 + 3.5, str(v), 10.5, INK,
                          anchor="start", weight="600"))

    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
            f'font-family="{FONT}" role="img" aria-labelledby="f2t f2d">'
            f'<title id="f2t">Accuracy by question block, pooled across the five models</title>'
            f'<desc id="f2d">Grouped horizontal bar chart of unassisted versus grounded accuracy '
            f'per block. Values: {"; ".join(f"{n} {b} to {g}" for n, b, g in BLOCKS)}.</desc>'
            + "".join(e) + "</svg>")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, svg in (("fig1_models.svg", fig_models()), ("fig2_blocks.svg", fig_blocks())):
        (OUT / name).write_text(svg)
        print(f"[figures] wrote {OUT / name}")


if __name__ == "__main__":
    main()
