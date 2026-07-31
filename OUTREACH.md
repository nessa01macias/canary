# H3/H4 outreach kit (internal — never ship to the site)

**What this tests** (CONTEXT.md ledger): H3 = do AI product teams *notice/care* that
their area answers are wrong; H4 = would they pay externally rather than build/ignore.
Stories or silence — both are answers. This is discovery, not sales: email #1 asks
about THEIR experience and offers the report; the API comes up only if they bite.

## Who (in order of expected reply rate)

1. **Small real-estate/rental AI startups** (seed-stage assistants, "AI agent for
   renters/buyers" products) — founders answer email, and a wrong "is this area
   safe?" answer is existential for them.
2. **Ex-Localize.city / LocalizeOS people** (CONTEXT priority interviews) — they
   built exactly this a decade early; they'll have incident stories nobody else has.
3. **Portal AI teams** (Homes.com "Homes AI", Zillow AI search, Redfin) — slow, but
   one reply is worth ten startup replies. Find PMs, not execs.
4. **Answer engines** (Perplexity local/search team) — they benchmark themselves;
   ours shows a category they lose. Frame as research, not pitch.

## Email #1 (send as-is, ~90 seconds to read)

> **Subject:** we asked 5 frontier models 136 checkable SF neighborhood questions — they averaged a third
>
> Hi {name} — we test AI assistants on checkable neighborhood questions (the "should
> I move here?" class), graded against city records that we re-derived from the
> city's own APIs before any model ran. Three findings from the latest run:
> the five newest models scored 25-47% unassisted, and rarely hedge (one was
> confidently wrong on two of every three questions); the model with live web search
> scored the *lowest* of the five, at 25%, because the answers were never published
> anywhere for it to find; and when they guess, they guess famous — the Tenderloin,
> the Mission and SoMa account for about two thirds of the wrong ranking answers,
> while the real answers were places like Japantown and Lakeshore.
>
> Full method + numbers: {link to canarylayer.com → Documentation → Research}
>
> Curious about your side of this: what does {their product} answer today when a
> user asks "is this a good area?" — and has a wrong area answer ever come back to
> you as a complaint or escalation? Happy to share the question set if useful.
>
> — Katerina, Canary

**Rules:** no API mention in email #1 · one link only · the question at the end is
the whole point (H3 = their stories, not our pitch).

## Follow-up (if any reply)

Offer to run the benchmark against THEIR assistant and send a private scorecard.
(`python -m app.benchmark.run` with their endpoint or manual paste, then `judge`.
The scorecard is the wedge — nobody declines a free audit of themselves. Not zero
cost, though: their answers may be free if they paste them, but judging still
costs API calls, so agree the scope before promising a turnaround.) If they ask "can we get the data": that's H4 — log it, send the
ForAgents page, get on a call.

## Log every response in this table (the ledger needs receipts)

| Who | Sent | Reply? | H3 signal (story of a wrong-answer incident?) | H4 signal (asked about access/pricing?) |
|---|---|---|---|---|

**Read after ~30 sends:** several incident stories → H3 real. Access/pricing asks →
H4 live, book calls. Mostly silence → the derivative fire is cold; that's a real
answer too, and it re-ranks the buyer list before we spend months on this lane.
