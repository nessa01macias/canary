"""Human audit sample of LLM-judge verdicts (the check RESEARCH.md §8 owes).

Stratified draw across (provider × verdict) from the LATEST judged run per provider,
so refusal-heavy and wrong-heavy providers are both represented. Output is a CSV a
human can grade in minutes: read question, expected, answer, judge's verdict; fill
`human_agrees` with y/n. Disagreement rate = the judge's error bar for the writeup.

Usage:
    python -m app.benchmark.audit          # -> data/processed/benchmark_audit_sample.csv
"""

from __future__ import annotations

import csv
import json
import random
from collections import defaultdict

from app.pipeline import core

QUESTIONS = core.PROCESSED_DIR / "benchmark_v0.json"
RUNS_DIR = core.PROCESSED_DIR / "benchmark_runs"
OUT = core.PROCESSED_DIR / "benchmark_audit_sample.csv"
PER_CELL = 2  # verdicts sampled per (provider, verdict) cell
SEED = 2026  # deterministic draw: re-runs produce the same sample


def main() -> None:
    bench = {q["id"]: q for q in json.loads(QUESTIONS.read_text())["questions"]}

    latest: dict[str, dict] = {}
    for path in sorted(RUNS_DIR.glob("*.judged.json")):
        j = json.loads(path.read_text())
        latest[j["provider"]] = j
    answers: dict[str, dict[str, str]] = {}
    for path in sorted(RUNS_DIR.glob("*.json")):
        if path.name.endswith(".judged.json"):
            continue
        r = json.loads(path.read_text())
        answers[r["provider"]] = {a["id"]: a["answer"] for a in r["answers"] if a["status"] == "ok"}

    rng = random.Random(SEED)
    rows = []
    for provider, judged in latest.items():
        by_verdict: dict[str, list[dict]] = defaultdict(list)
        for v in judged["verdicts"]:
            if v["verdict"] in ("correct", "wrong", "nonanswer"):
                by_verdict[v["verdict"]].append(v)
        for verdict, pool in sorted(by_verdict.items()):
            for v in rng.sample(pool, min(PER_CELL, len(pool))):
                item = bench[v["id"]]
                rows.append(
                    {
                        "provider": provider,
                        "id": v["id"],
                        "type": item["type"],
                        "question": item["question"],
                        "expected": str(item["expected"]),
                        "answer": answers.get(provider, {}).get(v["id"], "")[:600].replace("\n", " "),
                        "judge_verdict": v["verdict"],
                        "judge_reason": v.get("reason", ""),
                        "human_agrees": "",
                    }
                )

    rng.shuffle(rows)
    with OUT.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"[audit] {len(rows)} verdicts sampled -> {OUT.relative_to(core.DATA_DIR)}")
    print("        grade `human_agrees` y/n; disagreement rate = the judge's error bar")


if __name__ == "__main__":
    main()
