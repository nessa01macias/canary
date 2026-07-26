# Do AI assistants know how neighborhoods are changing?
### An area-level ground-truth benchmark with a grounding ablation. v1 pilot, San Francisco.

**Melany Macías · Katerina Tchilinguirov, Canary**
*Working note v1 (pilot) · July 26, 2026 · San Francisco*

---

## Abstract

People increasingly ask AI assistants where to live. We tested five frontier models
(Claude Fable 5, GPT-5.6 Sol, GPT-5 with native web search, Perplexity sonar-pro, and
Grok 4.5) on 43 checkable questions about San Francisco neighborhoods: whether crime
is rising in a given area, which neighborhood is gaining businesses fastest, how much
housing was just approved within 500 meters of a specific address. Every expected
answer is computed from public records and carries a citation, and the question set
was frozen at a git commit before any model was queried. On their own, the newest
models score between 36% and 45%. Unlike the previous generation, they rarely refuse
to answer; their dominant failure mode is confident error. Grok 4.5 gave confidently
wrong answers on 25 of its 43 responses. Across the five models, the twenty-five
attempts at "which neighborhood changed most" produced zero correct answers. When we
prepended a single Canary API response to the same questions, accuracy rose to
93-100%, and three of the five models scored perfectly. We conclude that the gap is
not model capability, which visibly improved between generations, and not web
freshness, since the search-native models fail too. The answers to these questions
had simply never been computed and published anywhere, and no amount of intelligence
or retrieval can recover a fact that does not exist in written form.

## Lay summary

We asked the five newest AI models 43 checkable questions about San Francisco
neighborhoods, the kind anyone deciding where to live actually asks. Is crime getting
better here? Where are new businesses opening fastest? How much housing was just
approved near this address? Every question has a verifiable answer in the city's own
public records.

Without help, the models failed, and they failed confidently. The newest generation
almost never says "I don't know" anymore. It answers everything, and it was
confidently wrong on up to 25 of 43 answers, often without a single hedge. When we
asked which neighborhood rose the most, the five best models on earth went zero for
twenty-five between them. When we asked them to simply count things, like housing
units approved or active businesses, they scored zero percent.

The reason they fail is worth being precise about. These answers are not stale
somewhere on the web, waiting for a better search engine. They were never on the web
at all. Nobody had ever computed them from the millions of raw records the city
publishes, so there was never a sentence for a model to learn or retrieve. Between
model generations the AIs became more fluent, but they became more fluent about the
same missing facts.

Then we gave the same models one response from Canary's data. Three of them scored
perfectly. The other two scored 93% and 95%. Same models, same questions; the only
thing that changed was the data. The AIs were never the problem. The missing layer
was.

*(This is a pilot: one city, 43 questions, one run per condition. The full method,
numbers, and limitations follow.)*

> The accuracy gap is not a prompt-engineering problem, and for neighborhoods it is
> not even a freshness problem. It is an aggregation problem. The answers are not
> stale on the web; they do not exist on the web.

## 1. Why we ran this

The place level is already covered. VOYGR's Quarterly LLM Benchmarking Study ran 345
prompts about restaurants, opening hours, and bookings, and found that models
recommend closed and even fabricated venues. The Silicon Gaze audit of twenty million
queries found that when models rank neighborhoods, the rankings mirror social divides
rather than measured characteristics. What nobody had benchmarked is the area level:
whether a neighborhood is improving or declining, and what is already approved to be
built there. It says something that VOYGR's 345 local prompts contain not a single
area-change question. The category was unmeasured, which fits with it being unserved.

We had also run our own smaller pilot (v0: 46 questions against previous-generation
models), which produced bare accuracies between 0% and 39%, dominated by refusals.
The natural objection was that newer models would close the gap. This study tests
that objection directly. The short version of the result: they do not close it. They
change how it looks.

## 2. Where the ground truth comes from

