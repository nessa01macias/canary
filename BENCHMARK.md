# AI Area Benchmark v1 — results snapshot

**The full study (method, findings, conclusions, limitations) lives in
[RESEARCH.md](RESEARCH.md).** This file is the quick-reference table only.

43 checkable questions about SF neighborhoods (frozen pre-run at `064dc90`), five
frontier models, LLM-judged against fixed receipts. "Canary ON" = one simulated
Canary API response (data slice + field docs) prepended.

| Model | Bare | Canary ON | Confidently wrong (bare) |
|---|---|---|---|
| claude-fable-5 | 43% | **100%** | 17/43 |
| grok-4.5 | 42% | **100%** | 25/43 |
| perplexity sonar-pro (live search) | 45% | **93%** | 21/43 |
| gpt-5.6-sol | 42% | pending¹ | 23/43 |
| gpt-5-search-api | 36% | pending¹ | 11/43 (+13 refusals) |

¹ OpenAI quota exhausted mid-study; cells fill on account refill.

Headline blocks (bare, pooled): **superlatives 0/25 · numeric 0% · pairwise 64%**
(vs 50% coin-flip) · temporal-in-training-window 95% (the control that shows the gap
is the present, not the past).

Reproduce: `cd backend && python -m app.benchmark.generate_v1 && python -m app.benchmark.run
&& python -m app.benchmark.run --grounded && python -m app.benchmark.judge`
(v0 history: previous-generation models scored 0-39% bare, dominated by refusals —
see git history of this file.)
