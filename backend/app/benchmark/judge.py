"""LLM judge: grade benchmark answers against fixed ground truth. No humans required.

VOYGR-style separation (their Extract/Verify/Score): the ground truth is pre-verified
(our receipts, attached to every question), so the judge never researches anything --
it only classifies whether the answer COMMITS to the recorded truth. That constraint is
what makes machine judging trustworthy here.

Verdicts:
  correct       commits to the ground-truth direction/name/number (numbers within tolerance)
  wrong         commits to a different one
  nonanswer     refuses, hedges without committing, or answers something else
Confidently-wrong answers are flagged (confident_wrong) -- per VOYGR's rule, a confident
wrong answer is worse than no answer: the user doesn't get nothing, they get misled.

Judge model: Anthropic (ANTHROPIC_API_KEY), temperature 0. Self-preference risk when
judging Claude's own answers is mitigated by the fixed-evidence design; spot-check the
stored reasons in *_judged.json if in doubt.

Usage:
    python -m app.benchmark.judge          # judge any un-judged runs, then print summary
"""

from __future__ import annotations

import json
import os
import re
import time
from collections import defaultdict

import requests
from dotenv import load_dotenv

from app.pipeline import core

QUESTIONS = core.PROCESSED_DIR / "benchmark_v0.json"
RUNS_DIR = core.PROCESSED_DIR / "benchmark_runs"

JUDGE_SYSTEM = (
    "You are a strict grader. You receive a question, verified ground truth from public "
    "records, and an AI assistant's answer. Classify ONLY whether the answer commits to "
    "the ground truth. Rules: verdict 'correct' if the answer commits to the ground-truth "
    "direction/name/number (numbers within the stated tolerance; treat 'better/improving' "
    "as decrease for crime/complaints and 'worse/worsening' as increase). Verdict 'wrong' "
    "if it commits to a different direction/name/number. Verdict 'nonanswer' if it "
    "refuses, hedges without committing, or answers a different question. Set "
    "confident_wrong=true only when verdict is wrong AND the answer shows no meaningful "
    "hedging. Respond with JSON only: "
    '{"verdict":"correct|wrong|nonanswer","confident_wrong":false,"reason":"<one line>"}'
)


def judge_one(key: str, model: str, item: dict, answer: str) -> dict:
    gt = {k: v for k, v in item.items() if k in ("expected", "tolerance_pct", "ground_truth", "scoring_note", "type", "metric", "area")}
    user = (
        f"QUESTION:\n{item['question']}\n\n"
        f"GROUND TRUTH (verified, {item['receipt']}):\n{json.dumps(gt)}\n\n"
        f"ASSISTANT'S ANSWER:\n{answer}"
    )
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
        json={
            "model": model,
            "max_tokens": 200,
            "temperature": 0,
            "system": JUDGE_SYSTEM,
            "messages": [{"role": "user", "content": user}],
        },
        timeout=120,
    )
    resp.raise_for_status()
    text = "".join(b.get("text", "") for b in resp.json()["content"])
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(match.group(0)) if match else {"verdict": "judge_error", "reason": text[:100]}


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="judge only run files whose name contains this (enables parallel judging)")
    args = parser.parse_args()

    load_dotenv(core.BACKEND_DIR / ".env")
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise SystemExit("ANTHROPIC_API_KEY required for judging")
    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5")

    bench = {q["id"]: q for q in json.loads(QUESTIONS.read_text())["questions"]}

    for run_path in sorted(RUNS_DIR.glob("*.json")):
        if run_path.name.endswith(".judged.json"):
            continue
        if args.only and args.only not in run_path.name:
            continue
        judged_path = run_path.with_suffix(".judged.json")
        if judged_path.exists():
            continue
        run = json.loads(run_path.read_text())
        print(f"[judge] {run['provider']} ({run_path.name})")
        verdicts = []
        for a in run["answers"]:
            if a["status"] != "ok" or a["id"] not in bench:
                continue
            try:
                v = judge_one(key, model, bench[a["id"]], a["answer"])
            except (requests.RequestException, json.JSONDecodeError) as exc:
                v = {"verdict": "judge_error", "reason": str(exc)[:100]}
            verdicts.append({"id": a["id"], **v})
            time.sleep(0.1)
        judged_path.write_text(
            json.dumps({"provider": run["provider"], "judge_model": model, "run_file": run_path.name, "verdicts": verdicts}, indent=1)
        )
        n_ok = sum(1 for v in verdicts if v["verdict"] != "judge_error")
        print(f"        {n_ok}/{len(verdicts)} judged -> {judged_path.name}")

    # ---- summary across all judged runs ----------------------------------------
    print(f"\n{'provider':<40}{'correct':>8}{'wrong':>7}{'nonans':>7}{'conf-wrong':>11}{'acc(all)':>9}{'acc(committed)':>15}")
    for judged_path in sorted(RUNS_DIR.glob("*.judged.json")):
        j = json.loads(judged_path.read_text())
        t: dict[str, int] = defaultdict(int)
        for v in j["verdicts"]:
            t[v["verdict"]] += 1
            if v.get("confident_wrong"):
                t["confident_wrong"] += 1
        committed = t["correct"] + t["wrong"]
        total = committed + t["nonanswer"]
        acc_all = f"{t['correct'] / total:.0%}" if total else "—"
        acc_com = f"{t['correct'] / committed:.0%}" if committed else "—"
        print(f"{j['provider']:<40}{t['correct']:>8}{t['wrong']:>7}{t['nonanswer']:>7}{t['confident_wrong']:>11}{acc_all:>9}{acc_com:>15}")


if __name__ == "__main__":
    main()
