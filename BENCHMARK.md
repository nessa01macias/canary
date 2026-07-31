# AI Area Benchmark v2: results snapshot

**The full study (method, findings, conclusions, limitations) lives in
[RESEARCH.md](RESEARCH.md).** This file is the quick-reference table only.

136 checkable questions about SF neighborhoods (frozen at `d891dac` and
independently verified against the city's APIs before any model ran), five
frontier models, LLM-judged against fixed receipts. "Canary ON" = one simulated
Canary API response (data slice + field docs) prepended.

| Model | Bare | Canary ON | Confidently wrong (bare) |
|---|---|---|---|
| claude-fable-5 | 40% | **99%** | 72/136 |
| grok-4.5 | 32% | **99%** | 89/135 |
| gpt-5.6-sol | 36% | **99%**¹ | 85/136 |
| gpt-5-search-api | 25%¹ | **95%** | 22/69 (+25 refusals) |
| perplexity sonar-pro (live search) | 47% | **95%** | 62/135 |

¹ Two cells carry reduced coverage from a mid-run network failure (search bare
69/136 answered; sol grounded 86/136); all cells report over exact answered-and-
judged denominators. All counts from `python -m app.benchmark.stats` (Wilson 95%
CIs and McNemar p between 1e-13 and 1e-27 in RESEARCH.md).

Headline blocks (bare, pooled): **superlatives 12% · numeric 20% · pairwise 45%**
(below the 50% coin-flip) · **temporal-in-training-window 37%** (at scale, even
in-window aggregates fail unless they were published: the gap is unpublished
computation, not recency). v1 pilot (43q, `064dc90`) in git history.

Reproduce (against the frozen v2 artifact; without these two env vars the harness
defaults to the v1 pilot): `cd backend && export BENCH_FILE=benchmark_v2.json
BENCH_RUNS=benchmark_runs_v2 && python -m app.benchmark.run && python -m
app.benchmark.run --grounded && python -m app.benchmark.judge && python -m
app.benchmark.judge --repair && python -m app.benchmark.stats`. Do not run
`generate_v2`: it overwrites the freeze.
(v0 history: previous-generation models scored 0-39% bare, dominated by refusals;
see the git history of this file.)
