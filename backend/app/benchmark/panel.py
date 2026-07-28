"""Cross-vendor judge panel: re-grade every v1 answer with judges from two more vendors.

The primary judge (claude-sonnet-5, judge.py) was the pre-specified grader and stays
the primary estimator; the panel is a robustness check and is reported as such (the
estimator is never swapped after seeing results). Every judge receives the identical
prompt (judge.build_prompt). Panel verdicts land under benchmark_runs_v1/panel/<judge>/
and never touch the primary judged files.

Known vendor overlaps, disclosed rather than hidden: gpt-5.6-sol and grok-4.5 are
themselves tested systems, and the primary judge shares a vendor with one tested
system. No judge grades alone (majority of three vendors), and --agree computes a
direct self-preference probe: does a judge rate its own vendor's answers 'correct'
more often than the other two judges rate the same answers?

Usage:
    python -m app.benchmark.panel                  # run all configured panel judges
    python -m app.benchmark.panel --judge xai      # one judge (enables parallel shells)
    python -m app.benchmark.panel --agree          # agreement stats + majority table
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from collections import Counter, defaultdict
from itertools import combinations

import requests
from dotenv import load_dotenv

from app.pipeline import core

from .judge import JUDGE_SYSTEM, build_prompt

QUESTIONS = core.PROCESSED_DIR / os.environ.get("BENCH_FILE", "benchmark_v1.json")
RUNS_DIR = core.PROCESSED_DIR / os.environ.get("BENCH_RUNS", "benchmark_runs_v1")
PANEL_DIR = RUNS_DIR / "panel"
OUT = core.PROCESSED_DIR / f"{QUESTIONS.stem}_panel.json"

# slug -> (base_url, key_env, model_env, default_model)
PANEL_JUDGES = {
    "openai": ("https://api.openai.com/v1", "OPENAI_API_KEY", "PANEL_JUDGE_OPENAI", "gpt-5.6-sol"),
    "xai": ("https://api.x.ai/v1", "XAI_API_KEY", "PANEL_JUDGE_XAI", os.environ.get("XAI_MODEL", "grok-4.5")),
}
VERDICTS = ("correct", "wrong", "nonanswer")


def judge_openai_compatible(base_url: str, key: str, model: str, item: dict, answer: str) -> dict:
    for attempt in range(5):
        resp = requests.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": JUDGE_SYSTEM},
                    {"role": "user", "content": build_prompt(item, answer)},
                ],
            },
            timeout=120,
        )
        if resp.status_code == 429 and attempt < 4:
            time.sleep(8 * (attempt + 1))
            continue
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"]
        match = re.search(r"\{.*\}", text, re.DOTALL)
        return json.loads(match.group(0)) if match else {"verdict": "judge_error", "reason": text[:100]}
    raise requests.RequestException("429 retries exhausted")


def run_panel(only_judge: str | None) -> None:
    load_dotenv(core.BACKEND_DIR / ".env")
    bench = {q["id"]: q for q in json.loads(QUESTIONS.read_text())["questions"]}

    for slug, (base_url, key_env, model_env, default_model) in PANEL_JUDGES.items():
        if only_judge and slug != only_judge:
            continue
        key = os.environ.get(key_env)
        if not key:
            print(f"[panel] {slug}: no {key_env}, skipping")
            continue
        model = os.environ.get(model_env, default_model)
        outdir = PANEL_DIR / slug
        outdir.mkdir(parents=True, exist_ok=True)

        for run_path in sorted(RUNS_DIR.glob("*.json")):
            if run_path.name.endswith(".judged.json"):
                continue
            outpath = outdir / run_path.name.replace(".json", ".judged.json")
            if outpath.exists():
                continue
            run = json.loads(run_path.read_text())
            print(f"[panel:{slug}/{model}] {run['provider']}")
            verdicts = []
            for a in run["answers"]:
                if a["status"] != "ok" or a["id"] not in bench:
                    continue
                try:
                    v = judge_openai_compatible(base_url, key, model, bench[a["id"]], a["answer"])
                except (requests.RequestException, json.JSONDecodeError) as exc:
                    v = {"verdict": "judge_error", "reason": str(exc)[:100]}
                verdicts.append({"id": a["id"], **v})
                time.sleep(0.1)
            outpath.write_text(json.dumps(
                {"provider": run["provider"], "judge_model": model, "run_file": run_path.name, "verdicts": verdicts},
                indent=1,
            ))
            n_ok = sum(1 for v in verdicts if v["verdict"] != "judge_error")
            print(f"        {n_ok}/{len(verdicts)} judged -> panel/{slug}/{outpath.name}")


def _load_verdicts(directory) -> dict[tuple[str, str], str]:
    """(provider, question_id) -> verdict, from the latest judged file per provider."""
    latest: dict[str, dict] = {}
    for path in sorted(directory.glob("*.judged.json")):
        j = json.loads(path.read_text())
        latest[j["provider"]] = j
    out: dict[tuple[str, str], str] = {}
    for j in latest.values():
        for v in j["verdicts"]:
            out[(j["provider"], v["id"])] = v["verdict"]
    return out


def fleiss_kappa(rows: list[Counter]) -> float:
    """rows: one Counter of category counts per item; all items same rater count."""
    n = sum(rows[0].values())
    big_n = len(rows)
    p_j = {c: sum(r[c] for r in rows) / (big_n * n) for c in VERDICTS}
    p_bar = sum((sum(r[c] ** 2 for c in VERDICTS) - n) / (n * (n - 1)) for r in rows) / big_n
    p_e = sum(v ** 2 for v in p_j.values())
    return (p_bar - p_e) / (1 - p_e) if p_e < 1 else 1.0


def agree() -> None:
    judges = {"anthropic": _load_verdicts(RUNS_DIR)}
    for slug in PANEL_JUDGES:
        d = PANEL_DIR / slug
        if d.exists():
            judges[slug] = _load_verdicts(d)
    names = list(judges)
    if len(names) < 3:
        raise SystemExit(f"need 3 judges, have {names}; run the panel first")

    keys = set.intersection(*(set(v) for v in judges.values()))
    complete = [k for k in keys if all(judges[j][k] in VERDICTS for j in names)]
    dropped = len(keys) - len(complete)

    # Pairwise raw agreement + Fleiss kappa over items with all three verdicts parsed.
    pair_agree = {
        f"{a}~{b}": sum(judges[a][k] == judges[b][k] for k in complete) / len(complete)
        for a, b in combinations(names, 2)
    }
    kappa = fleiss_kappa([Counter(judges[j][k] for j in names) for k in complete])
    unanimous = sum(len({judges[j][k] for j in names}) == 1 for k in complete) / len(complete)

    # Majority verdicts and the accuracy table under them (vs primary alone).
    table: dict[str, dict[str, float | str]] = {}
    no_majority = 0
    for k in complete:
        cnt = Counter(judges[j][k] for j in names)
        verdict, n = cnt.most_common(1)[0]
        if n < 2:
            no_majority += 1
            continue
        row = table.setdefault(k[0], defaultdict(int))
        row["n"] += 1
        row[f"maj_{verdict}"] += 1
        if judges["anthropic"][k] == "correct":
            row["primary_correct"] += 1

    # Self-preference probe: judge's correct-rate on its own vendor's answers minus
    # the other judges' correct-rate on the SAME answers.
    vendor_of = {"anthropic": "anthropic:", "openai": "openai:gpt-5.6-sol", "xai": "xai:"}
    self_pref = {}
    for j, prefix in vendor_of.items():
        own = [k for k in complete if k[0].startswith(prefix)]
        if not own:
            continue
        mine = sum(judges[j][k] == "correct" for k in own) / len(own)
        others = [o for o in names if o != j]
        theirs = sum(judges[o][k] == "correct" for o in others for k in own) / (len(own) * len(others))
        self_pref[j] = {"n_items": len(own), "own_correct_rate": round(mine, 4),
                        "other_judges_rate": round(theirs, 4), "delta": round(mine - theirs, 4)}

    report = {
        "judges": {j: ("claude-sonnet-5 (primary)" if j == "anthropic" else PANEL_JUDGES[j][3]) for j in names},
        "items_all_three_parsed": len(complete),
        "items_dropped_unparsed": dropped,
        "pairwise_agreement": {k: round(v, 4) for k, v in pair_agree.items()},
        "fleiss_kappa": round(kappa, 4),
        "unanimous_rate": round(unanimous, 4),
        "no_majority_items": no_majority,
        "per_provider": {
            p: {
                "n": r["n"],
                "majority_accuracy": round(r["maj_correct"] / r["n"], 4),
                "primary_accuracy": round(r["primary_correct"] / r["n"], 4),
            }
            for p, r in sorted(table.items())
        },
        "self_preference": self_pref,
    }
    OUT.write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))
    print(f"\n[panel] report -> {OUT}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--judge", choices=list(PANEL_JUDGES), help="run one panel judge only")
    parser.add_argument("--agree", action="store_true", help="compute agreement report")
    args = parser.parse_args()
    if args.agree:
        agree()
    else:
        run_panel(args.judge)


if __name__ == "__main__":
    main()
