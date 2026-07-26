# Do AI assistants know how neighborhoods are changing?
### An area-level ground-truth benchmark with a grounding ablation — v1 pilot, San Francisco

**Melany Macías · Katerina Tchilinguirov — Canary**
*Working note v1 (pilot) · July 26, 2026 · San Francisco*

---

## Abstract

People increasingly ask AI assistants where to live. We tested five frontier models —
**Claude Fable 5, GPT-5.6 Sol, GPT-5-search (native web search), Perplexity sonar-pro,
and Grok 4.5** — on 43 checkable, area-level questions about San Francisco: is crime
rising here, which neighborhood is gaining businesses fastest, how much housing was
just approved within 500 meters of this address. Every ground truth is computed from
public records and carries a citation; the question set was frozen at a git commit
before any model was queried. Bare, the newest models score **36-45%** — and unlike
the previous generation, they rarely refuse: their failure mode is **confident error**
(Grok 4.5: confidently wrong on 25 of 43 answers; GPT-5.6 Sol: 23). On "which
neighborhood changed most" questions, the five models went **0 for 25**. With **one
Canary API response** prepended, accuracy rose to **93-100%** (two models scored a
perfect 43/43). The gap is not model capability — capability visibly improved — and
not web freshness: it is that area-level answers had never been computed and published
anywhere, so no amount of intelligence or retrieval can recover them.

## Lay summary

**We asked the five newest AI models 43 checkable questions about San Francisco
neighborhoods** — the kind anyone deciding where to live asks: *Is crime getting
better here? Where are new businesses opening fastest? How much housing was just
approved near this address?* Every question has a verifiable answer in the city's
public records.

**Without help, they failed — confidently.**
- The newest models almost never refuse anymore. They answer everything — and are
  **confidently wrong about half the time** (up to 25 of 43 answers, without a
  single hedge).
- Asked which neighborhood rose the most (in openings, permits, evictions), the five
  best models on earth went **0 for 25**.
- Asked to simply count things — housing units approved, active businesses — they
  scored **0%**.

**Why they fail:** these answers aren't stale on the web — they were **never on the
web at all**. No one had ever computed them from the millions of raw records the city
publishes. A smarter model can't retrieve a sentence nobody has written; between
generations, the models got more fluent — about the same missing facts.

**Then we gave the same models one response from Canary's data.** Three of them
scored **perfectly**; the other two 93-95%. Same models, same questions — the only thing that
changed was the data. The AIs were never the problem; the missing layer was.

*(Pilot scale: one city, 43 questions, one run per condition — full method, numbers,
and limitations below.)*

> **The accuracy gap is not a prompt-engineering problem — and for neighborhoods, it
> isn't even a freshness problem. It's an aggregation problem: the answers aren't stale
> on the web, they don't exist on the web.**

## 1. Motivation

Prior evidence covers the *place* level: VOYGR's Quarterly LLM Benchmarking Study
(345 prompts — restaurants, hours, bookings) found models recommend closed or
fabricated venues. The "Silicon Gaze" audit (20M queries) found LLM neighborhood
*rankings* mirror social divides. But no benchmark existed for the **area level** —
neighborhood *trajectory* (direction of change) and the *forward layer* (what is
approved to be built). Notably, VOYGR's 345 local prompts contain zero area-change
questions: the category was unmeasured, in line with it being unserved. Our v0 pilot
(46 questions, previous-generation models) found 0-39% bare accuracy dominated by
refusals; v1 tests whether the newest frontier closes the gap. It does not — it
changes the failure mode.

## 2. Ground truth

Ground truths are computed by the Canary pipeline from municipal public records
(building permits, the business registry, police incident reports, eviction notices,
311 cases; DataSF snapshots, as-of date stamped on every row), aggregated on an H3
hex spine and rolled to the city's analysis neighborhoods. Three properties matter
for benchmark validity:

