# Do AI assistants know how neighborhoods are changing?
### An area-level ground-truth benchmark with a grounding ablation. Working note v2, San Francisco.

**Melany Macías · Katerina Tchilinguirov**
*Canary · July 29, 2026*

---

## Abstract

Large language models are increasingly consulted for residential decisions. We
evaluate five frontier models (Claude Fable 5, GPT-5.6 Sol, GPT-5 with native web
search, Perplexity sonar-pro, Grok 4.5) on 136 verifiable questions about San
Francisco neighborhoods, covering direction of change, cross-neighborhood rankings,
counts, pairwise comparisons, and approved construction near specific addresses.
Ground truth for every question is computed from municipal public records and
carries a citation; the question set was frozen at a git commit and independently
re-derived from the city's own APIs before any model query (one item failed
verification and was dropped pre-run). In the unassisted condition, accuracy ranges
from 25% to 47%. Refusals are rare outside the search-configured model; the
dominant failure mode is confident error, with individual models producing
confidently wrong answers on up to 66% of items. Ranking questions were answered
correctly 12% of the time, counts 20%, and pairwise comparisons 45%, below the 50%
chance baseline. When a single Canary API response is prepended to the same
questions, accuracy rises to 95-99% (every paired McNemar p < 2 × 10⁻¹³). A
result new at this scale concerns the temporal control: on questions whose answers
fall entirely inside training windows, unassisted accuracy is 37%, not the 95%
measured in the small pilot. The deficit is therefore not recency: aggregates that
were never published cannot be recalled from any training vintage or retrieved by
live search, which scored lowest (25%). Errors are also not independent. On the
ranking block, incorrect answers concentrate on a small set of nationally salient
neighborhoods, with the Tenderloin, the Mission and South of Market accounting for
three quarters of the wrong answers that name an identifiable area, indicating
that models absent an aggregate fall back on name salience rather than on noise.
Validity is checked from three directions: every expected answer was re-derived
from the city's own APIs by a script independent of our pipeline, at freeze time,
before any model query (136 of 137 confirmed; the failing item was dropped
pre-run), verdicts were replicated by a cross-vendor judge panel (Fleiss kappa
0.95, no measurable self-preference), and all results carry Wilson 95% intervals
with exact McNemar tests (p < 2 × 10⁻¹³ for every model). We interpret these results as evidence that the failure is one of
data availability rather than model capability or retrieval freshness: the target
facts had not previously been computed or published, and therefore cannot be
recalled or retrieved at any capability level.

## Lay summary

We asked the five newest AI models 136 checkable questions about San Francisco
neighborhoods, the kind anyone deciding where to live actually asks: is crime
getting better here, where are new businesses opening, how much housing was just
approved near this address. Every question has a verifiable answer in the city's
public records. On their own, the models scored between 25% and 47%, and unlike
older models they rarely said "I don't know"; one gave confidently wrong answers on
two of every three questions. Asked which neighborhood was gaining new businesses
fastest, the five models produced three different confident answers between them,
and all of them were wrong. Their mistakes were not scattered, either. When the
models had no real figure to work from, they reached for whichever neighborhood is
most famous for that kind of thing. Three names, the Tenderloin, the Mission and
South of Market, account for three quarters of the wrong answers that named a
neighborhood at all, while the true answers were quieter places like Japantown,
Lakeshore and Portola. The reason is that these answers were
never written down anywhere: nobody had computed them from the millions of raw
records the city publishes, so there was nothing for a model to learn or retrieve.
When we supplied the same models with one response from Canary's data, three scored
perfectly and the other two came close. The models were not the limiting factor. The
missing data layer was.

We also checked our own homework, this time before any model saw a question. An
independent program, sharing no code with our system, re-derived every answer
straight from the city's records and confirmed 136 of 137; the one it flagged was
a bug on our side, and we removed that question before the test began. A second
opinion on the grading, from judges built by three different companies, agreed
with the original verdicts about 97% of the time. And the biggest surprise: the
models failed even on questions about past years they were trained on, whenever
the answer had never been written down anywhere. The gap is not stale data. It is
data that never existed.

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