The expected answers are computed by the Canary pipeline from municipal public
records: building permits, the business registry, police incident reports, eviction
notices, and 311 cases, using DataSF snapshots with the as-of date stamped on every
row. Events are aggregated on an H3 hex spine and rolled up to the city's analysis
neighborhoods.

Three properties of this ground truth matter for whether the benchmark can be
trusted. First, provenance: every row carries both the source's own freshness date
and our fetch date, so every answer is reproducible against a stated snapshot.
Second, receipts: every expected answer traces to underlying records, permit numbers
and registry entries, not to a black-box score. Third, and most important,
measurement discipline. Public records mislead in known ways, and we corrected for
them before any model was tested. Police incident counts mix crimes reported by
victims with proactive police activity, so we split them; a surge in drug enforcement
is not a crime wave. A change in the city's 311 app inflated "noise complaints" by
62% and we detected and excluded the artifact. Business closure dates lag reality and
we document it. The validation of the ground truth itself, including a case where the
receipts corrected our own wrong narrative, is written up separately in
[VALIDATION.md](VALIDATION.md).

## 3. The questions

Forty-three questions in seven blocks, generated from the database and frozen at git
commit `064dc90` before any model was queried, in the spirit of pre-registration. We
aimed for fifty; quality floors trimmed seven. Two addresses had too little nearby
construction to ask about honestly, and two pairwise comparisons had gaps too narrow
to grade fairly.

The blocks, and what each one is designed to expose:

- **Direction, 15 questions.** "Is X rising or falling in this neighborhood?" across
  victim-reported crime, business openings, evictions, encampment reports, and
  housing approvals. This is the easiest block, because journalism sometimes covers
  these trends, and a model can succeed by recalling coverage.
- **Superlatives, 5 questions.** "Which neighborhood had the biggest increase in X?"
  Answering requires an aggregation across every neighborhood, which nobody has
  published. There is no article to recall.
- **Numeric, 8 questions.** Counts with a generous ±30% tolerance: how many housing
  units were approved, how many businesses are currently active.
- **Pairwise, 6 questions.** "Which of these two neighborhoods rose more?" A coin
  flip scores 50%, so this block measures whether models beat chance when forced to
  compare.
- **Address-level forward layer, 3 questions.** "How many net new housing units were
  approved within about 500 meters of this address?" The question a buyer or renter
  actually has, and the one no maps product answers.
- **Temporal windows, 4 questions.** Changes between the year ending June 2024 and
  the year ending June 2025, which sit inside the models' training windows. This is
  a control. If models do well here and poorly on the present, the gap is recency,
  not ability.
- **Mechanism traps, 2 questions.** One asks about crime in the Tenderloin, where
  total incidents rose 11% because enforcement rose 44% while victim reports fell
  8%; a naive answer gets the direction wrong for residents. The other asks whether
  San Francisco really got 60% louder, testing whether models treat a reporting
  artifact as reality.

## 4. Protocol

Each model answered every question under two conditions. In the bare condition the
model is on its own, with a system prompt instructing it to commit to a direct
answer. In the Canary condition we prepend one simulated Canary API response: the
slice of data a single call would return, together with field documentation, because
metric definitions ship with every real response. For the address questions the
payload contains the ring aggregate plus the top permits, matching what our
`/api/report` endpoint serves. (Protocol note v1.0.1: our first payload for that
block omitted the aggregate and included only the top ten permits. The models
correctly summed the partial list they were given and were marked wrong for it. That
was our bug, not theirs. We fixed the payload, re-ran the condition, and disclose it
here.)

We used each provider's default temperature throughout, on the argument that this is
what consumers actually get, and because several frontier APIs now reject custom
temperature settings anyway. One run per condition; this is a pilot, and stability
replicates are planned for v1.1. The full study cost about $25 in API fees.

Exact model IDs: `claude-fable-5`, `gpt-5.6-sol`, `gpt-5-search-api`, `sonar-pro`,
`grok-4.5`. Gemini is pending account access and joins in v1.1.

## 5. How answers were judged

