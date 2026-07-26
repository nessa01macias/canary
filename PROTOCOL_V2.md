# Pre-registration: AI Area Benchmark v2

**Status: DRAFT, not yet registered.** This document becomes binding when it is
(1) frozen at a git commit, and (2) registered on OSF (osf.io) with a public
timestamp, both **before any v2 model query is issued**. Any later change is a
deviation and must be logged in the Errata section, dated, with a reason.

Authors: Melany Macías, Katerina Tchilinguirov (Canary). An academic
collaborator, if recruited before freeze, is added here with their role.

## Conflict of interest

The authors are founders of Canary, a company whose product supplies the
grounding payloads evaluated in this study. The benchmark measures a data gap
that the company exists to fill. This conflict is disclosed in all reports of
the results. The mitigations are structural rather than rhetorical: the
protocol is registered before execution, every expected answer is re-derivable
from public records without Canary code (§6), all artifacts are released
(§10), and grading is performed by a cross-vendor judge panel with a published
human audit (§7).

## 1. Background and prior results

The v1 pilot (RESEARCH.md; 43 questions, San Francisco, five frontier models,
question set frozen at git commit 064dc90) found unassisted accuracy of 36-45%
with confident error as the dominant failure mode, 0% pooled accuracy on
ranking and counting blocks, 95% on an in-training-window control, and 93-100%
accuracy when one Canary API response was prepended. v2 tests whether these
findings survive scale, replication, a second metropolitan area, independent
judging, a human baseline, and a measured (rather than asserted) contamination
audit.

## 2. Hypotheses (pre-specified)

Primary outcome: paired difference in accuracy between the grounded and
unassisted conditions, pooled over questions, per model, per metro.

- **H1 (data gap).** For every tested model, unassisted accuracy on the
  aggregation blocks (superlative, numeric, address-level) is below 50% in
  each metro.
- **H2 (remediability).** For every tested model, grounded accuracy pooled
  over all blocks is at least 90%, and the paired grounded-minus-unassisted
  difference is significant at p < 0.001 (McNemar exact test).
- **H3 (capability control).** Unassisted accuracy on the temporal
  in-training-window block is at least 85% pooled across models, in each
  metro.
- **H4 (generality).** The grounded-minus-unassisted gap exceeds 30 percentage
  points for every model in both metros.
- **H5 (contamination stratum).** Unassisted accuracy on questions whose
  answers are retrievable on the public web at freeze time (as measured by the
  §5 audit) exceeds unassisted accuracy on unpublished-answer questions by at
  least 20 percentage points. This tests the mechanism claim directly: models
  fail because the answers were never published.
- **H6 (human baseline).** Informed local residents without internet access
  score below 60% on the aggregation blocks; that is, the gap is a property of
  the information environment, not of machines.

Secondary, descriptive (no hypothesis): per-block accuracies with confidence
intervals; confident-wrong rates; cross-replicate stability; judge panel
agreement; human-with-internet condition.

## 3. Design summary

Two metros: **San Francisco** (DataSF) and **Chicago** (Chicago Data Portal;
both are Socrata platforms, so the acquisition layer ports). 120 questions per
metro, 240 total, generated programmatically from each metro's canonical
database under the same rules as v1 (volume floors, effect-size floors,
documented exclusions).

Block targets per metro (n = 120): direction 30, superlative 18, numeric 20,
pairwise 20, address-level 15, temporal control 12, distractor controls 5.

Models (final list fixed at freeze; exact API identifiers recorded): the then
current frontier chat model from Anthropic, OpenAI, Google, and xAI; one
search-configured variant (OpenAI web search or equivalent); Perplexity
sonar-pro; one pinned open-weights model run locally or via a fixed provider
(for exact reproducibility after commercial APIs drift). Provider-default
temperature; all request parameters logged; raw responses archived.

Conditions: **unassisted** and **grounded**, identical questions. The grounded
payload specification is frozen with this protocol: the data slice one Canary
API call returns, its field documentation, and for address-level items the
ring aggregate plus largest constituent permits (the v1.0.1 correction is
encoded as the specification, not rediscovered).

Replicates: **3 runs per model per condition.** Primary analysis scores each
question by majority verdict across replicates; per-replicate results are
reported as a sensitivity analysis, and cross-replicate flip rates are
reported as a stability measure.

## 4. Freezing and provenance

Before any model query: questions, expected answers, receipts, grounded
payloads, judge prompts, and this protocol are committed; the commit hash and
a SHA-256 of the question file are recorded in the OSF registration. Ground
truth carries the two-date rule (source as-of date and fetch date) on every
row, as in the production pipeline.

## 5. Contamination audit (new in v2)