This note makes five contributions: (1) to our knowledge the first area-level
benchmark of AI assistants on neighborhood change, with a receipt behind every
expected answer and the question set frozen at a git commit before any model
query; (2) a grounding ablation across five frontier models from four vendors;
(3) an independent verification methodology, in which a script sharing no code
with our pipeline re-derives every expected answer from the city's own APIs,
together with the erratum that verification produced; (4) a cross-vendor judging
protocol with a measured self-preference test; and (5) a complete public artifact
set spanning questions, receipts, raw answers, verdicts, statistics, and
verification outputs.

## 2. Methods

This section describes the ground truth against which all answers are graded
(§2.1), the construction and freezing of the question set (§2.2), the two
experimental conditions (§2.3), the judging protocol (§2.4), and an independent
verification of the ground truth against the city's own APIs, including one
erratum it produced (§2.5).

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

The v2 instrument contains 136 questions in seven blocks, generated
programmatically from the database and frozen at git commit `d891dac` (SHA-256 of
the question file recorded in the commit) before any model was queried. The
protocol's block targets (35/22/25/25/20/15/8) were reduced by quality floors,
every shortfall named in the artifact: six candidate superlatives had no reliable
gap between first and second place, nine candidate addresses had too little
approved construction nearby and two failed to geocode, two pairwise candidates
missed their floors, and only validated measurement mechanisms qualify as
distractors, which yielded six of the eight designed. One further item (q039) was
dropped by the freeze-time verification of §2.5. The v1 pilot (43 questions, frozen at `064dc90`, same block
design at smaller scale) is preserved in the repository history and summarized
where its results differ.

| Block | n | Form | Rationale |
|---|---|---|---|
| Direction | 35 | "Is X rising or falling in {neighborhood}?" | Press coverage sometimes exists; recall can succeed |
| Superlative | 15 | "Which neighborhood had the largest increase in X?" | Requires an aggregation over all areas that has not been published |
| Numeric | 25 | Counts, ±30% tolerance | Tests quantitative knowledge directly |
| Pairwise | 23 | "Which of A or B rose more?" | Chance baseline is 50%; measures comparison under uncertainty |
| Address-level | 17 | "Units approved within ~500 m of {address}?" | The forward-looking question relevant to an individual property |
| Temporal | 15 | Changes between the years ending June 2024 and June 2025 | Control: falls inside training windows |
| Distractors | 6 | Enforcement-vs-victimization; the 311 artifact; closure lag; assessment lag | Control: penalizes uncritical acceptance of misleading aggregates |

Metrics used include victim-reported crime, business openings, eviction filings,
encampment reports, and net approved housing units. Volume and effect-size floors
ensure that each expected answer is unambiguous at the stated tolerance.

One bookkeeping note for reproducers: in v2 every distractor is typed `trap` in
the frozen artifact (q132 through q137) and needs no remapping. The note applies
to the v1 pilot only, where the second distractor was typed `direction`; the
analysis script (`app.benchmark.stats`) applies that remapping to v1 artifacts
alone.

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
temperature settings. One run per condition, under an explicit cost cap
(stability replicates belong to the registered regeneration). Total API cost was
approximately $150 across the pilot and this run. Exact model identifiers:
`claude-fable-5`, `gpt-5.6-sol`, `gpt-5-search-api`, `sonar-pro`, `grok-4.5`.
Gemini could not be included due to account constraints and joins the next
regeneration.

### 2.4 Judging

Answers are graded by an LLM judge (`claude-sonnet-5`, held out of the test set)
that receives the question, the pre-verified ground truth with its receipt, and the
model's answer, and classifies only whether the answer commits to the recorded
truth: *correct*, *wrong*, or *nonanswer* (refusals and non-committal hedges). Wrong
answers delivered without meaningful hedging are additionally flagged as
*confidently wrong*; following VOYGR's scoring rationale, we regard this as the most
costly outcome for users, who receive misinformation rather than no information.

