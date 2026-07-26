# Do AI assistants know how neighborhoods are changing?
### An area-level ground-truth benchmark with a grounding ablation. Working note v1 (pilot), San Francisco.

**Melany Macías · Katerina Tchilinguirov**
*Canary · July 26, 2026*

---

## Abstract

Large language models are increasingly consulted for residential decisions. We
evaluate five frontier models (Claude Fable 5, GPT-5.6 Sol, GPT-5 with native web
search, Perplexity sonar-pro, Grok 4.5) on 43 verifiable questions about San
Francisco neighborhoods, covering direction of change, cross-neighborhood rankings,
counts, pairwise comparisons, and approved construction near specific addresses.
Ground truth for every question is computed from municipal public records and
carries a citation; the question set was frozen at a git commit prior to any model
query. In the unassisted condition, accuracy ranges from 36% to 45%. In contrast to
the previous model generation, refusals are rare; the dominant failure mode is
confident error, with individual models producing confidently wrong answers on up to
25 of 43 items. All 25 attempts at ranking questions ("which neighborhood changed
most") were incorrect, and all counting questions were answered outside a ±30%
tolerance. When a single Canary API response is prepended to the same questions,
accuracy rises to 93-100%, with three of five models answering every judged item
correctly. Control blocks indicate the deficit is specific to aggregate,
present-state facts: the same models score 95% on equivalent questions inside their
training window and pass both designed distractor items. We interpret these results
as evidence that the failure is one of data availability rather than model
capability or retrieval freshness: the target facts had not previously been computed
or published, and therefore cannot be recalled or retrieved at any capability level.

## Lay summary

We asked the five newest AI models 43 checkable questions about San Francisco
neighborhoods, the kind anyone deciding where to live actually asks: is crime
getting better here, where are new businesses opening, how much housing was just
approved near this address. Every question has a verifiable answer in the city's
public records. On their own, the models scored around 40%, and unlike older models
they rarely said "I don't know"; one gave confidently wrong answers on 25 of 43
questions. Asked which neighborhood was rising fastest, the five models produced
four different confident answers, all wrong. The reason is that these answers were
never written down anywhere: nobody had computed them from the millions of raw
records the city publishes, so there was nothing for a model to learn or retrieve.
When we supplied the same models with one response from Canary's data, three scored
perfectly and the other two came close. The models were not the limiting factor. The
missing data layer was.

## 1. Introduction

Prior evaluations of language models on local information concern the *place* level.
VOYGR's Quarterly LLM Benchmarking Study (345 prompts on venues, hours, and
bookings) documents recommendations of closed and fabricated establishments. The
Silicon Gaze audit of twenty million queries finds that model-produced neighborhood
rankings track social divides rather than measured characteristics. To our
knowledge, no benchmark has addressed the *area* level: the direction in which a
neighborhood is changing, and what has been approved for construction there. We note
that VOYGR's 345 local prompts contain no area-change questions; the category is
unmeasured, consistent with it being unserved by existing data products.

An earlier pilot of ours (v0: 46 questions, previous-generation models) measured
unassisted accuracies of 0-39%, dominated by refusals. A natural objection is that
frontier progress will close this gap without any change to the data models can
access. The present study tests that objection. It does not hold: capability
improved, refusals largely disappeared, and accuracy on the diagnostic blocks did
not improve. The failure mode shifted from abstention to confident error.

The study also includes an ablation designed to locate the bottleneck. Each model
answers every question twice: once unassisted, and once with a single simulated API
response from our system prepended to the prompt. If the deficit were one of
reasoning, added context should help only marginally. If the deficit is one of data
availability, grounded accuracy should approach the ceiling. The results support the
second interpretation.

## 2. Methods

This section describes the ground truth against which all answers are graded
(§2.1), the construction and freezing of the question set (§2.2), the two
experimental conditions (§2.3), and the judging protocol (§2.4).

### 2.1 Ground truth

Expected answers are computed by the Canary pipeline from municipal public records:
building permits, the business registry, police incident reports, eviction notices,
and 311 service requests, using DataSF snapshots whose as-of date is recorded on
every row. Events are indexed on an H3 hexagonal spine and aggregated to the city's
analysis neighborhoods.

