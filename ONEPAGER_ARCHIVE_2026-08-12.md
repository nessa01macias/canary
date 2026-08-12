# Canary, on one page

**The change layer of the physical world.** Internal. Never ships to the site.
Aligned with CONTEXT.md v5.1 and OUTREACH.md v2 (buyer filter, 2026-07-31).

## The idea

Everything you can look up about a place describes what it is like now. Crime
rates, prices, walk scores. But nobody moves into the present. A lease is three
years, a mortgage is thirty, a store's trade area is a decade. The decision is
about the future and every available input describes the past.

Cities publish the raw material and nobody reads it: every permit, business
registration and closure, police report, noise complaint, eviction notice.
Millions of dated rows. Canary computes from them how an area is changing, per
dimension, with a citation on every number, plus a forward layer of construction
already approved nearby. We report records that exist. We never predict and we
never label a neighborhood good or bad.

**Why the seat is empty.** It used to cost roughly $70M and 150 people, which is
what Localize.city spent before dying with depth in one metro. And everyone
adjacent earns money when a home sells, so none of them can afford to say a street
is declining. Zillow added climate risk scores and removed them when agents
complained. The truth-teller seat keeps being vacated, not undiscovered.

**Why now.** Base data went free (Overture, Foursquare's open POI corpus), reading
messy municipal documents went from analyst-hours to fractions of a cent, and the
regulatory posture just moved: HUD's April 2026 letter says sharing crime and
school information consistently is not steering, and NAR's own guidance tells
agents to hand clients "third-party sources with neighborhood-specific
information." That sentence is our product described in their words.

## What exists today

- **Data engine**, 31 open sources as dated, hashed, immutable snapshots, roughly
  18 GB. Permits back to 1901, business registry to 1849.
- **Live product** at canarylayer.com: SF map, per-address report, agent-readable
  API.
- **A published benchmark.** Five frontier models, 136 checkable SF questions,
  every answer independently re-derived from the city's own APIs before any model
  ran. Unassisted 25 to 47 percent. With one Canary response, 95 to 99.

The benchmark is a **credibility artifact, not a sales lane.** What it proves is
that this layer does not exist anywhere: those aggregates were never published, so
no model can recall or retrieve them, and no future model release fixes it. That
is the opener for any audience. It is not evidence that anyone will pay.

## Who pays

Our filter: a customer is someone for whom the **absence** of this data creates a
cost on **their** P&L, who has budget, and for whom we are the cheapest fix.
Reachability is applied after need, never instead of it.

| Lane | The bleed | Evidence |
|---|---|---|
| **1. Regional MLSs** | Member churn after the NAR settlement. Agents are told to answer "is this area good" with third-party sources and have none. | Budget line proven in public: seven Local Logic NeighborhoodIntel deals, including Stellar MLS at 84k members. Reachable executives. **Our conversion untested. This is the live test.** |
| **2. Asset pricers** (iBuyers, AVM vendors, SFR funds) | Mispriced homes, in basis points. The only segment with a direct P&L line to our signal. | Opendoor lost $1.3B in 2025, after Zillow's $881M iBuying exit. Gated on our FHFA lead-lag backtest, which runs locally at zero cost. |
| **3. Insurers** | Loss ratio, and cited records fit their explainability requirements. | Real, but DOI-regulated multi-year cycles through aggregators. Parked, never the wedge. |

**Not customers, and this is a finding rather than a gap.** AI apps, portal
assistants and labs. We closed that lane analytically on 2026-07-31 before
spending a month emailing into it. Wrong area answers cost them nothing: OpenAI
loses no users over a wrong Bernal Heights answer, and rental-app revenue is leads
to landlords, so a deflected neighborhood question costs nothing. The portals
removed crime data deliberately by 2022 and their assistants answer the safe half
of neighborhood research while deflecting the charged half. And the category has
zero confirmed payers anywhere: VOYGR was built to sell place data to AI apps and
earns its money from logistics, retail, adtech and banks.

**Never a payer:** agents are a distribution channel, and commission revenue is
structurally incompatible with telling someone their street is declining.

## What we have to prove

| # | Claim | Status |
|---|---|---|
| 1 | The signal computes from open public data | **Proven for SF.** Unmeasured for city two. |
| 2 | AI products are wrong about areas | **Proven.** 136 questions, five models, four vendors. |
| 3 | AI product teams notice and care | **Resolved negative.** No cost to notice, so no one does. Lane closed. |
| 4 | **MLSs will pay us**, given the budget line already exists | **The live test.** Untested. |
| 5 | Our history predicts price moves well enough for pricers | **Untested**, and cheap: the data is on disk. |
| 6 | It generalizes past one city | **Unmeasured.** |
| 7 | Movers will contribute local knowledge to unlock | **Untested.** |

Claim 4 is the business right now. Everything above it is either done or answered,
and everything below it is cheap.

**What would make us stop:** a run of MLS conversations where people agree the
problem is real and cannot name anyone who would pay for it. That is the Pharos
failure mode and we treat agreement without a line item as a no.