**Judging completeness.** Verdict coverage is completed by a pre-specified repair
pass that grades only missing verdicts, with the same judge and prompt, never
re-grading existing ones; every repaired verdict is flagged in the artifacts. In
v2, a provider overload burst left 97 of 1,243 verdicts unparsed on the first
pass; the repair pass (with backoff) healed 94, and the remaining 3 are excluded
rather than assumed. In v1 the analogous figures were 19 unparsed, 18 healed, 1
excluded, plus one rubric-deviating verdict retained as judged and flagged for
the human audit.

**Cross-vendor panel.** Answers are additionally re-graded by two judges from
other vendors (`gpt-5.6-sol` and `grok-4.5`, each itself a tested system, which
we disclose), using the identical prompt as the primary judge. Both panel judges
were run against all ten model-condition cells.

Panel coverage in v2 is nonetheless substantially incomplete, and the
incompleteness is not random. Of 1,021 answers for which all three judges returned a
response, 554 lost at least one verdict to provider-side failures (read timeouts
and rate limiting), leaving 467 items with three parsed verdicts. The losses fall
almost entirely on the two panel judges (the xAI judge returned 407 errors, the
OpenAI judge 145, the primary judge 2) and they cluster by cell rather than
scattering: the xAI judge failed on every Perplexity item in both conditions, and
the OpenAI judge failed on 123 of 136 Claude grounded items. The resulting
coverage is:

| Cell | Panel-complete | Answers |
|---|---|---|
| Grok 4.5 unassisted | 135 | 136 |
| Claude Fable 5 unassisted | 111 | 136 |
| GPT-5.6 Sol unassisted | 72 | 136 |
| GPT-5 search unassisted | 69 | 70 |
| Grok 4.5 grounded | 67 | 136 |
| Claude Fable 5 grounded | 13 | 136 |
| Perplexity sonar-pro, both conditions | 0 | 271 |
| GPT-5.6 Sol grounded, GPT-5 search grounded | 0 | 222 |

Two consequences follow and we state them rather than aggregate over them. The
panel speaks to 467 of 1,243 answers (38%), it says nothing at all about
Perplexity, and it covers only 80 grounded answers of 630, so it is largely a
check on the unassisted condition. Across those 467 items, pairwise agreement is
96-98%, Fleiss kappa is 0.95, 96.2% of items are unanimous, and no item lacks a
majority. The self-preference probe finds every judge's delta on its own vendor's
answers within 1.4 percentage points of the other judges'. That probe is the
weaker of the two results, because each judge's own-vendor stratum is restricted
to the items that same judge succeeded in grading; we therefore claim no
detectable self-preference on the completed subset, not its absence in general.

The v1 panel is the stronger evidence on both counts: it covered all 430 pilot
items with no coverage loss, measuring kappa 0.946 and deltas of −1.2/−0.6/0.0.
The v2 panel should be read as a second, partial replication of that result
rather than as an independent full-coverage check. Completing panel coverage,
with retries budgeted for provider failure, is carried into the registered
regeneration. The primary estimator remains the pre-specified single judge; the
panel is a robustness check (`benchmark_v2_panel.json`, verdicts under
`benchmark_runs_v2/panel/`).

All verdicts are stored with one-line rationales
(`benchmark_runs_v2/*.judged.json`) and are auditable. A stratified human audit of
judge verdicts is part of the protocol, with the agreement rate to be published as
the judge's error bar. One limitation is noted for the record: the judge shares a
vendor with one tested model. The fixed-evidence design (the judge never assesses
facts, only commitment to supplied facts), the cross-vendor panel below, and the
human audit are the mitigations.

### 2.5 Independent verification and an erratum

A benchmark whose ground truth is computed by the authors' own pipeline invites a
circularity objection. To remove it, every expected answer was re-derived by a
standalone script (`scripts/verify_v2_answers.py` for v2,
`scripts/verify_v1_answers.py` for the pilot) that uses only the Python standard
library and `requests`: it queries the city's own SODA endpoints directly,
aggregates server-side, and uses the city's own analysis-neighborhood
assignments rather than our H3 spine. The script shares no code with the Canary
pipeline, and its raw API responses are archived alongside the report.

For v2 the verification ran at freeze time, before any model query, as the
protocol requires. It performs two distinct checks, and separating them matters
because they caught different things.