Three properties of the ground truth bear on benchmark validity.

1. **Provenance.** Every row carries the source's own publication date and our fetch
   date, making every expected answer reproducible against a stated snapshot.
2. **Receipts.** Every expected answer traces to identifiable records (permit
   numbers, registry entries) rather than to composite scores.
3. **Measurement corrections.** Public records mislead in documented ways, and the
   ground truth incorporates corrections established before any model was tested.
   Police incident counts conflate victim-initiated reports with proactive
   enforcement activity; we separate the two, since an enforcement surge is not a
   crime wave. A March 2026 change in the city's 311 application inflated nominal
   noise complaints by 62%; the artifact was detected via channel and category
   decomposition and excluded from the claimable metric. Business closure dates lag
   reality, and the lag is documented. The validation of the trajectory signal
   itself, including one case in which the receipts corrected our own mistaken
   narrative attribution, is reported in Appendix A.

### 2.2 Benchmark design

The instrument contains 43 questions in seven blocks, generated programmatically
from the database and frozen at git commit `064dc90` before any model was queried.
The initial target of 50 was reduced by quality floors: two candidate addresses had
insufficient nearby construction to support an unambiguous question, and two
candidate pairwise comparisons had effect-size gaps too narrow to grade fairly.

| Block | n | Form | Rationale |
|---|---|---|---|
| Direction | 15 | "Is X rising or falling in {neighborhood}?" | Press coverage sometimes exists; recall can succeed |
| Superlative | 5 | "Which neighborhood had the largest increase in X?" | Requires an aggregation over all areas that has not been published |
| Numeric | 8 | Counts, ±30% tolerance | Tests quantitative knowledge directly |
| Pairwise | 6 | "Which of A or B rose more?" | Chance baseline is 50%; measures comparison under uncertainty |
| Address-level | 3 | "Units approved within ~500 m of {address}?" | The forward-looking question relevant to an individual property |
| Temporal | 4 | Changes between the years ending June 2024 and June 2025 | Control: falls inside training windows |
| Distractors | 2 | Enforcement-vs-victimization; the 311 artifact | Control: penalizes uncritical acceptance of misleading aggregates |

Metrics used include victim-reported crime, business openings, eviction filings,
encampment reports, and net approved housing units. Volume and effect-size floors
ensure that each expected answer is unambiguous at the stated tolerance.

### 2.3 Experimental setup

Two conditions with identical questions. In the **unassisted** condition, the model
receives the question and a system prompt instructing it to commit to a direct
answer. In the **grounded** condition, the prompt is prefixed with one simulated
Canary API response: the data slice a single call would return, together with field
documentation, since metric definitions accompany every genuine API response. For
address-level items the payload contains the ring aggregate and the largest
constituent permits, matching the `/api/report` endpoint.

Protocol correction (v1.0.1): the initial address-level payload omitted the ring
aggregate and contained only the ten largest permits. Models summed the partial list
they were given and were scored incorrect. This was a payload construction error on
our side, not a model failure; the payload was corrected, the condition re-run, and
the incident is disclosed here.

Provider-default temperature was used throughout, on the grounds that it reflects
deployed consumer behavior, and because several current APIs reject non-default
temperature settings. One run per condition (this is a pilot; stability replicates
are planned for v1.1). Total API cost was approximately $25. Exact model
identifiers: `claude-fable-5`, `gpt-5.6-sol`, `gpt-5-search-api`, `sonar-pro`,
`grok-4.5`. Gemini could not be included due to account constraints and is planned
for v1.1.

### 2.4 Judging

Answers are graded by an LLM judge (`claude-sonnet-5`, held out of the test set)
that receives the question, the pre-verified ground truth with its receipt, and the
model's answer, and classifies only whether the answer commits to the recorded
truth: *correct*, *wrong*, or *nonanswer* (refusals and non-committal hedges). Wrong
answers delivered without meaningful hedging are additionally flagged as
*confidently wrong*; following VOYGR's scoring rationale, we regard this as the most
costly outcome for users, who receive misinformation rather than no information.

