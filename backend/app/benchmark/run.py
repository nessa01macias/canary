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

QUESTIONS = core.PROCESSED_DIR / "benchmark_v0.json"
RUNS_DIR = core.PROCESSED_DIR / "benchmark_runs"

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
            "temperature": 0.2,
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


def providers() -> dict[str, callable]:
    """provider name -> ask(question) for every configured key."""
    load_dotenv(core.BACKEND_DIR / ".env")
    out: dict[str, callable] = {}
    if key := os.environ.get("OPENAI_API_KEY"):
        model = os.environ.get("OPENAI_MODEL", "gpt-4o")
        out[f"openai:{model}"] = lambda q, k=key, m=model: ask_openai_compatible(
            "https://api.openai.com/v1", k, m, q
        )
    if key := os.environ.get("ANTHROPIC_API_KEY"):
        model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5")
        out[f"anthropic:{model}"] = lambda q, k=key, m=model: ask_anthropic(k, m, q)
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

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    for name, ask in active.items():
        print(f"\n=== {name}: {len(questions)} questions ===")
        answers = []
        for item in questions:
            try:
                text = ask(item["question"])
                status = "ok"
            except requests.RequestException as exc:
                text, status = str(exc), "error"
            answers.append({"id": item["id"], "question": item["question"], "answer": text, "status": status})
            print(f"  [{status}] {item['id']} {item['question'][:60]}...")
            time.sleep(0.3)
        out = RUNS_DIR / f"{name.replace(':', '_').replace('/', '_')}_{stamp}.json"
        out.write_text(
            json.dumps(
                {
                    "provider": name,
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