An LLM judge (claude-sonnet-5, pinned, and deliberately not one of the tested models)
receives the question, the pre-verified ground truth with its receipt, and the
model's answer. Its only job is to classify whether the answer commits to the
recorded truth: correct, wrong, or nonanswer for refusals and hedges. It also flags
confident wrongness, meaning a wrong answer delivered without meaningful hedging. We
treat that as the worst outcome, borrowing VOYGR's reasoning: a user who gets a
confident wrong answer doesn't get nothing, they get misled.

Every verdict is stored with a one-line rationale in
`benchmark_runs_v1/*.judged.json`, so the judging is auditable rather than taken on
faith. A stratified human audit of the verdicts is part of the protocol, with the
agreement rate published as the judge's error bar. One caveat we want on the record:
the judge shares a vendor with one tested model. The fixed-evidence design and the
human audit are the mitigations.

## 6. Results

| Model | Bare | With one Canary response | Confidently wrong (bare) |
|---|---|---|---|
| Claude Fable 5 | 43% | **100%** (43/43) | 17 of 43 |
| Grok 4.5 | 42% | **100%** (43/43) | 25 of 43 |
| GPT-5.6 Sol | 42% | **100%** (41/41 judged)¹ | 23 of 43 |
| GPT-5 search | 36%, incl. 13 refusals | **95%** | 11 of 43 |
| Perplexity sonar-pro | 45% | **93%** | 21 of 43 |

¹ Two of Sol's 43 grounded verdicts failed to parse during judging and are excluded
rather than assumed correct; all 41 judged answers were correct.

**By question block** (bare accuracy pooled across the five models, then grounded):

| Block | Bare | Canary |
|---|---|---|
| Superlatives | **0%** | 91% |
| Numeric counts | **0%** | 100% |
| Pairwise comparisons | 64% | 93% |
| Direction | 55% | 100% |
| Address-level forward layer | 13% | 93% |
| Temporal, inside training window | 95% | 100% |
| Mechanism traps | 100% | 100% |

### What the failures actually look like

The flagship question asked which San Francisco neighborhood had the biggest increase
in new business openings over the past year. The answer in the registry is Japantown,
up 38%, the strongest rise in the city. Here is what the five models said on their
own.

Grok 4.5 answered **"Mission District,"** in bold, explaining that pre-2025 permitting
trends and foot traffic along Valencia made it "the best available proxy." GPT-5.6
Sol chose **Union Square**, citing the downtown retail rebound. Claude Fable 5 also
landed on **Downtown/Union Square**, and reasoned its way there impressively, naming
the city's Vacant to Vibrant program and first-year tax waivers as mechanisms.
Perplexity, which searches the live web, cited a real 2025 sales-tax analysis and
answered **Mission Bay**. Four different answers, each argued fluently from real
context, each wrong. Nothing any of them could read contained the fact, because until
our pipeline computed it, the fact had never been written down. In our v0 pilot the
previous-generation models had all converged on the same wrong answer, the Mission,
which is what a shared training distribution looks like. The frontier models diverge
more creatively now, and reason more impressively on the way to being wrong. Given
the data, Grok answered in one line: Japantown, 50 to 69 openings, up 38%, and the
z-score.

The counting questions tell the same story with starker numbers. Asked how many net
new housing units were approved in Nob Hill in the past year, Sol answered "roughly
25 net new housing units," with a caveat about boundary definitions. The permit
record says 1,319, driven by a small number of large approved projects. That is not
an error of estimation; it is a guess wearing the costume of an estimate, off by a
factor of fifty. Every model failed every counting question. With the data in
context, every model got every counting question right.

### The generational shift: from refusing to guessing

Our v0 pilot, run on previous-generation models, was dominated by refusals; GPT-4o
declined 39 of 46 questions. The newest models almost never refuse. They answer
everything, and the wrongness has migrated into confident, specific, well-argued
claims. Grok 4.5 was confidently wrong 25 times out of 43 answers. Sol, 23 times.
For a person using these tools to decide where to live, that is strictly worse than
last year: a shrug sends you to look elsewhere, while a fluent wrong answer ends the
search.