All verdicts are stored with one-line rationales
(`benchmark_runs_v1/*.judged.json`) and are auditable. A stratified human audit of
judge verdicts is part of the protocol, with the agreement rate to be published as
the judge's error bar. One limitation is noted for the record: the judge shares a
vendor with one tested model. The fixed-evidence design (the judge never assesses
facts, only commitment to supplied facts) and the human audit are the mitigations.

## 3. Results

Table 1 and Figure 1 report overall accuracy by model; Table 2 and Figure 2
report accuracy by question block, pooled across the five models.

Table 1. Overall accuracy by model and condition.

| Model | Unassisted | Grounded | Confidently wrong (unassisted) |
|---|---|---|---|
| Claude Fable 5 | 43% | **100%** (43/43) | 17/43 |
| Grok 4.5 | 42% | **100%** (43/43) | 25/43 |
| GPT-5.6 Sol | 42% | **100%** (41/41 judged)¹ | 23/43 |
| GPT-5 search | 36% (13 refusals) | **95%** | 11/43 |
| Perplexity sonar-pro | 45% | **93%** | 21/43 |

¹ Two of Sol's 43 grounded verdicts failed to parse during judging and are excluded
rather than assumed correct; all 41 judged answers were correct.

![Grouped bar chart of unassisted versus grounded accuracy for the five models. Unassisted bars sit between 36 and 45 percent; grounded bars sit between 93 and 100 percent.](frontend/public/research/fig1_models.svg)

**Figure 1.** Overall accuracy by model and condition (data of Table 1). Every
model roughly doubles its accuracy when a single Canary API response is prepended
to the prompt. Sol's grounded bar reflects the 41 of 43 verdicts that parsed.

Table 2. Accuracy by question block, pooled across the five models.

| Block | Unassisted | Grounded |
|---|---|---|
| Superlative | 0% | 91% |
| Numeric | 0% | 100% |
| Pairwise (chance = 50%) | 64% | 93% |
| Direction | 55% | 100% |
| Address-level | 13% | 93% |
| Temporal (in training window) | 95% | 100% |
| Distractors | 100% | 100% |

![Grouped horizontal bar chart of unassisted versus grounded accuracy for the seven question blocks. Superlative and numeric blocks score zero unassisted and 91 to 100 percent grounded; the temporal control is near ceiling in both conditions.](frontend/public/research/fig2_blocks.svg)

**Figure 2.** Accuracy by question block, pooled across the five models (data of
Table 2). The blocks that require an unpublished aggregation (superlative,
numeric, address-level) collapse in the unassisted condition and recover when
grounded; the temporal control, whose answers fall inside training windows, is
near ceiling in both conditions.

### 3.1 Error analysis: the superlative block

Question 16 asked which San Francisco neighborhood had the largest increase in new
business openings over the past year. The registry answer is Japantown (+38%, the
largest rise citywide). Representative unassisted responses:

- **Grok 4.5:** "Mission District," supported by reasoning about pre-2025 permitting
  trends and foot traffic along the Valencia corridor.
- **GPT-5.6 Sol:** Union Square, attributed to the downtown retail rebound.
- **Claude Fable 5:** Downtown/Union Square, citing the city's Vacant to Vibrant
  program and first-year tax waivers as mechanisms.
- **Perplexity sonar-pro:** Mission Bay, citing a genuine 2025 sales-tax analysis
  retrieved from the web.

Four distinct answers, each argued from real but non-dispositive context, none
correct. We note a qualitative difference from v0, where three previous-generation
models converged on the same incorrect answer (the Mission), a pattern consistent
with shared training-distribution priors. The frontier models diverge more, and
construct more sophisticated justifications, without any improvement in accuracy.
This is the expected signature of a task whose answer is absent from the training
distribution and from the retrievable web: no reasoning path terminates at the fact,
because the fact was never published. In the grounded condition, Grok 4.5 answered
the same question in one line: Japantown, 50 to 69 openings, +38%, with the
z-score.

### 3.2 Error analysis: the numeric block