The first is **reconciliation**: does the frozen expected answer still hold
against the city's live records? Every one of the 137 generated questions
reconciled. 136 were confirmed computationally (every superlative winner and
recorded runner-up, every pairwise ordering, all 17 address-ring totals exactly,
every embedded trap decomposition), and one Prop-13 trap is documentary rather
than computable. No question failed reconciliation. Live-API drift over the
frozen snapshots peaked at 1.8%, on a superlative runner-up value whose ordering
was unaffected; on the direction-block twelve-month aggregates it peaked at 0.65%.

The second is a **semantics check**: does the metric compute what its own
documentation says it computes? This is where the one failure surfaced, and it is
worth being precise about its shape. The "largest decrease in business closures"
item (q039) reconciled perfectly: the frozen answer and the live API agreed on
the winner, the runner-up, and the values. Both were nevertheless wrong relative
to the documented metric, because a staging-layer boolean parse bug (the live
export marks administrative closures with a literal string, not a boolean) had
silently turned a documented exclusion into a no-op. Under the intended
semantics the winner changes from Japantown to Visitacion Valley. The item was
dropped before any model ran, the parser was fixed for future builds, and all
other closure questions were verified invariant under both semantics.

We draw the methodological point out because it generalizes past this study.
Reconciliation alone would have passed q039, and did: an independent
re-derivation confirms that a number was computed consistently, not that it was
defined correctly. A pipeline and an external checker can agree precisely because
both read the same mislabeled column. Independent verification therefore has to
carry a definitional audit alongside the recomputation, or it certifies
reproducibility while leaving validity untested.

In the v1 pilot the same verification ran post hoc and confirmed 42 of 43
answers; its one finding, a ring-geometry axis-order bug, was a genuine
reconciliation failure and is retained below as the erratum of record for v1.

That v1 mismatch is an erratum against ourselves. The address-level ring
geometry was computed with a swapped coordinate axis order: the distance
function follows the EPSG:4326 authority order (latitude first), so the "500 m"
rings were in fact ellipses of roughly 395 m east-west by 933 m north-south.
Under corrected geometry the expected values of two of the three address
questions stand within their tolerances; the third (q037) does not. The true
500 m disk around that address contains 188 net units against the frozen
expected 53, the gap dominated by a single 185-unit permit 459 m away.
Following the pre-registered freeze, no verdict is re-graded: the frozen values
remain the graded truth. We note the sensitivity openly: under the corrected
value, two unassisted answers (Grok 4.5's "100 to 200" and Claude Fable 5's
"200 to 400") would plausibly grade correct, raising pooled address-level
unassisted accuracy from 13% to at most 27%. The error therefore harmed the
models, not our thesis, and no conclusion changes. The grounded condition is
unaffected in kind, since it grades whether models commit to the supplied
payload, which carried the same ring value. The geometry was fixed in the
generator and in the production lookup path; the v2 freeze-time verification
subsequently reproduced all 17 of v2's ring totals exactly under true-disk
geometry, closing the erratum. This note remains the record of it.

## 3. Results

Table 1 and Figure 1 report overall accuracy by model; Table 2 and Figure 2
report accuracy by question block, pooled across the five models. Uncertainty is
reported as Wilson 95% intervals (in brackets), and the condition contrast is
tested per model with an exact McNemar test on question-paired outcomes. Every
number in this section is emitted by `app.benchmark.stats` from the stored
verdicts; the tables are pasted from its output.

Table 1. Overall accuracy by model and condition, with Wilson 95% intervals and
exact McNemar p for the paired condition contrast.

| Model | Unassisted | Grounded | Confidently wrong (unassisted) | McNemar p |
|---|---|---|---|---|
| Claude Fable 5 | 40% [33, 49] (55/136) | **99%** [96, 100] (135/136) | 72/136 | 1.7 × 10⁻²⁴ |
| Grok 4.5 | 32% [25, 40] (43/135) | **99%** [95, 100] (134/136) | 89/135 | 1.6 × 10⁻²⁷ |
| GPT-5.6 Sol | 36% [28, 44] (49/136) | **99%** [94, 100] (85/86)¹ | 85/136 | 1.1 × 10⁻¹⁶ |
| GPT-5 search | 25% [16, 36] (17/69)¹ (25 refusals) | **95%** [90, 97] (128/135) | 22/69 | 1.8 × 10⁻¹³ |
| Perplexity sonar-pro | 47% [39, 56] (64/135) | **95%** [90, 97] (129/136) | 62/135 | 5.1 × 10⁻¹⁷ |