### The controls behaved, which is what makes the result meaningful

Two blocks confirm the benchmark is not simply rigged against language models. On
temporal questions about 2024 and 2025, which sit inside their training windows, the
models scored 95%. And both mechanism traps came back perfect: every model correctly
declined to read a police enforcement surge as a crime wave and a 311 app change as
the city getting louder. Frontier models are well calibrated about the past they were
trained on and appropriately skeptical of statistical bait. They fail specifically on
the present state of the world, aggregated, which is precisely the thing that has to
be computed rather than remembered.

### Grounded, the ceiling is the data

With one Canary response prepended, three of the five models scored perfectly,
including the traps and the address questions, and the other two scored 93% and 95%.
It is worth pausing on what that means. Five models from four different vendors, with
no per-model tuning of any kind, read the same documented payload and used it almost
flawlessly. The residual grounded misses were mostly judge-strictness edges rather
than misreadings. When the fact exists and carries its meaning with it, current
models are already excellent at using it. The bottleneck is the existence of the
fact.

## 7. Conclusions

1. Area-level change is a distinct and, until now, unmeasured failure class for AI
   assistants, and at the frontier it is nearly total on the blocks that matter:
   zero for twenty-five on superlatives, zero percent on counting. It is not
   staleness, because the search-native models fail too. It is not capability,
   because capability visibly improved between generations while the failures
   remained. The answers were never computed and published, so they cannot be
   learned or retrieved.

2. Model progress is making this worse for users, not better. The failure mode
   shifted from refusal to confident error between generations. A mover asking
   today's best AI where to live gets a fluent, specific, wrong answer where last
   year they got a shrug.

3. The ablation locates the cure precisely. The same models jump from roughly 40% to
   93-100% when handed one API response. Data, not scale.

4. Semantics are load-bearing. Numbers without field documentation produced
   confident misreadings, including in our own v1.0.1 payload bug, where models
   faithfully summed a truncated list. The product is not numbers; it is numbers
   with their meaning attached, in machine-readable form.

5. The measurement discipline is the defensible layer. Our ground truth needed
   three documented corrections before it was fit to grade anyone. Anyone reselling
   raw public records inherits exactly the errors the models made.

6. What this study establishes, and what it does not: the failure is demonstrated on
   our dimensions at pilot scale. Whether AI products will adopt external grounding
   for area questions is a market question, and this study is evidence of the gap,
   not of adoption.

## 8. Limitations

One metro, one run per condition, 43 questions, five models, with Gemini pending. The
judge is an LLM; its verdicts are stored and auditable, a human check of a verdict
sample is owed, and the judge shares a vendor with one tested model. The grounded
condition uses Canary data as both the context and the ground truth. That is
deliberate: the condition tests whether models retrieve and commit to supplied area
data, while the validity of the data itself is addressed separately, with receipts
and falsifiable forward predictions, in [VALIDATION.md](VALIDATION.md). The numeric
tolerance of ±30% is generous. The temporal and trap blocks are small (four and two
questions), so their percentages carry wide error bars.

## 9. Reproducibility

```
cd backend
python -m app.benchmark.generate_v1        # regenerate questions from the live snapshot
python -m app.benchmark.run                # bare condition, all configured providers
python -m app.benchmark.run --grounded     # Canary condition
python -m app.benchmark.judge              # verdicts + summary table
```

Artifacts: `data/processed/benchmark_v1.json` holds the questions and receipts,
frozen at `064dc90`; `data/processed/benchmark_runs_v1/` holds every raw answer and
every judged verdict, stamped with the pipeline git version and source snapshot date.
The intended cadence is monthly, regenerated with the data, so the questions track
the live record instead of fossilizing.

## 10. Next

Add Gemini. Run stability replicates. Publish the human audit of judge verdicts.
Extend to a second metro. Ship this as a recurring, versioned report so the numbers
stay accountable over time.

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