Asked how many net new housing units were approved in Nob Hill in the twelve months
before July 2026, GPT-5.6 Sol answered "roughly 25 net new housing units," with a
caveat about boundary definitions. The permit record gives 1,319, driven by a small
number of large approved projects. The error is a factor of approximately fifty, and
the response format (a specific figure with a methodological caveat) is
indistinguishable from that of an informed estimate. All five models failed all
eight numeric items in the unassisted condition; all five answered all eight
correctly when grounded.

### 3.3 The generational shift in failure mode

In v0, previous-generation models refused frequently (GPT-4o declined 39 of 46
items). In v1, refusals nearly disappear outside the search-configured model, and
error mass moves into confident, specific, well-argued wrong answers (17-25 of 43
per model). From a user-welfare perspective this is a regression: an abstention
prompts further search, whereas a fluent wrong answer terminates it.

### 3.4 Controls

The temporal block, whose answers fall inside the models' training windows, scored
95% unassisted, and both distractor items were answered correctly by all models.
Models are well calibrated on the recorded past and are not deceived by the
statistical artifacts we planted. The deficit is confined to aggregate facts about
the recent present, which is precisely the class of fact that must be computed from
primary records rather than remembered from text.

### 3.5 Grounded condition

With one API response prepended, three of five models answered every judged item
correctly, and the remaining two scored 93% and 95%, with residual misses
attributable largely to judge strictness on phrasing rather than misreading. Five
models from four vendors used the same documented payload without any per-model
tuning. We take this as evidence that current frontier models are already sufficient
consumers of structured area data, and that the binding constraint is the existence
and machine-legibility of the data itself.

## 4. Discussion

**The deficit is informational, not cognitive.** Three observations triangulate this
conclusion: capability improved between generations while diagnostic-block accuracy
did not; search-native configurations failed alongside parametric ones; and supplying
the missing data recovered near-ceiling performance in every model tested.
Aggregations that have never been published cannot be retrieved, and additional model
scale does not conjure them.

**Fluency without grounding harms users.** The shift from refusal to confident error
means the cost of the missing data layer is rising with model quality. The
qualitative examples in §3.1 and §3.2 illustrate answers whose surface form carries
the markers of expertise while the content is wrong by wide margins.

**Machine-readable semantics are part of the data.** Our own v1.0.1 payload error is
instructive: models faithfully aggregated an incompletely specified payload. Field
documentation accompanying data is not a convenience; it determines whether grounded
answers are correct.

**Corrections are part of the data.** The ground truth required documented
adjustments (enforcement versus victimization, the 311 reporting artifact, closure
lag) before it could fairly grade anyone. Systems that ingest raw public records
without such corrections inherit exactly the errors this benchmark penalizes.

**Scope of claims.** These results establish the failure and its remediability at
pilot scale, on our question dimensions, in one metropolitan area. They do not
establish market demand for external grounding; that is an adoption question outside
the scope of this study.

## 5. Limitations

One metro; one run per condition; 43 questions; five models, with Gemini absent. The
judge is a language model: verdicts are stored and auditable, a human audit of a
verdict sample is owed, and the judge shares a vendor with one tested model. In the
grounded condition, Canary data serves as both context and ground truth by design;
the condition tests whether models retrieve and commit to supplied area data, while
the validity of the data itself is assessed separately, with receipts and
falsifiable forward predictions, in Appendix A. The ±30% numeric
tolerance is permissive. The temporal (n=4) and distractor (n=2) blocks are small
and their percentages carry wide uncertainty.

## 6. Reproducibility

```
cd backend
python -m app.benchmark.generate_v1        # regenerate questions from the live snapshot
python -m app.benchmark.run                # unassisted condition, all configured providers
python -m app.benchmark.run --grounded     # grounded condition
python -m app.benchmark.judge              # verdicts and summary table
```

Artifacts: `data/processed/benchmark_v1.json` (questions and receipts, frozen at
`064dc90`); `data/processed/benchmark_runs_v1/` (all raw answers and judged
verdicts), stamped with pipeline git version and source snapshot date. The intended
cadence is monthly regeneration alongside the data, so that the question set tracks
the live record.

## 7. Future work

Include Gemini; run stability replicates; publish the human audit of judge verdicts;
extend to a second metropolitan area; publish as a recurring, versioned report so
that results remain accountable over time.

