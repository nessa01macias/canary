# AI Area Benchmark v1: results snapshot

**The full study (method, findings, conclusions, limitations) lives in
[RESEARCH.md](RESEARCH.md).** This file is the quick-reference table only.

43 checkable questions about SF neighborhoods (frozen pre-run at `064dc90`), five
frontier models, LLM-judged against fixed receipts. "Canary ON" = one simulated
Canary API response (data slice + field docs) prepended.

| Model | Bare | Canary ON | Confidently wrong (bare) |
|---|---|---|---|
| claude-fable-5 | 49% | **100%** | 19/43 |
| grok-4.5 | 42% | **100%** | 25/43 |
| gpt-5.6-sol | 44% | **100%** | 23/43 |
| gpt-5-search-api | 37% | **95%**¹ | 11/43 (+13 refusals) |
| perplexity sonar-pro (live search) | 47% | **93%** | 21/43 |

¹ 40/42 judged (one verdict failed to parse after retries; excluded, not assumed).
All counts from `python -m app.benchmark.stats` (Wilson 95% CIs and McNemar tests
in RESEARCH.md); 19 originally unparsed verdicts completed via `judge --repair`,
disclosed there.

Headline blocks (bare, pooled): **superlatives 1/25 · numeric 1/40 · pairwise 67%**
(vs 50% coin-flip) · temporal-in-training-window 95% (the control that shows the gap
is the present, not the past).

Reproduce: `cd backend && python -m app.benchmark.generate_v1 && python -m app.benchmark.run
&& python -m app.benchmark.run --grounded && python -m app.benchmark.judge
&& python -m app.benchmark.judge --repair && python -m app.benchmark.stats`
(v0 history: previous-generation models scored 0-39% bare, dominated by refusals;
see the git history of this file.)
