"""Statistics for the research note: every published number, derived from artifacts.

Emits Table 1 (per model) and Table 2 (per block, pooled) with exact counts,
Wilson 95% confidence intervals, and an exact McNemar test per model (paired by
question, unassisted vs grounded). The paper's tables are pasted from this
output; if this script and the paper disagree, the paper is wrong.

Block mapping note: q042 (Tenderloin, victim-reported crime) is typed
'direction' in the frozen artifact but was designed as the second distractor
(the enforcement-vs-victimization decomposition; see RESEARCH.md §2.2). The
analysis classifies q042 with the distractors; this mapping is disclosed in the
paper so a reproducer's tables match these.

Usage:
    python -m app.benchmark.stats      # -> prints tables, writes benchmark_v1_stats.json
"""

from __future__ import annotations

import json
import math
import os
from collections import defaultdict

from app.pipeline import core

QUESTIONS = core.PROCESSED_DIR / os.environ.get("BENCH_FILE", "benchmark_v1.json")
RUNS_DIR = core.PROCESSED_DIR / os.environ.get("BENCH_RUNS", "benchmark_runs_v1")
OUT = core.PROCESSED_DIR / f"{QUESTIONS.stem}_stats.json"

MODEL_NAMES = {
    "anthropic:claude-fable-5": "Claude Fable 5",
    "xai:grok-4.5": "Grok 4.5",
    "openai:gpt-5.6-sol": "GPT-5.6 Sol",
    "openai-search:gpt-5-search-api": "GPT-5 search",
    "perplexity:sonar-pro": "Perplexity sonar-pro",
}
BLOCK_LABELS = {
    "superlative": "Superlative",
    "numeric": "Numeric",
    "pairwise": "Pairwise (chance = 50%)",
    "direction": "Direction",
    "address_forward": "Address-level",
    "temporal": "Temporal (in training window)",
    "distractor": "Distractors",
}
BLOCK_ORDER = ["superlative", "numeric", "pairwise", "direction", "address_forward", "temporal", "distractor"]
# v1 only: its second distractor is typed 'direction' in the frozen artifact
# (disclosed in RESEARCH.md 2.2). v2 types every trap properly.
DISTRACTOR_IDS = {"q042", "q043"} if "v1" in QUESTIONS.stem else set()


def wilson(correct: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = correct / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


def mcnemar_exact(b: int, c: int) -> float:
    """Two-sided exact McNemar on discordant pairs (b, c)."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(math.comb(n, i) for i in range(k + 1)) * 0.5 ** n
    return min(1.0, 2 * tail)


def block_of(q: dict) -> str:
    if q["id"] in DISTRACTOR_IDS:
        return "distractor"
    return q["type"] if q["type"] != "trap" else "distractor"


def load() -> tuple[dict, dict]:
    bench = {q["id"]: q for q in json.loads(QUESTIONS.read_text())["questions"]}
    latest: dict[str, dict] = {}
    for path in sorted(RUNS_DIR.glob("*.judged.json")):
        j = json.loads(path.read_text())
        latest[j["provider"]] = j
    return bench, latest


def main() -> None:
    bench, latest = load()

    # cells[(base_provider, condition)] -> per-question verdicts
    cells: dict[tuple[str, str], dict[str, dict]] = defaultdict(dict)
    unparsed = 0
    for provider, j in latest.items():
        base = provider.removesuffix("+canary")
        cond = "grounded" if provider.endswith("+canary") else "unassisted"
        for v in j["verdicts"]:
            if v["verdict"] not in ("correct", "wrong", "nonanswer"):
                unparsed += 1
                continue
            cells[(base, cond)][v["id"]] = v

    per_model = []
    for base, name in MODEL_NAMES.items():
        row: dict = {"model": name, "provider": base}
        for cond in ("unassisted", "grounded"):
            vs = cells[(base, cond)]
            n = len(vs)
            c = sum(1 for v in vs.values() if v["verdict"] == "correct")
            lo, hi = wilson(c, n)
            row[cond] = {
                "correct": c, "n": n, "acc": round(c / n, 4) if n else None,
                "ci": [round(lo, 4), round(hi, 4)],
                "nonanswer": sum(1 for v in vs.values() if v["verdict"] == "nonanswer"),
            }
        row["confident_wrong_unassisted"] = sum(
            1 for v in cells[(base, "unassisted")].values() if v.get("confident_wrong")
        )
        paired = set(cells[(base, "unassisted")]) & set(cells[(base, "grounded")])
        b = sum(1 for q in paired
                if cells[(base, "unassisted")][q]["verdict"] == "correct"
                and cells[(base, "grounded")][q]["verdict"] != "correct")
        cnt = sum(1 for q in paired
                  if cells[(base, "unassisted")][q]["verdict"] != "correct"
                  and cells[(base, "grounded")][q]["verdict"] == "correct")
        row["mcnemar"] = {"paired_n": len(paired), "b": b, "c": cnt, "p": mcnemar_exact(b, cnt)}
        per_model.append(row)

    per_block = []
    for block in BLOCK_ORDER:
        qids = {qid for qid, q in bench.items() if block_of(q) == block}
        entry: dict = {"block": BLOCK_LABELS[block], "questions_per_model": len(qids)}
        for cond in ("unassisted", "grounded"):
            c = n = 0
            for base in MODEL_NAMES:
                for qid in qids:
                    v = cells[(base, cond)].get(qid)
                    if v:
                        n += 1
                        c += v["verdict"] == "correct"
            lo, hi = wilson(c, n)
            entry[cond] = {"correct": c, "n": n, "acc": round(c / n, 4) if n else None,
                           "ci": [round(lo, 4), round(hi, 4)]}
        per_block.append(entry)

    report = {"unparsed_after_repair": unparsed, "per_model": per_model, "per_block": per_block}
    OUT.write_text(json.dumps(report, indent=1))

    def fmt(cell: dict) -> str:
        return f"{cell['acc']:.0%} [{cell['ci'][0]:.0%}, {cell['ci'][1]:.0%}] ({cell['correct']}/{cell['n']})"

    print(f"unparsed verdicts remaining after repair: {unparsed}\n")
    print("TABLE 1 (per model)")
    for r in per_model:
        p = r["mcnemar"]["p"]
        print(f"  {r['model']:<22} U {fmt(r['unassisted']):<28} G {fmt(r['grounded']):<28} "
              f"cw {r['confident_wrong_unassisted']:>2}/43  nonans(U) {r['unassisted']['nonanswer']:>2}  "
              f"McNemar b={r['mcnemar']['b']} c={r['mcnemar']['c']} p={p:.2e}")
    print("\nTABLE 2 (per block, pooled)")
    for e in per_block:
        print(f"  {e['block']:<32} U {fmt(e['unassisted']):<28} G {fmt(e['grounded'])}")
    print(f"\n[stats] -> {OUT}")


if __name__ == "__main__":
    main()
