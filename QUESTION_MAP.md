# THE QUESTION MAP — mission × altitude → what the user is actually asking

This is the design spec that everything renders from: the cards' lead order, the
mission-voiced sentences, the follow-up suggestions, the semantic-zoom layers.
Rule of thumb: **altitude = question = decision stage.** City = comparing,
neighborhood = evaluating, street = verifying, parcel = committing.

The organizing insight is TENSE. A renter buys 1–3 years (now). A buyer buys 10
(the forward layer + fixed risks). A business buys a trade area's momentum
(velocity). Same engine, three tenses — the thesis line as UX: NOW is the
product, HISTORY is the moat, FORWARD is the differentiator.

Legend: ✓ live today · ~ computable / pending source · ✗ honest gap (→ what catches it)

---

## 🔑 BUYER — horizon 10 years · tense: the future
Forum-ranked fears: construction next door (#1, HIGH/HIGH), overpaying into a
declining area, risk exposure.

### City — "where should I even look?"
- Which areas are rising vs declining? ✓ trajectory choropleth
- Where is new housing being approved (supply pressure / character change)? ✓ units approved
- Where are schools strong? ✓ CAASPP
- Where is flood / fire risk low? ✓ FEMA / FHSZ
- What can I afford where? ✗ no price data (no deeds/FHFA) — NEVER fake it; say so. Honesty is the brand.

### Neighborhood — "what is this place becoming?"
- Is the "up-and-coming" story real, or realtor spin? ✓ cited trajectory receipts
- Is it densifying — will the character change under me? ✓ units approved trend
- Getting safer, or just more policed? ✓ victim-reported vs incidents (our unique distinction)
- Eviction pressure / housing stability? ✓ filings trend
- Who lives here? ⚠️ answered ONLY as: political lean ✓ · age mix ~ (Census key) ·
  renters vs owners ~ (Census key) · what residents themselves say ✓.
  NEVER race / ethnicity / income — design constraint #2 + blockbusting rule (24 CFR 100.85).
  The question map encodes the line so no future session re-litigates it.

### Street — "is this block right?"
- Is this block loud? ✓ 311 noise on the H3 hex
- Could something tall go up next to me? ✓ zoning + filed permits
- Trees / shade? ✓ street-tree inventory
- Parking situation? ✓ permit-parking parcels

### Parcel — "what will hit THIS address?"
- What's approved to be built within 500 m? ✓ THE HERO (fear #1)
- Flood zone / fire zone? ✓
- EMS response time? ✓
- Assigned school? ~ (attendance boundaries)
- Are neighbors renovating (investment signal)? ✓ permit history

---

## 🏠 RENTER / MOVER — horizon 1–3 years · tense: right now

### City
- Quiet + stable + safe, inside my commute? ✓ chips (Quiet, Low crime, Housing stability, Short commute)
- Which areas are improving fastest — arrive before the price does? ✓ trajectory

### Neighborhood
- Better or worse RIGHT NOW? ✓ trend directions
- Are people like me moving in or out? ✓ resident reviews with in/out flag — NOBODY else has this
- Eviction pressure (how landlords behave here)? ✓ filings trend
- Is stuff opening or closing around me? ✓ business velocity

### Street
- Loud at night? ✓ 311 noise by hex
- Can I walk to groceries / BART in 5 min? ✓ GTFS + Overture POI
- Clean? ✓ 311 street-cleaning requests

### Parcel
- Will there be construction next door for my entire lease? ✓ permits + filing dates
- Is this landlord evicting people? ✗ at the individual building — people-reports
  never pin to a door (see rendering rule below) → the RESIDENT LAYER's job

---

## ☕ BUSINESS OWNER — committing capital ~5 years · tense: momentum

### City
- Where are openings accelerating? ✓ business velocity
- Where is vacancy high — cheap space or dying strip? ✓ Prop-D vacancy roll
  ("THE DOUBLE READ": same fact, opposite meaning per mission — see consequences)

### Neighborhood
- Openings vs closings IN MY CATEGORY? ✓ NAICS on registered businesses
- Vacancy filling or emptying? ✓ trend
- Nightlife trajectory? ✓ liquor / cannabis license activity
- Future customers coming? ✓ units approved

### Street
- Empty storefronts on this strip? ✓
- What survived here, what died? ✓ registry (churn on this block)
- Foot-traffic proxies — transit stop, anchors? ✓ GTFS + POI
- Road works planned? ✓ transport projects (construction kills retail during works)

### Parcel
- What was this space before? ✓ registry + permit history
- Does zoning allow my use? ✓
- Scaffolding next door coming? ✓ filed permits

---

## 🧭 EXPLORER — no stakes · tense: the story

- City: what's the fastest-changing part of SF? ✓
- Neighborhood: what's the story here; what do residents say? ✓
- Street: what's that crane? ✓ the record behind it
- Parcel: this building's biography — permits back to 1901 ✓ (a magical dead-end)

---

## CONSEQUENCES (what this matrix determines in the product)

1. **Card lead-order is determined, not designed.** At each rung, per mission, the
   first evidence line = that cell's top question. No per-card debates.
2. **Same fact, different sentence.** High vacancy = caution (buyer) / opening
   (business owner). Mission-voice is a RENDERING of one grounded fact; the
   number never changes. Model arranges, data is fixed.
3. **Follow-ups pull DOWN the ladder.** At the neighborhood rung, suggest that
   mission's street-level questions ("is Judah St loud at night?"). Every answer
   baits the next altitude — the journey gets gravity.
4. **The gaps are assignments, not embarrassments.**
   - Prices → never fake; say "we don't do prices" (the honesty policy is the brand)
   - Landlord / neighbors / HOA → zero computability + highest demand = exactly
     why the resident layer exists; the give-to-get gate should sit on THESE questions
   - Age mix / renters-vs-owners → Census key backlog
5. **Rendering rule (the graveyard line):** facts about BUILDINGS decompose into
   map pins (permits, openings, closings). Reports about PEOPLE stay aggregates
   forever (crime, evictions, 311) — trends at area level, never dots on doors.
   Trulia crime maps + SketchFactor died on the wrong side of this line.
6. **One encoding owns the map per altitude.** Chips/mission choose WHICH metric
   drives it; altitude chooses WHAT KIND it is (ranked areas → one area's hex
   texture → event dots → one record).
