# AI Area Benchmark v0 — results snapshot

**The full study (method, findings, conclusions, limitations) lives in
[RESEARCH.md](RESEARCH.md).** This file is the quick-reference table only.

Same 46 checkable questions about SF neighborhoods, same models; "Canary ON" = one
simulated Canary API response (data slice + field docs) prepended. LLM-judged against
fixed receipts; verdicts auditable in `backend/data/processed/benchmark_runs/*.judged.json`.

| Provider | Canary OFF | Canary ON | Confidently wrong: OFF → ON |
|---|---|---|---|
| openai:gpt-4o | **0%** (39/46 refused) | **85%** | 5 → 7 |
| anthropic:claude-sonnet-4-5 | **15%** | **91-98%** | 21 → ~1 |
| perplexity:sonar-pro (live search) | **39%** | **91-93%** | **28 → 3** |

Reproduce: `cd backend && make benchmark` (see RESEARCH.md §9).
Questions + receipts: `backend/data/processed/benchmark_v0.json` (snapshot 2026-07-24).
