"""Score benchmark runs against ground truth.

Mechanical where safe, honest where not: direction/superlative/numeric answers are
auto-judged only when the verdict is unambiguous; everything else lands in
benchmark_review.csv for a human pass. Accuracy is reported on auto-scored items
only, with the review count shown alongside -- never bury the ambiguity.

Usage:
    python -m app.benchmark.score          # scores the latest run per provider
"""

from __future__ import annotations

import csv
import json
import re
from collections import defaultdict

from app.pipeline import core

QUESTIONS = core.PROCESSED_DIR / "benchmark_v0.json"
RUNS_DIR = core.PROCESSED_DIR / "benchmark_runs"
REVIEW_CSV = core.PROCESSED_DIR / "benchmark_review.csv"

INCREASE = r"\b(ris(?:e|ing)|increas\w*|up(?:ward)?|grow\w*|grew|higher|more|worse|worsening|climb\w*|surg\w*)\b"
DECREASE = r"\b(fall\w*|declin\w*|decreas\w*|down(?:ward)?|fewer|lower|less|better|improv\w*|drop\w*|shrink\w*|subsid\w*)\b"


def detect_direction(answer: str) -> str | None:
    a = answer.lower()
    inc, dec = bool(re.search(INCREASE, a)), bool(re.search(DECREASE, a))
    if inc and not dec:
        return "increase"
    if dec and not inc:
        return "decrease"
    return None  # both/neither -> human review


def judge(item: dict, answer: str) -> str:
    """-> 'correct' | 'wrong' | 'review'"""
    a = answer.lower()
    if item["type"] == "direction":
        got = detect_direction(answer)
        if got is None:
            return "review"
        return "correct" if got == item["expected"] else "wrong"

    if item["type"] == "superlative":
        if item["expected"].lower() in a:
            return "correct"
        # named a different SF neighborhood instead -> wrong, else unclear
        return "wrong" if re.search(r"\b(district|valley|heights|hill|beach|park|mission|sunset|richmond)\b", a) else "review"

    if item["type"] == "numeric":
        nums = [float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*\.?\d*", answer)]
        nums = [n for n in nums if n >= 10]  # ignore years-fragments/small counts
        nums = [n for n in nums if not (1990 <= n <= 2030)]  # ignore years
        if not nums:
            return "review"
        expected, tol = float(item["expected"]), item.get("tolerance_pct", 25) / 100
        return "correct" if any(abs(n - expected) <= tol * expected for n in nums) else "wrong"

    if item["type"] == "fact":
        gt = item.get("ground_truth", {})
        units = gt.get("units")
        nums = [float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*\.?\d*", answer)]
        if re.search(r"\b(no|not aware|none|unaware|cannot|don't know)\b", a) and not nums:
            return "wrong"
        if units and any(abs(n - units) <= 0.3 * units for n in nums):
            return "correct"
        return "review"

    return "review"


def latest_run_per_provider() -> dict[str, dict]:
    runs: dict[str, dict] = {}
    for path in sorted(RUNS_DIR.glob("*.json")):
        run = json.loads(path.read_text())
        runs[run["provider"]] = run  # sorted -> last wins = latest
    return runs


def main() -> None:
    bench = {q["id"]: q for q in json.loads(QUESTIONS.read_text())["questions"]}
    runs = latest_run_per_provider()
    if not runs:
        raise SystemExit(f"No runs in {RUNS_DIR} -- run `python -m app.benchmark.run` first")

    review_rows = []
    print(f"\n{'provider':<32}{'correct':>9}{'wrong':>7}{'review':>8}{'acc (scored)':>14}")
    per_type: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for provider, run in runs.items():
        tally = {"correct": 0, "wrong": 0, "review": 0}
        for a in run["answers"]:
            if a["status"] != "ok" or a["id"] not in bench:
                continue
            item = bench[a["id"]]
            verdict = judge(item, a["answer"])
            tally[verdict] += 1
            per_type[item["type"]][verdict] += 1
            if verdict == "review":
                review_rows.append(
                    {
                        "provider": provider,
                        "id": a["id"],
                        "type": item["type"],
                        "question": item["question"],
                        "expected": item["expected"],
                        "answer": a["answer"].replace("\n", " "),
                        "human_verdict": "",
                    }
                )
        scored = tally["correct"] + tally["wrong"]
        acc = f"{tally['correct'] / scored:.0%}" if scored else "—"
        print(f"{provider:<32}{tally['correct']:>9}{tally['wrong']:>7}{tally['review']:>8}{acc:>14}")

    print("\nby question type (all providers pooled):")
    for qtype, t in per_type.items():
        scored = t["correct"] + t["wrong"]
        acc = f"{t['correct'] / scored:.0%}" if scored else "—"
        print(f"  {qtype:<14} correct={t['correct']:<4} wrong={t['wrong']:<4} review={t['review']:<4} acc={acc}")

    if review_rows:
        with REVIEW_CSV.open("w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(review_rows[0].keys()))
            writer.writeheader()
            writer.writerows(review_rows)
        print(f"\n{len(review_rows)} answers need human review -> {REVIEW_CSV.relative_to(core.DATA_DIR)}")


if __name__ == "__main__":
    main()
