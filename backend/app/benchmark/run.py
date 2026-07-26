"""Run the area benchmark against every LLM with a configured API key.

Providers activate by key presence in backend/.env -- add whichever you have:

    OPENAI_API_KEY        (model: $OPENAI_MODEL, default gpt-4o)
    ANTHROPIC_API_KEY     (model: $ANTHROPIC_MODEL, default claude-sonnet-4-5)
    GEMINI_API_KEY        (model: $GEMINI_MODEL, default gemini-2.5-pro)
    PERPLEXITY_API_KEY    (model: $PERPLEXITY_MODEL, default sonar-pro)
    XAI_API_KEY           (model: $XAI_MODEL, default grok-4)

The models are NOT given our data -- that's the point: the benchmark measures what an
AI assistant tells a mover today, versus the public record. Raw answers are saved per
provider under data/processed/benchmark_runs/ for scoring (score.py judges direction/
superlative/numeric mechanically where possible; ambiguous ones export to a review CSV).

Usage:
    python -m app.benchmark.run                # all configured providers
    python -m app.benchmark.run --provider openai --limit 5   # smoke test
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

from app.pipeline import core

QUESTIONS = core.PROCESSED_DIR / os.environ.get("BENCH_FILE", "benchmark_v1.json")
RUNS_DIR = core.PROCESSED_DIR / os.environ.get("BENCH_RUNS", "benchmark_runs_v1")

SYSTEM = (
    "You are a helpful assistant answering questions from someone deciding where to "
    "live in San Francisco. Answer concisely (2-4 sentences) and commit to a direct "
    "answer (e.g. rising vs falling, a number, a neighborhood name) with your best "
    "available knowledge. Do not refuse for lack of real-time data; give your best answer."
)


def ask_openai_compatible(base_url: str, key: str, model: str, question: str) -> str:
    resp = requests.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": question},
            ],
        },
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def ask_anthropic(key: str, model: str, question: str) -> str:
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
        json={
            "model": model,
            "max_tokens": 500,
            "system": SYSTEM,
            "messages": [{"role": "user", "content": question}],
        },
        timeout=120,
    )
    resp.raise_for_status()
    return "".join(b.get("text", "") for b in resp.json()["content"])


def ask_gemini(key: str, model: str, question: str) -> str:
    resp = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        params={"key": key},
        json={
            "system_instruction": {"parts": [{"text": SYSTEM}]},
            "contents": [{"parts": [{"text": question}]}],
        },
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["candidates"][0]["content"]["parts"][0]["text"]


def build_grounding(item: dict, trajectory_rows: list[dict], monthly_rows: list[dict]) -> str:
    """The slice of published Canary data one API call would return for this question.

    grounding_rows (baked by the generator: permit-level, counts) win when present;
    superlative -> the metric across every area; pairwise -> both areas' rows;
    temporal -> the monthly series for the window; trap -> the noise metrics incl.
    the refined variant (exactly what the API would serve); default -> the area's rows.
    The benchmark file's own expected/ground_truth fields are never included.
    """
    keep = ("area_id", "metric", "last12", "prior12", "pct_change", "z", "source_as_of")

    def slim_rows(rows: list[dict]) -> list[dict]:
        return [{k: r.get(k) for k in keep} for r in rows]

    if item.get("grounding_rows"):
        slim = item["grounding_rows"]
    elif item["type"] == "superlative":
        slim = slim_rows([r for r in trajectory_rows if r["metric"] == item["metric"] and r.get("rankable")])
    elif item["type"] == "pairwise":
        slim = slim_rows([r for r in trajectory_rows if r["area_id"] in item.get("areas", []) and r["metric"] == item["metric"]])
    elif item["type"] == "temporal":
        series = sorted(
            (r for r in monthly_rows if r["area_id"] == item.get("area") and r["metric"] == item["metric"]),
            key=lambda r: r["period"],
        )
        slim = [{k: r.get(k) for k in ("area_id", "metric", "period", "value")} for r in series]
    elif item["type"] == "trap":
        slim = slim_rows([r for r in trajectory_rows if str(r["metric"]).startswith("threeoneone_noise")])
    else:
        slim = slim_rows([r for r in trajectory_rows if r["area_id"] == item.get("area")])
    # Field documentation ships with every real API response (agent-legibility is a
    # design constraint) -- without semantics, models misread enforcement surges as
    # crime waves (verified: GPT-4o did exactly that on the undocumented payload).
    metric_docs = (
        "Metric definitions: crime_victim_reported = incidents reported by victims -- "
        "the measure of crime as experienced by residents. crime_enforcement = "
        "proactive police activity (drug/warrant/sweep operations); a surge means a "
        "police crackdown, NOT necessarily more crime. crime_incidents = raw total of "
        "both (do not use alone for 'is crime rising'). threeoneone_* = 311 complaint "
        "counts (measure reporting, not conditions). biz_openings/closings = business "
        "registry events; units_approved_net = net housing units on issued permits."
    )
    return (
        "Context — response from the Canary API (San Francisco neighborhood change "
        "metrics computed from public records; last12/prior12 = trailing-12-month totals "
        "vs the 12 months before):\n"
        + json.dumps(slim)
        + "\n"
        + metric_docs
        + "\n\nUsing this data where relevant, answer the user's question.\n\n"
    )


def providers() -> dict[str, callable]:
    """provider name -> ask(question) for every configured key."""
    load_dotenv(core.BACKEND_DIR / ".env")
    out: dict[str, callable] = {}
    if key := os.environ.get("OPENAI_API_KEY"):
        model = os.environ.get("OPENAI_MODEL", "gpt-5.6-sol")
        out[f"openai:{model}"] = lambda q, k=key, m=model: ask_openai_compatible(
            "https://api.openai.com/v1", k, m, q
        )
    if key := os.environ.get("ANTHROPIC_API_KEY"):
        model = os.environ.get("ANTHROPIC_MODEL", "claude-fable-5")
        out[f"anthropic:{model}"] = lambda q, k=key, m=model: ask_anthropic(k, m, q)
    if key := os.environ.get("OPENAI_API_KEY"):
        # the "search ON" bracket: same OpenAI family, native web search built in
        model = os.environ.get("OPENAI_SEARCH_MODEL", "gpt-5-search-api")
        out[f"openai-search:{model}"] = lambda q, k=key, m=model: ask_openai_compatible(
            "https://api.openai.com/v1", k, m, q
        )
    if key := os.environ.get("GEMINI_API_KEY"):
        model = os.environ.get("GEMINI_MODEL", "gemini-2.5-pro")
        out[f"gemini:{model}"] = lambda q, k=key, m=model: ask_gemini(k, m, q)
    if key := os.environ.get("PERPLEXITY_API_KEY"):
        model = os.environ.get("PERPLEXITY_MODEL", "sonar-pro")
        out[f"perplexity:{model}"] = lambda q, k=key, m=model: ask_openai_compatible(
            "https://api.perplexity.ai", k, m, q
        )
    if key := os.environ.get("XAI_API_KEY"):
        model = os.environ.get("XAI_MODEL", "grok-4")
        out[f"xai:{model}"] = lambda q, k=key, m=model: ask_openai_compatible(
            "https://api.x.ai/v1", k, m, q
        )
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", help="run only providers whose name contains this")
    parser.add_argument("--limit", type=int, help="only the first N questions (smoke test)")
    parser.add_argument(
        "--grounded",
        action="store_true",
        help="Canary ON: prepend the relevant slice of our published data to each "
        "question (the ablation -- same models, plus one simulated Canary API call)",
    )
    args = parser.parse_args()

    if not QUESTIONS.exists():
        raise SystemExit("benchmark_v0.json missing -- run `python -m app.benchmark.generate` first")
    bench = json.loads(QUESTIONS.read_text())
    questions = bench["questions"][: args.limit] if args.limit else bench["questions"]

    active = {
        name: fn
        for name, fn in providers().items()
        if not args.provider or args.provider in name
    }
    if not active:
        raise SystemExit(
            "No providers configured. Add API keys to backend/.env "
            "(OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY / "
            "PERPLEXITY_API_KEY / XAI_API_KEY)."
        )

    trajectory_rows: list[dict] = []
    monthly_rows: list[dict] = []
    if args.grounded:
        traj_path = core.PROCESSED_DIR / "neighborhood_trajectory.json"
        monthly_path = core.PROCESSED_DIR / "neighborhood_metrics_monthly.json"
        if not traj_path.exists() or not monthly_path.exists():
            raise SystemExit("--grounded needs processed/neighborhood_*.json (run publish --local)")
        trajectory_rows = json.loads(traj_path.read_text())["rows"]
        monthly_rows = json.loads(monthly_path.read_text())["rows"]

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    for name, ask in active.items():
        label = f"{name}+canary" if args.grounded else name
        print(f"\n=== {label}: {len(questions)} questions ===")
        answers = []
        for item in questions:
            prompt = item["question"]
            if args.grounded:
                prompt = build_grounding(item, trajectory_rows, monthly_rows) + prompt
            try:
                text = ask(prompt)
                status = "ok"
            except requests.RequestException as exc:
                text, status = str(exc), "error"
            answers.append({"id": item["id"], "question": item["question"], "answer": text, "status": status})
            print(f"  [{status}] {item['id']} {item['question'][:60]}...")
            time.sleep(0.1)
        out = RUNS_DIR / f"{label.replace(':', '_').replace('/', '_')}_{stamp}.json"
        out.write_text(
            json.dumps(
                {
                    "provider": label,
                    "grounded": args.grounded,
                    "benchmark": bench["name"],
                    "pipeline_version": bench["pipeline_version"],
                    "ran_at": stamp,
                    "answers": answers,
                },
                indent=1,
            )
        )
        n_ok = sum(1 for a in answers if a["status"] == "ok")
        print(f"  saved {n_ok}/{len(answers)} answers -> {out.relative_to(core.DATA_DIR)}")


if __name__ == "__main__":
    main()
