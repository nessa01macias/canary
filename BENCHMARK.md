# AI Area Benchmark v0 — Results (San Francisco, 2026-07-25)

> **The accuracy gap is not a prompt-engineering problem — and for neighborhoods, it
> isn't even a freshness problem. It's an aggregation problem: the answers aren't stale
> on the web, they don't exist on the web.** Perplexity has native search and still told
> us the Mission had San Francisco's biggest rise in new business openings — the public
> record shows it had the biggest decline. No model could retrieve the right answer,
> because until Canary computed it, it had never been written down anywhere.

**The question this answers** (H2 in CONTEXT.md): when people ask AI assistants
"should I move here?"-type questions, are the answers right? We asked 3 leading models
46 checkable questions about SF neighborhoods — every ground truth computed from the
public record (DataSF, as_of 2026-07-24) with receipts. Models got no access to our
data; that's the point.

Harness: `backend/app/benchmark/` (`make benchmark`). Raw answers:
`backend/data/processed/benchmark_runs/`. Ambiguous answers (hedges, non-answers) go
to human review, not to the scorer — accuracy below is on auto-scorable answers only.

## The result: Canary OFF vs Canary ON

Same 46 questions, same models. "Canary ON" = one simulated Canary API response
(the relevant slice of our published neighborhood data + its field documentation)
prepended to the question. LLM-judged against fixed receipts (VOYGR-style: the judge
only checks whether the answer commits to the recorded truth; hedges = non-answer;
verdicts in `benchmark_runs/*.judged.json`, spot-checkable).

| Provider | Canary OFF | Canary ON | Confidently wrong: OFF → ON |
|---|---|---|---|
| openai:gpt-4o | **0%** (39/46 refused) | **85%** | 5 → 7* |
| anthropic:claude-sonnet-4-5 | **15%** | **91-98%** | 21 → ~1 |
| perplexity:sonar-pro (live search) | **39%** | **91-93%** | **28 → 3** |

*GPT-4o's failure mode flips from refusing to answer (useless) to answering from data
(85% correct); its few remaining misses are mostly numeric-tolerance edges.

Three findings stacked in one table:
1. **Bare models are unusable for area questions**: the cautious one (GPT-4o) refuses
   85% of questions; the confident one (Perplexity) answers everything and is
   confidently wrong 61% of the time (28/46).
2. **With one Canary API call, every provider jumps to ~85-95%** — the gap was never
   model quality; it was that the answers didn't exist anywhere to retrieve.
3. **Data alone wasn't enough — semantics were load-bearing.** Given raw numbers
   without field docs, GPT-4o read the Tenderloin enforcement surge (+43.6%) as a
   crime wave despite victim reports (−8%) in the same payload. With metric
   definitions attached (as any real API response ships), it answers correctly.
   Agent-legible documentation isn't hygiene; it's part of the product.

(Earlier regex-based v0 scoring — GPT-4o 36% / Claude 27% / Perplexity 44% on the
auto-scorable subset — is superseded by the LLM judge above, which classifies hedges
as non-answers instead of dropping them.)

## The headline result

**Q: "Which SF neighborhood had the biggest increase in new business openings over the past year?"**

All three models said the **Mission District** — confidently, one citing press coverage.
The business registry shows the Mission had the city's **largest decline** in openings
(−19%, z −1.3). The correct answer — **Japantown, +38%** — appears in no model's answer.
Three different AI stacks, including one with live web search, gave the same
confidently wrong answer, because they all reason from the same vibes (the Mission is
famous for openings-and-closings discourse) rather than from the record. This is the
Silicon Gaze pattern reproduced on our dimensions, with receipts.

## The trap question

*"I'm considering moving to the Tenderloin — is crime getting better or worse?"*
(Record: victim-reported −8.0%, enforcement +43.6%; naive total +11%.)

- **gpt-4o**: declined to answer ("check the latest local crime reports") despite being asked to commit.
- **claude-sonnet-4-5**: hedged; vague "some improvements... remains one of the highest-crime neighborhoods"; no direction.
- **perplexity:sonar-pro**: directionally right ("trending better," cites robbery −15%) — credit where due — but no model distinguished enforcement activity from victimization, which is the thing a mover actually needs to know.

## Honest caveats

- 69/138 answers (50%) are in `benchmark_review.csv` awaiting human verdicts — mostly
  hedges and non-answers. Non-answers are themselves a product finding (an assistant
  that can't answer is exactly the gap), but they don't count as wrong in the accuracy figures.
- Fact questions scored suspiciously well (5/5) — verify the judge isn't crediting
  loose number matches before quoting that number.
- Perplexity's live search materially helps on direction questions; it still failed
  every superlative. Fresh web ≠ structured record.
- One benchmark run, one metro, v0 question set. Directional finding, not a paper.

## Next

1. Human pass on the review CSV (Melany + Katerina; ~30 min).
2. Re-run Gemini once the spending cap is lifted; add xAI key if wanted.
3. Publishable writeup + the wholesale pitch: these models need grounded area data —
   the API that fixes this is the one the pipeline already serves.