1. **Bitemporal provenance** — every row carries the source's own freshness date and
   our fetch date; every answer is reproducible against a stated snapshot.
2. **Receipts** — every expected answer traces to underlying records (permit numbers,
   registry entries), not to a black-box score.
3. **Measurement discipline** — the record misleads in known ways, corrected *before*
   any model was tested: police incidents split into victim-reported vs
   enforcement-driven; a 311 app-flow artifact that inflated "noise complaints" 62%
   detected and excluded; registry close-date lag documented. See
   [VALIDATION.md](VALIDATION.md), including a case where the receipts corrected our
   own narrative attribution.

## 3. Question design

**43 questions in 7 blocks, generated from the database and frozen at git commit
`064dc90` before any model was queried** (pre-registration style; quality floors
trimmed the initial 50 — two addresses had too little nearby construction to ask
about honestly, two pairwise gaps were too narrow):

- **15 direction** — "is X rising or falling in {neighborhood}?" across victim-reported
  crime, business openings, evictions, encampment reports, housing approvals
- **5 superlatives** — "which neighborhood had the biggest increase in X?"
- **8 numeric** — counts with ±30% tolerance (units approved; active businesses)
- **6 pairwise comparisons** — "which of A or B rose more?" (two aggregations, never published)
- **3 address-level forward layer** — "units approved within ~500m of {address}?"
- **4 temporal windows** — changes between year-ending-June-2024 and year-ending-June-2025
  (inside training windows — a control for "the gap is the present")
- **2 mechanism traps** — the Tenderloin enforcement-vs-victimization split; the 311
  noise artifact ("did the city really get 60% louder?")

## 4. Protocol

Two conditions, identical questions: **bare** (the model alone; system prompt demands
a committed answer) and **Canary ON** (one simulated Canary API response prepended:
the data slice a single call would return, **with field documentation** — metric
definitions ship with every real response). Address-level payloads include the ring
aggregate plus the top permits, matching `/api/report` (v1.0.1 protocol note: the
initial payload omitted the aggregate; models correctly summed the partial list they
were given — a payload bug, fixed and re-run, disclosed here). Provider-default
temperature throughout (consumer defaults; several frontier APIs now reject custom
temperatures). One run per condition (pilot; stability replicates planned for v1.1).
Cost of the full study: ≈ $25.

Models (exact IDs): `claude-fable-5`, `gpt-5.6-sol`, `gpt-5-search-api`,
`sonar-pro`, `grok-4.5`. Gemini pending account access.

## 5. Judging

An LLM judge — **`claude-sonnet-5`, pinned, not in the test lineup** — receives the
question, the pre-verified ground truth with its receipt, and the model's answer, and
classifies only whether the answer *commits* to the recorded truth: `correct` /
`wrong` / `nonanswer`, plus a `confident_wrong` flag when a wrong answer shows no
hedging (a confident wrong answer is worse than none: the user doesn't get nothing,
they get misled). All verdicts with rationales are stored for audit
(`benchmark_runs_v1/*.judged.json`); a stratified human audit sample is part of the
protocol (judge-agreement rate published as the judge's error bar). Family caveat:
the judge shares a vendor with one tested model; the fixed-evidence design and the
human audit are the mitigations.

## 6. Results

| Model (bare → with one Canary response) | Bare | Canary ON | Confidently wrong, bare |
|---|---|---|---|
| claude-fable-5 | 43% | **100%** (43/43) | 17 of 43 |
| grok-4.5 | 42% | **100%** (43/43) | **25 of 43** |
| gpt-5.6-sol | 42% | **100%** (41/41)¹ | 23 of 43 |
| gpt-5-search-api | 36% (13 refusals) | **95%** | 11 of 43 |
| perplexity sonar-pro (live search) | 45% | **93%** | 21 of 43 |

¹ Two of Sol's 43 ON verdicts failed to parse in judging and are excluded (disclosed
rather than assumed correct); all 41 judged answers were correct.