¹ A network failure on the querying machine during the run cost part of two cells
(GPT-5 search unassisted: 69 of 136 answered; GPT-5.6 Sol grounded: 86 of 136);
answers received later in the recovery were kept, none were discarded, and no
answer was re-asked after a successful response. Because questions are ordered by
block, the missing answers concentrate in later blocks for those two cells. All
accuracies are reported over answered-and-judged items with exact denominators.
Three verdicts of 1,243 failed to parse after retries and are excluded rather than
assumed.

![Grouped bar chart of unassisted versus grounded accuracy for the five models. Unassisted bars sit between 25 and 47 percent; grounded bars sit between 95 and 99 percent.](frontend/public/research/fig1_models.svg)

**Figure 1.** Overall accuracy by model and condition (data of Table 1). "With
Canary data" is the grounded condition: the model sees one Canary API response
before answering. Whiskers are Wilson 95% intervals; the two cells affected by
the disclosed coverage loss are plotted over their answered denominators.

Table 2. Accuracy by question block, pooled across the five models, with Wilson
95% intervals and exact counts.

| Block | Unassisted | Grounded |
|---|---|---|
| Superlative | 12% [6, 21] (9/75) | 90% [80, 95] (54/60) |
| Numeric | 20% [14, 28] (25/122) | 95% [90, 98] (119/125) |
| Pairwise (chance = 50%) | 45% [35, 55] (41/91) | 98% [94, 100] (112/114) |
| Direction | 54% [47, 61] (93/172) | 99% [96, 100] (139/140) |
| Address-level | 22% [14, 34] (15/67) | 98% [92, 99] (83/85) |
| Temporal (in training window) | 37% [26, 49] (22/60) | 99% [93, 100] (74/75) |
| Distractors | 96% [80, 99] (23/24) | 100% [89, 100] (30/30) |

![Grouped horizontal bar chart of unassisted versus grounded accuracy for the seven question blocks. Superlative scores 12 percent unassisted and numeric 20 percent, against 90 and 95 percent grounded; the temporal control collapses to 37 percent unassisted and recovers to 99 percent grounded; only the distractor block is high in both conditions.](frontend/public/research/fig2_blocks.svg)

**Figure 2.** Accuracy by question block, pooled across the five models (data of
Table 2), with Wilson 95% whiskers. The blocks that require an unpublished
aggregation (superlative, numeric, address-level) collapse in the unassisted
condition and recover when grounded. Unlike the pilot, the temporal control also
collapses unassisted (37%): in-window aggregates fail too, unless they happened
to be published (§3.4).

### 3.1 Error analysis: the superlative block

Question q036 asked which San Francisco neighborhood had the biggest increase in
new business openings over the past year. The registry answer is Japantown (+38%,
the largest rise citywide). The five unassisted responses:

- **Claude Fable 5:** Hayes Valley, attributed to the neighborhood's AI startup
  concentration and the coworking, cafe and retail activity around it.
- **Grok 4.5:** Hayes Valley, citing business registries, local press trackers and
  commercial vacancy data.
- **GPT-5 search:** Mission Bay, citing 2025 consumer-spending growth retrieved
  from the web.
- **Perplexity sonar-pro:** Mission Bay, citing a genuine 2025 sales-tax analysis
  showing a 31% revenue increase.
- **GPT-5.6 Sol:** Financial District/Downtown, attributed to renewed office
  activity and storefront backfill.

Three distinct answers, each argued from real but non-dispositive context, none
correct. At v2 scale the superlative block scores 12% unassisted (9 of 75), the
successes concentrated where a ranking had received press coverage.

