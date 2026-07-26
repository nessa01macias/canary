# Does our own signal match reality? Trajectory validation, San Francisco

*First pass, July 2026*

**What this is.** Before grading anyone else's answers (see RESEARCH.md), we validated
our own. Is neighborhood trajectory computable from open data, and does it match
ground truth? We took seven neighborhoods with well-documented arcs over 2020-2026
and checked them against the pipeline's per-dimension trajectory, meaning the trailing
twelve months compared to the twelve before, standardized against all San Francisco
neighborhoods.

**How we kept ourselves honest.** Every claim here has two layers: the computed
signal from our database, and the receipt, which means the underlying records
themselves: permit numbers, business names, category breakdowns. A signal without a
receipt is not cited. Where a row mentions an external narrative, such as a
redevelopment program or a retail decline, that narrative was widely reported at the
time and is labeled as context, distinct from the record.

**Reproduce:** `cd backend && make pipeline`, then the queries in
`app/pipeline/trajectory.py`.

---

## Case results

| Neighborhood | Dimension | Computed | Receipt (our data) | External narrative | Verdict |
|---|---|---|---|---|---|
| Treasure Island | permits issued | +38%, z+1.0 | $79.4M six-story, 150-unit residential building (issued 2026-07-01); $40M fully affordable 100-unit building (2026-01-05); $31M new construction; 20,000 cubic yards of grading | Multi-phase island redevelopment, roughly 8,000 homes planned | **CONFIRMED** |
| Lakeshore | permits issued | +156%, z+4.9 | Top permits are a $6.5M golf maintenance building, a $5M gatehouse, and a $1M parking expansion. Zero housing units. | We initially attributed this to the Stonestown redevelopment (about 3,500 homes). That was wrong; those permits are not in the issued record yet | **CORRECTED**. The capex surge is real, but our first narrative attribution was false, and the receipts caught it |
| Tenderloin | crime incidents | +11%, z+2.5, against a citywide decline of 8% | Breaking the number apart: drug offenses rose from 1,790 to 2,824 (+58%), warrants +35%, while assault stayed flat (1,109 to 1,134) | The 2025-26 drug market enforcement crackdowns | **CONSISTENT**, but the correct claim is that enforcement surged, not that crime surged |
| Mission | business openings | −19%, z−1.3 | Named closures on record across retail, salons, and labs (for example Beli SF and Boutique Salud Y Vida) | The widely covered Valencia Street retail churn | **CONSISTENT** |
| Financial District / South Beach | net business churn | +235 net, the city's highest | 1,666 openings against 1,431 closings | The downtown recovery push and return to office | **CONSISTENT** |
| Bayview Hunters Point | permits and business churn | permits −21.6%; net business churn −18, the city's lowest | (aggregate counts) | Long-documented underinvestment pressure | **CONSISTENT** |
| Japantown | business openings | +38%, z+2.9 | The openings are mostly mental health practices, physicians, and restaurants | No documented story found anywhere | **LEAD**: the model surfaced something nobody has written up, which is exactly the product |

**Scorecard: one confirmed with hard receipts, four consistent, one corrected, one lead.**

## The two most important findings are the two failures

**The Lakeshore correction.** The magnitude signal (+156%, z+4.9) was real, but the
obvious story we attached to it was wrong. The spending turned out to be golf course
capital works, not the famous mall redevelopment. Two lessons are now baked into the
design. First, never ship a standardized score without its underlying records; the
receipt discipline is what separates measurement from vibes. Second, the
per-dimension design already contained the tell, because net housing units for
Lakeshore sat at roughly zero. A single composite "improving!" score would have
laundered the error.

**The Tenderloin mechanism, now resolved in the pipeline.** Police incident data
measures police activity in proactive categories such as drugs and warrants, and
measures victim reports in categories such as assault and burglary. Our category
mapping (`app/pipeline/crime_categories.py`) splits the metric, and the split inverts
the headline: victim-reported crime in the Tenderloin fell 8.0% while enforcement
activity rose 43.6% (citywide, the same split reads −18.7% against +29.7%). A product
reporting "Tenderloin crime up 11%" would have been wrong in the direction that
matters to a resident. This is precisely the kind of error AI assistants make when
answering from general impressions, and it became one of the benchmark's designed
questions; see RESEARCH.md. User-facing crime trends in Canary use the
victim-reported series only.

## Known limitations of this pass

- **Business closure lag.** Registry close dates trail reality, so recent closing
  counts undercount. Opening dates are timely.
- **The 311 noise correction.** After this validation ran, we loaded 8.79 million 311
  cases going back to 2008. The headline noise trend (+61.9%) failed its own
  propensity check: the jump is a hard step-change in March 2026, concentrated in a
  single catch-all category (+145%) and in the mobile app channel (+139%, against
  +15% by phone). That is a reporting-flow change, not louder streets. The refined
  metric that excludes the catch-all rose 25.9%, which is elevated but honest. This
  is the third instance of the same lesson: report-based metrics measure reporting,
  and every one of them needs a propensity check before a trend ships.
- **Single snapshot.** Revision history accumulates from here; the as-of discipline
  is in place.
- **Neighborhood grain.** Thirty-seven areas is coarse. Hex-level trajectories exist
  in the database but need per-hex volume gates before they are claim-worthy.
- The police dataset begins in 2018 after a schema break, and we have not stitched
  the earlier years.

## What would settle it further

1. **Forward predictions, written down now** and checkable around January 2027:
   Treasure Island stays top-three citywide in net housing units approved as the
   build-out continues. Stonestown-driven residential permits appear in Lakeshore's
   issued record within twelve months. If the Tenderloin operation winds down, drug
   offense counts fall back toward baseline while assault stays flat, which would
   distinguish an enforcement pulse from underlying change.
2. **A price cross-check.** Regress our 2023-24 trajectory dimensions against
   2024-26 FHFA tract-level house price movements, leakage-free thanks to the as-of
   stamps.
3. **The AI benchmark.** Done: these receipts became its ground-truth questions, and
   the results are in RESEARCH.md.

---
*Generated July 2026 from the 2026-07-24 pipeline snapshot. Per-dimension only, with
no composite neighborhood scores, by design constraint: facts with citations, never
quality labels.*
