# Do AI assistants know how neighborhoods are changing?
### An area-level ground-truth benchmark with a grounding ablation — v0, San Francisco

**Canary · 2026-07-25 · working note (v0)**
Companion docs: [BENCHMARK.md](BENCHMARK.md) (results one-pager) · [VALIDATION.md](VALIDATION.md) (ground-truth validation) · harness: `backend/app/benchmark/`

> **The accuracy gap is not a prompt-engineering problem — and for neighborhoods, it
> isn't even a freshness problem. It's an aggregation problem: the answers aren't stale
> on the web, they don't exist on the web.**

---

## Abstract

People increasingly ask AI assistants where to live. We tested whether three frontier
assistants (GPT-4o, Claude Sonnet 4.5, Perplexity sonar-pro with live web search) can
answer **checkable, area-level questions** about San Francisco — is crime rising in
this neighborhood, where are businesses opening, how much housing was just approved —
where every ground truth is computed from public records and carries a citation.
Bare, the models scored **0-39%**, with two distinct failure modes: refusal (GPT-4o
declined 39/46 questions) and confident error (Perplexity answered all 46, was wrong
on 28, without hedging). All three gave the *identical* wrong answer to the flagship
question. With **one simulated Canary API response** prepended — the same models, same
questions — accuracy rose to **85-98%**. The failure is not model capability and not
web freshness; it is that area-level answers had never been computed and published
anywhere, so no amount of retrieval could find them.

## 1. Motivation

Prior evidence covers the *place* level: VOYGR's Quarterly LLM Benchmarking Study
(345 prompts — restaurants, hours, bookings) found models recommend closed or
fabricated venues; the "Silicon Gaze" audit (20M queries) found LLM neighborhood
*rankings* mirror social divides. But no benchmark existed for the **area level** —
neighborhood *trajectory* (direction of change) and the *forward layer* (what is
approved to be built). Notably, VOYGR's 345 local prompts contain zero area-change
questions: the category was unmeasured, in line with it being unserved.

## 2. Ground truth

Ground truths are computed by the Canary pipeline from municipal public records
(building permits, the business registry, police incident reports, eviction notices,
311 cases — DataSF snapshots `as_of 2026-07-24`), aggregated on an H3 hex spine and
rolled up to the city's 37 analysis neighborhoods. Three properties matter for
benchmark validity:

1. **Bitemporal provenance.** Every row carries the source's own freshness date and
   our fetch date; every answer is reproducible against a stated snapshot.
2. **Receipts.** Every question's expected answer traces to underlying records
   (permit numbers, registry entries), not to a black-box score.
3. **Measurement discipline.** The raw record misleads in known ways, and the ground
   truth corrects for them *before* any model was tested: police incidents are split
   into victim-reported vs enforcement-driven categories (a drug-sweep surge is not a
   crime wave); a March-2026 311-app change that inflated "noise complaints" +62% was
   detected and excluded from the claimable metric; business-registry close-date lag
   is documented. See [VALIDATION.md](VALIDATION.md) for the validation of the ground
   truth itself (including one case where the receipts corrected *our own* narrative
   attribution — the discipline cuts both ways).

## 3. Question design