**The errors are not independent.** In v0 we observed three previous-generation
models converging on the same wrong answer and read it as a shared
training-distribution prior. At v2 scale that pattern is measurable rather than
anecdotal, and it persists at the frontier. Across the fifteen superlative items,
three or more of the five models selected the same incorrect neighborhood on five
items, and on one (q051, the largest rise in enforcement-driven incident counts)
all five named the Tenderloin, where the record gives the Mission. Wrong
superlative answers concentrate on a small set of nationally legible
neighborhoods: the Tenderloin appears 18 times, the Mission 14, and South of
Market 9. That is 41 of the 55 incorrect responses that name an identifiable
neighborhood, three quarters of them, and 41 of the 66 incorrect responses
overall (the remaining 11 are refusals or name no resolvable area). The
ground-truth answer set for these items is quieter, including Japantown,
Lakeshore, Portola, Twin Peaks, McLaren Park and Sunset/Parkside.

The substantive reading is that when the ranking has not been published, models do
not fail toward noise. They fail toward salience, selecting the neighborhood whose
name carries the strongest association with the metric in question: the Tenderloin
for anything adverse, the Mission for anything changing. This is the area-level
counterpart of the Silicon Gaze finding (§1) that model-produced neighborhood
rankings track social divides rather than measured characteristics, reproduced
here against per-neighborhood ground truth rather than against inferred sentiment.
It also carries a fair-housing consequence for deployed systems, since the
mechanism systematically attaches adverse superlatives to the same small set of
neighborhoods irrespective of the record.

Frontier models therefore did not escape the prior; they became more articulate
inside it, constructing more sophisticated justifications without any improvement
in accuracy. This is the expected signature of a task whose answer is absent from
the training distribution and from the retrievable web: no reasoning path
terminates at the fact, because the fact was never published. In the grounded
condition, Grok 4.5 answered the same class of question in one line: Japantown,
50 to 69 openings, +38%, with the z-score.

### 3.2 Error analysis: the numeric block

Asked how many net new housing units were approved in Nob Hill in the twelve months
before July 2026, GPT-5.6 Sol answered "roughly 25 net new housing units," with a
caveat about boundary definitions. The permit record gives 1,319, driven by a small
number of large approved projects. The error is a factor of approximately fifty, and
the response format (a specific figure with a methodological caveat) is
indistinguishable from that of an informed estimate (a pilot example; the pattern
persists at scale). In v2, 20% of unassisted numeric answers fall inside the ±30%
tolerance (25 of 122), against 95% grounded (119 of 125).

### 3.3 The generational shift in failure mode

In v0, previous-generation models refused frequently (GPT-4o declined 39 of 46
items). In v1, refusals nearly disappear outside the search-configured model, and
error mass moves into confident, specific, well-argued wrong answers. In v2 this
is 46-66% of all items for the four models that answer in volume (72/136 for
Claude Fable 5, 89/135 for Grok 4.5), and 32% for the search-configured model,
which is the only one that still refuses in volume (25 refusals). From a user-welfare perspective this is a regression: an abstention
prompts further search, whereas a fluent wrong answer terminates it.

### 3.4 Controls

The temporal control produced the most instructive revision of this study. In the
v1 pilot (four questions, the largest effect sizes in the record), models scored
95% on questions whose answers fall inside their training windows, and we
concluded the deficit was specific to the recent present. At fifteen questions
spanning more metrics and less-covered neighborhoods, in-window accuracy is 37%
[26, 49]. The pilot's control questions were, in retrospect, the ones most likely
to have left traces in text: extreme swings in prominent places. The scaled
control shows that in-window aggregates fail almost as badly as recent ones
unless they happened to be written about. This sharpens the study's conclusion:
the binding constraint is not training recency but whether the aggregate was ever
published as text. Grounded, the same temporal questions score 99%.

The distractors held: 23 of 24 unassisted distractor responses were correct, the
single miss again the designed failure occurring in the wild (a model accepting an
enforcement-driven aggregate as a safety trend). The deficit is confined to aggregate facts about
the recent present, which is precisely the class of fact that must be computed from
primary records rather than remembered from text.

### 3.5 Grounded condition

With one API response prepended, grounded accuracy is 95-99% across all five
models at 136 questions (in the pilot, three of five were perfect on all 43),
with residual misses
attributable largely to judge strictness on phrasing rather than misreading. Five
models from four vendors used the same documented payload without any per-model
tuning. We take this as evidence that current frontier models are already sufficient
consumers of structured area data, and that the binding constraint is the existence
and machine-legibility of the data itself.