**By question block (bare, pooled across five models → Canary ON):**

| Block | Bare | Canary ON |
|---|---|---|
| Superlatives ("which neighborhood rose most") | **0%** | 91% |
| Numeric counts | **0%** | 100% |
| Pairwise ("A or B?") | 64% (coin-flip floor: 50%) | 93% |
| Direction (rising/falling) | 55% | 100% |
| Address-level forward layer | 13% | 93% |
| Temporal (2024→2025, in training window) | 95% | 100% |
| Mechanism traps | 100% | 100% |

**Reading the table:**
1. **The frontier didn't close the gap — it changed the failure mode.** v0's
   previous-generation models refused; v1's newest models answer everything and are
   confidently wrong on ~half. Capability rose; the missing facts stayed missing.
2. **Zero out of twenty-five on superlatives** — five different frontier stacks,
   including two with live web search, each named a wrong neighborhood, almost always
   confidently. Aggregations nobody published cannot be retrieved.
3. **The controls behaved:** models score well *inside* their training window
   (temporal: 95%) and pass the skepticism trap (100%) — the benchmark isn't rigged
   against them; the failure is specifically *the present state of the world*.
4. **Grounded, three models were perfect.** Including the traps and the
   fixed-payload address questions. When the data exists and carries its meaning,
   frontier models use it almost flawlessly — the bottleneck is the data, full stop.

## 7. Conclusions

1. **Area-level change is a distinct, unmeasured, near-total failure class** for
   current AI assistants — not staleness (search models fail too), not capability
   (the newest generation fails more confidently than the last): the answers were
   never computed and published, so they cannot be learned or retrieved.
2. **Model progress makes the problem worse for users, not better.** The
   refusal-to-confident-error shift means a mover asking today's best AI gets a
   fluent, specific, wrong answer where last year they got a shrug.
3. **Identical wrong answers across independent stacks imply a shared cause** —
   training-distribution discourse priors — and the ablation confirms the cure is
   data, not scale: same models, +one API response, 36-45% → 93-100%.
4. **Semantics are load-bearing.** Payloads without field documentation (or with
   truncated aggregates — our own v1.0.1 bug) produce confident misreadings; the
   product is numbers with meaning attached, machine-readable.
5. **The measurement discipline is the defensible layer.** The ground truth required
   documented corrections before it could grade anyone; raw open-data resellers
   inherit exactly the errors the models made.
6. **What this establishes and what it doesn't:** the failure is demonstrated on our
   dimensions at pilot scale; whether AI products adopt external grounding for area
   questions is a market question this study doesn't answer.

## 8. Limitations

One metro, one run per condition, 43 questions, five models (Gemini pending). The
judge is an LLM (audited files; human verdict-sample check owed, judge shares a
vendor with one tested model). The grounded condition uses Canary data as both
context and ground truth — deliberately: it tests whether models retrieve and commit
to supplied area data; the data's own validity is addressed separately with receipts
and falsifiable forward predictions in [VALIDATION.md](VALIDATION.md). Numeric tolerance ±30% is generous.
Temporal n=4 and trap n=2 are small.

## 9. Reproducibility

```
cd backend
python -m app.benchmark.generate_v1        # regenerate from the live snapshot
python -m app.benchmark.run                # bare, all configured providers
python -m app.benchmark.run --grounded     # the ON condition
python -m app.benchmark.judge              # verdicts + summary table
```
Artifacts: `data/processed/benchmark_v1.json` (questions + receipts, frozen at
`064dc90`), `data/processed/benchmark_runs_v1/` (raw answers + judged verdicts),
each stamped with pipeline git version and source snapshot date. Intended cadence:
regenerated monthly with the data, so questions track the live record.

## 10. Next

Add Gemini · stability replicates (n=2) · human
audit of judge verdicts · second metro · publish as a recurring, versioned report so
the numbers stay accountable over time.

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
