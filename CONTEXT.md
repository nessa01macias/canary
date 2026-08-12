# Canary — Context

_Last updated: 2026-08-12. Living doc. Reflects current thinking, not final decisions._

**Superseded doc:** the prior CONTEXT.md (v5, 2026-07-25 through the MLS/"change
layer of the physical world" pivot of 2026-07-31 — ABOUT.md, ONEPAGER.md,
TRIAL_BRIEF.md, OUTREACH.md all reflect that version) is preserved for the
record at [CONTEXT_ARCHIVE_2026-08-12.md](CONTEXT_ARCHIVE_2026-08-12.md). This
file is the current strategic canon; other docs referencing the old thesis
have not been rewritten yet and should be treated as stale until updated.

## One-liner
Jurisdiction-research API for AEC pursuit teams. We aggregate the scattered public record — planning acts, zoning, permits, nearby approvals, submittal requirements — into one cited API/MCP that plugs into the tools teams already use (Claude, Copilot, ArcGIS). Weeks of pre-bid research become one call.

## The problem we solve
Firms like AECOM spend 2–3 months (3+ senior staff; up to 6–12 months on $1B+ pursuits) researching a jurisdiction and site before they can respond to a public RFP. The data is public but brutally fragmented — across municipal sites, planning acts, zoning by-laws, PDFs, submittal registers, and phone calls to the city. This research phase sits in a tooling gap: discovery tools (GovWin, Dodge) stop at "an opportunity exists," and proposal tools (Loopio, AutogenAI, Joist) start at "draft the document." Nobody serves the research in between.

We compress the **gathering** of the public record from weeks to days. We do NOT claim to replace the genuinely private tier (evaluator preferences, incumbent relationships, the pre-RFP whisper network, confidential clauses) — and being honest about that boundary is part of how we earn trust with insiders.

## Who it's for (ICP)
Primary: large AEC consultancies / consortium delivery partners responding to public infrastructure/transit/city-development RFPs — AECOM, Jacobs, WSP, Stantec, Arup, Bechtel, Turner & Townsend, Mott MacDonald.

Testing in parallel: mid-size regional engineering + environmental consultancies (they bid constantly, feel the pain, and can say yes without a 6-month procurement cycle — fastest path to a paying pilot).

Segment insight: the sharpest pain is in **proposal/qualifications-based** procurement (City of Calgary RFPs, consulting services, environmental work), NOT low-bid tenders (Alberta highway paving, where pre-bid work is estimating, not research). Environmental/regulatory consultancies are a notably strong fit — their deliverable literally *is* cited jurisdiction research.

## Delivery model
API-first + MCP server. No interface of our own — we're the data/intelligence layer that feeds the AI tools these firms already run (Claude, Copilot), and integrates with their stack (Deltek Vantagepoint, ArcGIS, Flowcase). Drafting/writing is deliberately out of scope: with an MCP, the model on the other end drafts natively, and the drafting space is crowded. We want to be the thing every writer calls, not the writer.

Ship a plain REST API alongside the MCP — enterprise IT procures the familiar thing more easily.

## The wedge & moat
- **Wedge:** win one jurisdiction end-to-end (Toronto/Ontario first — high RFP volume, warm access, tractable data) before going broad. Depth beats breadth early because accuracy + citations are the differentiator.
- **Moat, staged:** (1) scraped/structured public data = table stakes, not defensible alone; (2) cited-accuracy quality bar + guaranteed coverage + QA; (3) eventually the phone-call/non-scrapable tier, collected analyst-style + AI-structured. The scraped layer is entry; durability is in the tiers general AI can't reach.
- **Key differentiator to protect:** every answer traces to exact code section, version date, source URL. This is the wedge against "just use ChatGPT" (users report ~85% accuracy prompting general AI themselves, with no provenance).