For every question, at freeze time, a scripted search protocol (fixed query
templates per block, one commercial search API, top 10 results fetched and
archived) determines whether any retrievable public page states the expected
answer within the question's tolerance. Two annotators label each question
**published** or **unpublished** from the archived pages only; disagreements
are adjudicated and the archive is released. Contamination status is a
pre-registered stratum (H5), not an exclusion criterion: published-answer
questions stay in the set, because the difference between strata is itself
the evidence.

## 6. Ground-truth independence

Alongside the question set we release a **verification script that recomputes
every expected answer directly from the source portal APIs** (Socrata
endpoints), with no Canary pipeline code in the dependency chain, pinned to
the frozen snapshot dates. Where an expected answer requires a documented
measurement correction (enforcement-versus-victim decomposition, the 311
channel artifact), the correction is implemented inside the verification
script and justified inline. A reviewer must be able to check any answer from
the city's records alone.

The verification script runs **at freeze time**, before any model query, and
its report plus archived API responses join the registered artifact set; any
expected answer it fails to confirm is corrected or dropped before the freeze.
Geometric predicates (address rings) are additionally unit-tested against
hand-computed distances before generation. Both requirements are lessons from
v1, where post-hoc verification confirmed 42 of 43 answers but exposed a
coordinate axis-order bug that had turned 500 m rings into ellipses
(RESEARCH.md, verification section).

## 7. Judging

A **three-judge panel** from three different vendors (none the same model as
any tested system; vendor overlap with tested systems is unavoidable and
disclosed), each receiving the question, the ground truth with receipt, and
the model's answer, classifying commitment to the recorded truth: correct,
wrong, or nonanswer, with a confident-wrong flag on unhedged wrong answers.
The panel verdict is the majority. Judge responses get a token budget sized
well above the longest observed verdict (v1's 200-token cap truncated 19
verdicts mid-JSON); parse failures are retried up to three times, residual
holes are completed by a repair pass that grades only missing verdicts and
flags them in the artifacts, and any verdict still unparsed is excluded and
reported.

**Human audit:** two human annotators independently grade a stratified 15%
sample of panel verdicts (stratified by model, condition, block, and verdict).
Agreement (Cohen's kappa annotator-to-annotator and annotator-to-panel) is
published, disagreements are adjudicated, and the adjudicated sample is
released. If annotator-to-panel kappa falls below 0.80, all wrong and
nonanswer verdicts are human-reviewed before publication.

## 8. Human baseline

Per metro: at least 8 adult residents (2+ years in the metro; screened for
self-reported familiarity with local development and news; compensated).
Each answers a stratified 50-question subset in a proctored session, twice:
first closed-book, then with unrestricted internet access and a 2-minute
budget per item. Consent is obtained in writing; no personal data beyond
residency tenure and self-rated familiarity is collected or published;
responses are released only in aggregate. If an academic collaborator joins,
the session plan goes through their institution's exemption process before
running.

## 9. Statistical analysis plan

- All proportions reported with Wilson 95% confidence intervals; figures carry
  interval bars.
- H1, H3, H4: tested directly against the stated thresholds per model per
  metro, with Wilson intervals; the hypothesis holds if the point estimate
  clears the threshold and is claimed with its interval.
- H2: McNemar exact test on question-paired outcomes per model per metro.
- H5, H6: two-proportion comparisons with Wilson intervals on the difference;
  H5 additionally via logistic regression accuracy ~ condition + block +
  model + metro + published-stratum, standard errors clustered by question.
- Multiplicity: primary hypotheses H1-H4 are confirmatory and reported
  unadjusted with exact p-values; H5-H6 are labeled exploratory-confirmatory
  and Holm-adjusted within their family.
- Power note, stated honestly: per-block interval widths at n = 15-30 are
  roughly ±12-20 points; block-level results are estimates with intervals,
  not precise points. The paired pooled design (n = 240) has power > 0.99 for
  a 30-point condition gap.

## 10. Release

On publication of results: questions, receipts, grounded payloads, all raw
model responses, all judge verdicts with rationales, the contamination
archive, the verification script, analysis code, and this protocol, as a
versioned public repository with a DOI (Zenodo), plus a dataset mirror on
Hugging Face. Model outputs are released under the providers' permitted-use
terms; public-record data under the source licenses listed in SOURCES.md.

## 11. Cost and timeline estimate (non-binding)

Answer calls: 240 questions x ~8 systems x 2 conditions x 3 replicates =
~11,500. Judge calls: ~34,500 (3 judges). Estimated API cost $1,000-2,500.
Human sessions: ~$800-1,500 in compensation. Timeline: Chicago pipeline port
3-4 weeks; question generation and contamination audit 2 weeks; runs and
judging 1 week; human sessions in parallel; analysis and writing 3-4 weeks.
Target: roughly one quarter end to end.

## 12. Deviations and errata

None yet. Any deviation after registration is logged here with date, what
changed, and why, and is disclosed in the paper.