## 4. Discussion

### 4.1 Where an area answer comes from

Interpreting these results requires being explicit about the channels through
which a language model can arrive at a fact about a neighborhood. There are three,
and this study constrains each of them separately.

**The first is parametric memory: text the model read during training.** This
channel can only carry a fact if some document stated it. For the questions here,
that document would have to contain a computed aggregate, such as a ranking of all
forty-one analysis neighborhoods by change in business openings. The city
publishes the underlying records, millions of individual permits, registrations
and incident reports, but it does not publish the aggregation, and neither does
anyone else. The temporal control isolates this channel: those questions concern
periods lying entirely inside the training windows, so recency cannot be the
limiting factor, and models still scored 37%. Where the aggregate had been written
about, they succeeded; where it had not, training vintage bought them nothing.

**The second is retrieval: text fetched from the live web at query time.** This
channel is subject to the same constraint, because retrieval can only return
documents that exist. Our two search-configured systems bracket the outcome. GPT-5
with native web search scored lowest of all five at 25%, and Perplexity sonar-pro,
scoring highest unassisted at 47%, still missed the majority of items and cited
real sources while doing so. Retrieval does not fail here for lack of capability.
It fails because the corpus does not contain the answer, and a retrieval system
that cannot find the target returns the nearest adjacent document instead: a
sales-tax analysis, a vacancy report, a press piece about a different
neighborhood. §3.1 shows both search systems doing exactly this.

**The third is inference from priors, which is what remains when the first two are
empty.** Under a system prompt instructing it to commit to an answer, a model with
no retrievable fact and no memorized aggregate must still produce a neighborhood
name, and §3.1 measures which one it produces. The selection is not random. It
tracks name salience: the Tenderloin for adverse metrics, the Mission for change,
South of Market for construction, together about two thirds of incorrect
superlative answers. The observable signature of this channel is confidence
without correctness, which is precisely the failure mode that grew between
generations (§3.3).

The three channels explain the shape of Table 2. Blocks whose answers sometimes
appeared in text, direction and the distractors, score moderately to well. Blocks
requiring an aggregation nobody published, superlative, numeric and address-level,
collapse. The distractor block is the informative control in the other direction:
those items require reasoning about a supplied misleading aggregate rather than
recall of an unpublished one, and models score 96%. Reasoning is intact. The
inputs are missing.

This also bounds what better models can achieve. Capability improvements act on
the third channel, making inference sharper, and on the second, making retrieval
more efficient. Neither operation can return a number that was never computed by
anyone. The remedy has to add the fact, which is what the grounded condition does
and what §3.5 measures.

### 4.2 Interpretation

**The deficit is informational, not cognitive, and not temporal.** Four
observations triangulate this conclusion: capability improved between generations
while diagnostic-block accuracy did not; search-native configurations failed
alongside parametric ones, the live-search system scoring lowest; supplying the
missing data recovered near-ceiling performance in every model tested; and, new at
this scale, questions whose answers fall entirely inside training windows failed
almost as badly (37%) as questions about the recent present. The pilot's
near-perfect temporal control turns out to have sampled exactly the aggregates
extreme enough to have been written about. The general case is the opposite: an
aggregation that was never published cannot be recalled from any training vintage,
retrieved by any search engine, or conjured by additional model scale. The
constraint is whether the number was ever computed and written down, and for the
class of facts studied here, it almost never was.

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
without such corrections inherit exactly the errors this benchmark penalizes. The
same discipline applies to ourselves: independent verification has now caught one
real bug in each version (v1's ring geometry post hoc; v2's silent failure of a
documented exclusion, at freeze time, before any model ran), neither of which
internal review had found. We regard external re-derivation as a standing
requirement of benchmark practice rather than a one-time exercise, and the v2
sequencing, verify before querying, is the version we recommend.

**Scope of claims.** These results establish the failure and its remediability at
136 questions, on our question dimensions, in one metropolitan area. They do not
establish market demand for external grounding; that is an adoption question outside
the scope of this study.