## Competitive landscape (short)
- **Discovery:** GovWin IQ, Stotles, Dodge, Glenigan — tell you an opportunity exists, nothing about the site.
- **Proposal drafting:** Responsive, Loopio, AutogenAI, GovDash, Joist, Flowcase — work from your own content, don't gather external jurisdiction data.
- **Zoning/parcel/permit data:** Regrid, Zoneomics, Shovels, Gridics — real-estate/developer ICP; potential *suppliers* to us, not competitors.
- **Closest analogs:** Searchland (UK — cited planning constraints via API + MCP, but UK + developer ICP); UpCodes (AEC-native, cited, high-accuracy, but building codes not zoning bundle); torontozoning.com (near-exact micro-product for our beachhead city — proof of demand + a warning).
- **Biggest threats:** general AI + MCP gateways (Pipeworx) commoditizing public-data access; Deltek (owns the pursuit workflow + ICP relationship); UpCodes extending into zoning.
- **Nobody today combines:** the full bundle + cited answers + API/MCP + AEC-pursuit ICP. That's the gap.

## Substitute economics (pricing anchors)
Manual today: standardized zoning reports ~$550–$800/site; comprehensive due-diligence $3,000–$15,000; feasibility studies $150K–$1M (a larger job we feed, not replace). Suggested pricing: per-pursuit (~$2K–$8K), anchored to the value of the pursuit and the senior-time it replaces — not per-API-call (avoids competing with Regrid/Pipeworx on price).

## Traction / motion
- In conversation with AECOM about improving RFP response time with pursuit teams (warm; via strategist contact).
- Outreach underway to Ontario + Alberta consultancies/contractors sourced from live public postings (e.g., Calgary Green Line "Bow River Package" interested-suppliers list).
- Message templates: builder pitch for enterprise Proposal Managers; grad-student/discovery framing for mid-size firms (higher reply rate, and we still need workflow-baseline data more than early sales).
- Target roles: Proposal Manager / Bid Manager / Pursuit or Capture Lead (users); BD / Growth / Marketing Manager / Principal (champions + budget at mid-size); Digital/Innovation Lead (pilot-enabler + build-vs-buy intel).

## Open questions / risks
- **Disintermediation:** if frontier models + web search get accurate enough on messy municipal sites, the value shifts from *finding* data to the non-scrapable tier + integration. Design for that world; start collecting the phone-call tier early.
- **Build-vs-buy:** the giants can build internally (AECOM bought Consigli; WSP bid for Jacobs). Defense = long-tail coverage + QA + integration; be the supplier, not the rebuild target.
- **Don't over-fit to AECOM:** run parallel discovery with WSP/Stantec/mid-size firms so we build a market product, not AECOM's internal tool.

## THE FORK TO RESOLVE (important)
There are two theses in play, and the landing page recently blurred them.
- **Thesis A** (validated by all outreach + interviews): **AEC pursuit-research API** — output is a jurisdiction/pursuit answer (zoning, nearby approvals, submittal requirements).
- **Thesis B** (the original hackathon consumer map): **neighborhood-trajectory product** — output is "is this area rising" signals (biz openings, evictions, 311, approvals) for homebuyers/investors.

These share a data engine but are different companies (different buyers, GTM, metrics). The landing page must prove ONE. Current recommendation: lead with Thesis A (proven willingness to pay, warm ICP access); keep Thesis B as a possible phase-2 consumer flywheel that feeds the non-scrapable data tier — not a parallel bet. Every landing-page payload should render a jurisdiction answer, not a trajectory score, until this is deliberately reversed.

## Landing page (current build)
Follow Ramp + Finch aesthetic: black on off-white, one accent, oversized headlines, heavy whitespace, no filler. Core visual is the Ramp-style before→after: scattered municipal sources fan into one cited API node (Finch-style fan-in). Sections: hero → before/after resolve → integrations logo rail (Claude/Copilot/ArcGIS) → three value blocks (Cited always / Public record structured / Built for pursuits) → close. Keep the fan-in output a jurisdiction answer (Thesis A), not a trajectory stat.

## Naming note
"Canary" — early-signal / canary-in-the-coalmine connotation works. Keep the product output on the landing page matched to Thesis A.

## Interview-grounded truths (keep these honest)
- Research burden 2–3 months / 3+ FTEs and reallocating that time to strategy comes from founder interviews (Updesh/AECOM, Andrew/civil, Teemu/planner) — plausible and consistent with fragmentation evidence, but not independently published. Validate with more structured interviews before it anchors the business case.
- Compression claim: "months to days" for enterprise pursuits; "weeks to days" for mid-size firms. Never "months to one day" (insiders won't believe it).
- Only ever claim the **public** record — never imply completeness.