**46 questions, generated programmatically from the database before any model was
queried** (no post-hoc selection): 33 *direction* ("is crime rising or falling in X,
past year vs the year before?"), 4 *superlative* ("which neighborhood had the biggest
increase in new business openings?"), 6 *numeric* ("roughly how many net new housing
units were approved in X?", ±25% tolerance), 3 *fact* ("has any major residential
building been approved in X recently?"). Only unambiguous truths are emitted: minimum
event volume and minimum effect-size floors, so a wrong answer cannot hide behind
noise. One designed trap: "Is crime in the Tenderloin getting better or worse?" —
where victim-reported crime fell 8.0% while enforcement activity rose 43.6%; the
naive total (+11%) points the wrong way.

## 4. Protocol

Two conditions per provider, identical questions:

- **Canary OFF (bare):** the question alone. The system prompt instructs the model to
  commit to a direct answer with its best available knowledge.
- **Canary ON (grounded):** one simulated Canary API response is prepended — the JSON
  slice a single API call would return (the area's trajectory rows, or all areas for
  the question's metric on superlatives) **plus the API's field documentation**. The
  benchmark file's expected answers are never included.

Providers: `gpt-4o`, `claude-sonnet-4-5`, `sonar-pro` (live search). Gemini was
excluded (project billing block), to be added. Cost of the full study: ≈ $3.

## 5. Judging

VOYGR-style separation of evidence from judgment: an LLM judge (Claude Sonnet,
temperature 0) receives the question, the **pre-verified ground truth with its
receipt**, and the model's answer, and classifies only whether the answer *commits*
to the recorded truth: `correct` / `wrong` / `nonanswer` (refusals and hedges), plus
a `confident_wrong` flag when a wrong answer shows no hedging — following VOYGR's
principle that a confident wrong answer is worse than none: the user doesn't get
nothing, they get misled. All verdicts with one-line rationales are stored
(`benchmark_runs/*.judged.json`) for audit. Self-preference risk (Claude judging
Claude) is mitigated by the fixed-evidence design and auditable verdicts; a human
spot-check of a verdict sample is queued.

## 6. Results

| Provider | Canary OFF | Canary ON | Confidently wrong, OFF → ON |
|---|---|---|---|
| openai:gpt-4o | **0%** (39/46 refused; 7 wrong) | **85%** | 5 → 7¹ |
| anthropic:claude-sonnet-4-5 | **15%** (23 wrong, 21 confident; 16 refused) | **91-98%**² | 21 → ~1 |
| perplexity:sonar-pro (live search) | **39%** (28/46 confidently wrong; 0 refusals) | **91-93%** | 28 → 3 |

¹ GPT-4o's failure mode flips from refusing (useless) to answering from data; residual
misses are mostly numeric-tolerance edges. ² Two grounded runs were judged for
Claude; both shown as a range (42-43 correct of 46).

**The flagship error.** Asked which SF neighborhood had the biggest increase in new
business openings, all three providers — three independent stacks, one with live
search, one citing press coverage — named **the Mission**. The registry shows the
Mission had the city's **largest decline** (−19% year-over-year); the correct answer,
**Japantown (+38%)**, appeared in no answer. In the bare condition, no provider
answered any superlative question correctly (0/12 in the mechanical pass).

**The trap question.** Bare: GPT-4o refused; Claude hedged without direction;
Perplexity got the direction right via press coverage but did not distinguish
enforcement from victimization. Grounded *without field documentation*, GPT-4o read
the enforcement surge (+43.6%) as "crime getting worse" despite victim reports
(−8.0%) in the same payload; with metric definitions attached, it answered correctly.

## 7. Conclusions

1. **Area-level change is a distinct, unmeasured, and near-total failure class for
   current AI assistants.** This is not the known place-level staleness problem:
   these answers are not stale on the web — they have never existed on the web.
   Aggregation over the public record is the missing step, and retrieval cannot
   substitute for computation (the search-native provider scored 0/4 on superlatives
   like everyone else).

2. **The two bare failure modes are complementary, and both are decision-relevant:**
   refusal (no answer at the moment of a lease/purchase decision) and confident error
   (a cited, fluent, directionally backwards answer). By VOYGR's own scoring
   principle, the second is worse — and it characterized the provider consumers most
   associate with "looking things up."

3. **Identical wrong answers across independent models imply a shared cause:** the
   training distribution's discourse priors (the Mission dominates SF churn
   *discourse*; Japantown doesn't). Scaling model intelligence does not fix a prior
   inherited from what people write; only injecting the computed record does. The
   ablation is the direct test of that claim: same models, +one API response,
   0-39% → 85-98%.

4. **Semantics are part of the data product.** Raw numbers with no field definitions
   produced a new failure (enforcement surge read as crime wave — arguably worse than
   ignorance, because it wears the data's authority). Machine-readable metric
   documentation flipped the outcome. Agent-legible docs are load-bearing
   infrastructure, not developer hygiene.

5. **The measurement discipline is the defensible layer.** The ground truth itself
   required three corrections before it was fit to grade anyone (victim/enforcement
   split, 311 reporting-propensity artifact, registry close-lag). Anyone reselling
   raw open data inherits exactly the errors the models made; the correction layer is
   the part that is slow and hard to copy — and it is also where the benchmark's
   authority comes from.

6. **Hypothesis-ledger status:** H2 ("AI area answers are wrong") is strongly
   supported on our dimensions at v0 scale. H3/H4 (do AI product owners notice, and
   would they pay) remain untested — this document is the designed instrument for
   that outreach, not evidence of it.

## 8. Limitations

One metro, one run per condition (two for Claude ON), 46 questions, three providers.
The judge is an LLM (audited files, but a human verdict-sample check is owed). The
grounded condition uses Canary data as both context and ground truth — deliberately:
it tests whether models *retrieve and commit to* supplied area data, not whether that
data is true; the data's own validity is addressed separately with receipts and
falsifiable forward predictions in [VALIDATION.md](VALIDATION.md). Numeric tolerance
(±25%) is generous. Gemini and Grok are absent pending account setup. Direction
questions dominate the set; fact-type questions are few and need a richer grounding
payload (permit-level, not trajectory-level) to be fully fair in the ON condition.

## 9. Reproducibility

```
cd backend
make benchmark                 # regenerate questions from the db, run providers, judge
venv/bin/python -m app.benchmark.run --grounded   # the ON condition
venv/bin/python -m app.benchmark.judge            # verdicts + summary
```
Artifacts: `data/processed/benchmark_v0.json` (questions + receipts),
`data/processed/benchmark_runs/*.json` (raw answers) and `*.judged.json` (verdicts),
each stamped with the pipeline git version and the source snapshot date. The intended
cadence is monthly-with-the-data (the benchmark regenerates from each new snapshot, so
questions track the live record rather than fossilizing).

## 10. Next

Add Gemini/Grok columns · human audit of a judge-verdict sample · second metro ·
larger question set incl. forward-layer facts with permit-level grounding · publish
as a recurring report (the VOYGR playbook, area edition) · use as the opener for
H3/H4 outreach to AI real-estate and answer-engine teams.