## 5. Limitations

One metro; one run per condition; 136 questions; five models, with Gemini absent.
This run followed the committed protocol design (`PROTOCOL_V2.md`, in the
repository before generation) but its OSF registration did not precede it; the
externally timestamped registration is reserved for the next regeneration, and
until then the freeze rests on the git commit and its recorded hash. A network
failure on the querying machine reduced two cells' coverage (GPT-5 search
unassisted 69/136, GPT-5.6 Sol grounded 86/136), disclosed in Table 1 with exact
denominators; three of 1,243 verdicts remain unparsed and excluded. The
cross-vendor panel is the weakest link in this run: provider-side failures cost
it 554 of 1,021 items, leaving 467, with no coverage of Perplexity in either
condition and only 80 of 630 grounded answers (§2.4). Its kappa of 0.95 is
therefore a partial replication of the v1 panel's full-coverage 0.946 rather than
an independent check of this run, and its self-preference null holds only on the
subset each judge completed. The judge is a language model: verdicts are stored
and auditable, a human audit of a verdict sample is owed, and the judge shares a
vendor with one tested model. In the
grounded condition, Canary data serves as both context and ground truth by design;
the condition tests whether models retrieve and commit to supplied area data, while
the validity of the data itself is assessed separately, with receipts and
falsifiable forward predictions, in Appendix A. The ±30% numeric
tolerance is permissive. The distractor block (n=6) is small and its percentage
carries wide uncertainty; the temporal block (n=15) carries a Wilson interval of
[26, 49], wide enough that its point estimate should be read as a range.

## 6. Reproducibility

Every step below reads the frozen v2 artifact, selected by two environment
variables. Set them first; without them the harness defaults to the v1 pilot.

```
cd backend
export BENCH_FILE=benchmark_v2.json BENCH_RUNS=benchmark_runs_v2

python -m app.benchmark.run                # unassisted condition, all configured providers
python -m app.benchmark.run --grounded     # grounded condition
python -m app.benchmark.judge              # primary verdicts and summary table
python -m app.benchmark.judge --repair     # complete any unparsed verdicts (flagged)
python -m app.benchmark.panel              # cross-vendor judge panel
python -m app.benchmark.panel --agree      # panel agreement report
python -m app.benchmark.stats              # Wilson intervals, McNemar, Tables 1-2
python scripts/gen_figures.py              # Figures 1-2 from the stats artifact
python scripts/verify_v2_answers.py        # Canary-free re-derivation from city APIs
```

`python -m app.benchmark.generate_v2` regenerates the question set from the live
database and is deliberately omitted from the sequence above: it overwrites the
frozen artifact, and the freeze is what makes the graded answers checkable. Run
it only to build a new version.

Artifacts: `data/processed/benchmark_v2.json` (questions and receipts, frozen at
`d891dac`, following the pre-verification freeze of 137 questions at `fbd6166`);
`data/processed/benchmark_runs_v2/` (all raw answers and judged verdicts), stamped
with pipeline git version and source snapshot date; `benchmark_v2_stats.json`,
`benchmark_v2_panel.json` and `benchmark_v2_verification.json` for the analysis,
panel and verification outputs. The v1 pilot artifacts are retained under the
same names with the `v1` suffix. The intended
cadence is monthly regeneration alongside the data, so that the question set tracks
the live record.

## 7. Future work

This run executed the committed protocol design (`PROTOCOL_V2.md`) at reduced
cost: one replicate, five systems, and no contamination stratum or human
baseline. The next regeneration completes the protocol: OSF registration before
any query (the externally timestamped freeze this run lacked), three replicates,
an open-weights system and Gemini, the scripted contamination audit archived at
freeze, and the compensated human baseline of San Francisco residents, closed
book and then with internet access. A second metropolitan area is deferred to a
later version, and single-metro scope remains a stated limitation until then.
The intended cadence is a recurring, versioned report regenerated alongside the
data, so that the question set tracks the live record and results remain
accountable over time.

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
  note        = {Working note v2, San Francisco. 136 questions frozen and
                 independently verified at d891dac; v1 pilot (43 questions) at 064dc90.}
}
```
