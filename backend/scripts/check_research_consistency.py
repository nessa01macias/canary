#!/usr/bin/env python
"""Fail loudly when a number in the shipped docs contradicts the frozen artifacts.

WHY THIS EXISTS: the v2 run regenerated the tables and figures correctly, but every
hand-typed number elsewhere in RESEARCH.md stayed at v1 -- a block table summing to
43, alt text asserting the temporal control was near ceiling when the headline
finding is that it collapsed to 37%, and reproduce commands pointing at the pilot.
Nobody rereads a methods table. A script does.

Scope: the docs the site actually ships (ABOUT.md, RESEARCH.md, SOURCES.md via
Docs.tsx) plus BENCHMARK.md. Ground truth is the frozen artifact set, never a
constant retyped here.

    python scripts/check_research_consistency.py          # exit 1 on any mismatch
    python scripts/check_research_consistency.py --list   # show what it checked

Add a check whenever you publish a new derived number. The rule this enforces is
the one the paper argues for: a claim that cannot be re-derived from a receipt is
not a claim.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "backend" / "data" / "processed"

BENCH = json.loads((PROCESSED / "benchmark_v2.json").read_text(encoding="utf-8"))
STATS = json.loads((PROCESSED / "benchmark_v2_stats.json").read_text(encoding="utf-8"))
PANEL = json.loads((PROCESSED / "benchmark_v2_panel.json").read_text(encoding="utf-8"))
VERIFY = json.loads((PROCESSED / "benchmark_v2_verification.json").read_text(encoding="utf-8"))

RESEARCH = (ROOT / "RESEARCH.md").read_text(encoding="utf-8")
ABOUT = (ROOT / "ABOUT.md").read_text(encoding="utf-8")
BENCHMARK_MD = (ROOT / "BENCHMARK.md").read_text(encoding="utf-8")

# Block label in the RESEARCH.md design table -> key in the artifact's block_counts.
BLOCK_ROWS = {
    "Direction": "direction",
    "Superlative": "superlative",
    "Numeric": "numeric",
    "Pairwise": "pairwise",
    "Address-level": "address_forward",
    "Temporal": "temporal",
    "Distractors": "trap",
}

failures: list[str] = []
checked: list[str] = []


def check(name: str, ok: bool, detail: str) -> None:
    checked.append(name)
    if not ok:
        failures.append(f"{name}: {detail}")


def pct(x: float) -> int:
    return round(x * 100)


# --- 1. The design table must match the frozen block counts -------------------
for label, key in BLOCK_ROWS.items():
    want = BENCH["block_counts"][key]
    row = re.search(rf"^\|\s*{re.escape(label)}\s*\|\s*(\d+)\s*\|", RESEARCH, re.M)
    check(
        f"design table row '{label}'",
        bool(row) and int(row.group(1)) == want,
        f"table says {row.group(1) if row else 'MISSING'}, artifact says {want}",
    )

total = sum(BENCH["block_counts"].values())
check(
    "design table sums to the question count",
    total == BENCH["question_count"],
    f"blocks sum to {total}, question_count is {BENCH['question_count']}",
)
check(
    "question count stated in prose",
    f"{BENCH['question_count']} questions" in RESEARCH,
    f"RESEARCH.md never says '{BENCH['question_count']} questions'",
)
check(
    "question count stated in ABOUT",
    f"{BENCH['question_count']}\ncheckable" in ABOUT or f"{BENCH['question_count']} checkable" in ABOUT,
    f"ABOUT.md never says '{BENCH['question_count']} checkable'",
)

# --- 2. Headline accuracy range must bracket the per-model results ------------
unassisted = [m["unassisted"]["acc"] for m in STATS["per_model"]]
grounded = [m["grounded"]["acc"] for m in STATS["per_model"]]
def states_range(doc: str, lo: int, hi: int) -> bool:
    """Accept either the compact '25-47%' form or the prose '25% to 47%' form."""
    return f"{lo}-{hi}%" in doc or f"{lo}% to {hi}%" in doc


for doc, name in ((RESEARCH, "RESEARCH.md"), (ABOUT, "ABOUT.md")):
    lo, hi = pct(min(unassisted)), pct(max(unassisted))
    check(f"unassisted range in {name}", states_range(doc, lo, hi), f"expected {lo} to {hi} percent")
    glo, ghi = pct(min(grounded)), pct(max(grounded))
    check(f"grounded range in {name}", states_range(doc, glo, ghi), f"expected {glo} to {ghi} percent")

# --- 3. Per-block accuracies quoted in prose ----------------------------------
for block in STATS["per_block"]:
    label = block["block"].split(" (")[0]
    want = f"{pct(block['unassisted']['acc'])}%"
    row = re.search(rf"^\|\s*{re.escape(block['block'])}\s*\|\s*(\d+)%", RESEARCH, re.M)
    check(
        f"results table row '{label}'",
        bool(row) and f"{row.group(1)}%" == want,
        f"table says {row.group(1) + '%' if row else 'MISSING'}, artifact says {want}",
    )

# --- 4. Verdict bookkeeping ---------------------------------------------------
runs = PROCESSED / "benchmark_runs_v2"
verdicts = [v for p in runs.glob("*.judged.json") for v in json.loads(p.read_text())["verdicts"]]
n_verdicts = len(verdicts)
n_repaired = sum(1 for v in verdicts if v.get("repaired"))
n_unparsed = sum(1 for v in verdicts if v["verdict"] not in ("correct", "wrong", "nonanswer"))
check(
    "verdict total",
    f"{n_verdicts:,}" in RESEARCH,
    f"RESEARCH.md never states the true verdict total {n_verdicts:,}",
)
check(
    "repair pass counts",
    f"{n_repaired + n_unparsed} of {n_verdicts:,}" in RESEARCH and f"healed {n_repaired}" in RESEARCH,
    f"expected '{n_repaired + n_unparsed} of {n_verdicts:,}' and 'healed {n_repaired}'",
)
check(
    "unparsed exclusions",
    f"{n_unparsed} of {n_verdicts:,}" in RESEARCH or f"three of {n_verdicts:,}" in RESEARCH,
    f"expected the excluded count over denominator {n_verdicts:,}",
)

# --- 5. Panel figures ---------------------------------------------------------
check(
    "panel kappa",
    f"{PANEL['fleiss_kappa']:.2f}" in RESEARCH,
    f"expected kappa {PANEL['fleiss_kappa']:.2f}",
)
check(
    "panel item count",
    str(PANEL["items_all_three_parsed"]) in RESEARCH,
    f"expected {PANEL['items_all_three_parsed']} triple-parsed items",
)

# --- 6. Verification figures --------------------------------------------------
confirmed = VERIFY["summary"]["confirmed"]
check(
    "verification confirmed count",
    str(confirmed) in RESEARCH,
    f"expected {confirmed} confirmed",
)

# --- 7. Salience-convergence claims in 3.1, recomputed from the raw answers ---
# The paper claims wrong superlative answers cluster on a few salient names. That
# claim is derived, so it gets re-derived here rather than trusted.
ALIASES = [
    ("tenderloin", "Tenderloin"), ("mission bay", "Mission Bay"), ("mission", "Mission"),
    ("soma", "SoMa"), ("south of market", "SoMa"), ("hayes valley", "Hayes Valley"),
    ("financial district", "FiDi/South Beach"), ("fidi", "FiDi/South Beach"),
    ("union square", "Union Square"), ("bayview", "Bayview"), ("sunset", "Sunset/Parkside"),
    ("lakeshore", "Lakeshore"), ("japantown", "Japantown"), ("north beach", "North Beach"),
    ("portola", "Portola"), ("mclaren", "McLaren Park"), ("twin peaks", "Twin Peaks"),
]


def canonical(text: str | None) -> str | None:
    low = (text or "")[:200].lower()
    for needle, name in ALIASES:
        if needle in low:
            return name
    return None


superlatives = [q for q in BENCH["questions"] if q["type"] == "superlative"]
answers: dict[str, dict[str, str]] = {}
for path in sorted(runs.glob("*.json")):
    if path.name.endswith(".judged.json") or "+canary" in path.name:
        continue
    run = json.loads(path.read_text())
    answers[run["provider"]] = {a["id"]: a.get("answer") for a in run["answers"] if a["status"] == "ok"}

wrong_names: dict[str, int] = {}
converged = unanimous = 0
for q in superlatives:
    picks = [canonical(by_id.get(q["id"])) for by_id in answers.values()]
    picks = [p for p in picks if p]
    truth = canonical(q["expected"])
    counts: dict[str, int] = {}
    for p in picks:
        counts[p] = counts.get(p, 0) + 1
        if p != truth:
            wrong_names[p] = wrong_names.get(p, 0) + 1
    if not counts:
        continue
    top, n = max(counts.items(), key=lambda kv: kv[1])
    if top != truth and n >= 3:
        converged += 1
    if top != truth and n == len(picks) >= 4:
        unanimous += 1

top3 = sorted(wrong_names.items(), key=lambda kv: -kv[1])[:3]
share = sum(n for _, n in top3) / sum(wrong_names.values())

check(
    "3.1 convergence count",
    f"same incorrect neighborhood on {'five' if converged == 5 else converged}" in RESEARCH
    or f"on {converged} items" in RESEARCH,
    f"recomputed {converged} items with 3+ models on one wrong answer",
)
check(
    "3.1 unanimous item",
    unanimous == 1 and "all five named the Tenderloin" in RESEARCH,
    f"recomputed {unanimous} unanimous-wrong item(s)",
)
for name, n in top3:
    label = {"Tenderloin": "Tenderloin appears 18 times", "Mission": "the Mission 14",
             "SoMa": "South of\nMarket 9"}.get(name)
    check(
        f"3.1 salience count for {name}",
        str(n) in RESEARCH and (label is None or label.replace("\n", " ") in " ".join(RESEARCH.split())),
        f"recomputed {name} = {n} wrong answers",
    )
named_wrong = sum(wrong_names.values())
top3_total = sum(n for _, n in top3)
check(
    "3.1 named-wrong denominator",
    f"41 of the {named_wrong} incorrect responses" in RESEARCH,
    f"recomputed {top3_total} of {named_wrong} wrong answers naming an area",
)
check(
    "3.1 concentration share",
    0.70 <= share <= 0.80 and "three quarters" in RESEARCH,
    f"top three names are {share:.0%} of wrong superlative answers that name an area",
)

# --- 8. No v1 residue presented as current ------------------------------------
STALE = {
    "generate_v1": "the v1 generator is quoted as if it rebuilds this study",
    "verify_v1_answers.py`)": "the v1 verifier is quoted as this study's verifier",
    "benchmark_runs_v1/*": "verdicts are sourced from the v1 run directory",
    "`data/processed/benchmark_v1.json` (questions": "artifacts point at the v1 question set",
    "2,443": "the old verdict denominator is still quoted",
    "n=4": "the v1 temporal block size is still quoted",
    "pilot scale": "results are still described as pilot scale",
    "near ceiling in both conditions": "alt text contradicts the temporal finding",
}
for needle, why in STALE.items():
    check(f"no stale marker '{needle}'", needle not in RESEARCH, why)

for needle in ("generate_v1", "2,443"):
    check(f"no stale marker '{needle}' in BENCHMARK.md", needle not in BENCHMARK_MD, "v1 residue")

# --- report -------------------------------------------------------------------
args = argparse.ArgumentParser()
args.add_argument("--list", action="store_true", help="print every check performed")
opts = args.parse_args()

if opts.list:
    for name in checked:
        mark = "FAIL" if any(f.startswith(name + ":") for f in failures) else "ok"
        print(f"  [{mark:>4}] {name}")

if failures:
    print(f"\n{len(failures)} of {len(checked)} consistency checks FAILED:\n", file=sys.stderr)
    for f in failures:
        print(f"  - {f}", file=sys.stderr)
    print("\nThe shipped docs disagree with the frozen artifacts. Fix the docs.", file=sys.stderr)
    sys.exit(1)

print(f"All {len(checked)} doc/artifact consistency checks passed.")