## Appendix A: Validation of the trajectory ground truth

Before the benchmark could grade anyone, the signal that generates its expected
answers had to be validated. We selected seven San Francisco neighborhoods with
well-documented arcs over 2020-2026 and compared the pipeline's per-dimension
trajectory (trailing twelve months against the twelve before, standardized citywide)
against both the underlying records and the documented narrative. Every claim below
has two layers: the computed signal, and the receipt, meaning identifiable records
such as permit numbers and registry entries. Where an external narrative is cited it
was widely reported at the time and is labeled as context, distinct from the record.

| Neighborhood | Dimension | Computed | Receipt (our data) | Verdict |
|---|---|---|---|---|
| Treasure Island | permits issued | +38%, z+1.0 | $79.4M six-story 150-unit residential (issued 2026-07-01); $40M fully affordable 100-unit building; $31M new construction; 20,000 yd³ grading. Matches the documented island redevelopment. | Confirmed |
| Lakeshore | permits issued | +156%, z+4.9 | Top permits are a $6.5M golf maintenance building, a $5M gatehouse, and a parking expansion; zero housing units. Our initial attribution to the Stonestown redevelopment was wrong; those permits are not yet in the issued record. | Corrected |
| Tenderloin | crime incidents | +11%, z+2.5, against a citywide decline of 8% | Decomposition: drug offenses 1,790 to 2,824 (+58%), warrants +35%, assault flat (1,109 to 1,134). An enforcement surge, not a victimization surge. | Consistent, reframed |
| Mission | business openings | −19%, z−1.3 | Named closures on record across retail, salons, and labs; matches the documented Valencia Street churn. | Consistent |
| Financial District / South Beach | net business churn | +235 net, the city's highest | 1,666 openings against 1,431 closings; matches the downtown recovery narrative. | Consistent |
| Bayview Hunters Point | permits; business churn | permits −21.6%; net churn −18, the city's lowest | Aggregate counts; consistent with documented underinvestment. | Consistent |
| Japantown | business openings | +38%, z+2.9 | Openings are predominantly health practices, physicians, and restaurants. No documented narrative exists. | Lead (model-surfaced) |

Two failures in this pass were more informative than the successes, and both are now
design features. First, the Lakeshore correction: the magnitude signal was real, but
the narrative we first attached to it was wrong, and the underlying permits showed
it (golf course capital works, zero housing units). The per-dimension design
contained the tell, since net approved units sat near zero; a single composite score
would have obscured the error. Second, the Tenderloin decomposition: police incident
data measures proactive enforcement in some categories and victim reports in others,
and splitting them inverts the headline (victim-reported crime fell 8.0% while
enforcement activity rose 43.6%; citywide, −18.7% against +29.7%). Both corrections
were subsequently encoded as benchmark items (§2.2, distractors).

A related correction was made after this pass: loading the full 311 archive (8.79M
cases since 2008) revealed that the nominal noise-complaint trend (+61.9%) is
dominated by a March 2026 change in the city's reporting application, concentrated
in one catch-all category (+145%) and the mobile channel (+139% against +15% by
phone). The refined metric excluding the artifact rose 25.9%. The recurring lesson,
now standing policy, is that report-based metrics measure reporting as well as
reality, and each one requires a propensity check before a trend is published.

Falsifiable forward predictions, recorded July 2026 and checkable around January
2027: (1) Treasure Island remains top-three citywide in net approved housing units;
(2) Stonestown-driven residential permits appear in Lakeshore's issued record within
twelve months; (3) if the Tenderloin enforcement operation winds down, drug offense
counts fall toward baseline while assault remains flat, distinguishing an
enforcement pulse from underlying change.

## How to cite

```bibtex
@techreport{canary2026areabenchmark,
  title       = {Do AI assistants know how neighborhoods are changing?
                 An area-level ground-truth benchmark with a grounding ablation},
  author      = {Mac{\'i}as, Melany and Tchilinguirov, Katerina},
  institution = {Canary},
  year        = {2026},
  month       = {July},
  note        = {Working note v1 (pilot), San Francisco. Question set frozen at 064dc90.}
}
```
