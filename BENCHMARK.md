# AI Area Benchmark v0 — Results (San Francisco, 2026-07-25)

**The question this answers** (H2 in CONTEXT.md): when people ask AI assistants
"should I move here?"-type questions, are the answers right? We asked 3 leading models
46 checkable questions about SF neighborhoods — every ground truth computed from the
public record (DataSF, as_of 2026-07-24) with receipts. Models got no access to our
data; that's the point.

Harness: `backend/app/benchmark/` (`make benchmark`). Raw answers:
`backend/data/processed/benchmark_runs/`. Ambiguous answers (hedges, non-answers) go
to human review, not to the scorer — accuracy below is on auto-scorable answers only.

## Scorecard

| Provider | Correct | Wrong | Needs review | Accuracy (scored) |
|---|---|---|---|---|
| perplexity:sonar-pro (live web search) | 8 | 10 | 28 | 44% |
| openai:gpt-4o | 9 | 16 | 21 | 36% |
| anthropic:claude-sonnet-4-5 | 7 | 19 | 20 | 27% |

By question type (pooled): direction 42% · numeric 21% · **superlative 0%** (0/12) ·
fact 100% (n=5 scored; judge leniency to be reviewed).

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
