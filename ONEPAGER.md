# Canary, on one page

**Jurisdiction-research API for AEC pursuit teams.** Internal. Never ships to
the site. Aligned with CONTEXT.md (2026-08-12, Thesis A — see that file's
"THE FORK TO RESOLVE" section for why this supersedes the prior MLS/consumer
pivot archived at ONEPAGER_ARCHIVE_2026-08-12.md).

## The idea

Before an AEC firm can respond to a public infrastructure RFP, someone has to
research the jurisdiction and the site: planning acts, zoning by-laws, nearby
approvals, submittal requirements. At a firm like AECOM that's 2–3 months and
3+ senior staff — 6 to 12 months on a $1B+ pursuit. The data is public and
brutally fragmented across municipal sites, PDFs, by-laws, submittal
registers, and phone calls to the city.

Discovery tools (GovWin, Dodge) stop at "an opportunity exists." Proposal
tools (Loopio, AutogenAI, Joist) start at "draft the document." Nobody serves
the research in between — Canary aggregates the public record into one cited
API/MCP call. We compress the **gathering**, not the judgment: we don't touch
evaluator preferences, incumbent relationships, or anything in the genuinely
private tier.

**Why now.** Base public data (Overture, Foursquare's open POI corpus, Shovels'
185M normalized permits) went free, and reading messy municipal documents went
from analyst-hours to fractions of a cent with LLM extraction. Two engineers
can now attempt what needed Localize.city's ~$70M and 150 people for one
metro's depth.

## What exists today

- **Data engine**, built and proven in an initial city buildout: dated,
  hashed, immutable public-record snapshots spanning decades of permit and
  registry history. Shared across jurisdictions by design — the engine, not
  the city, is the asset.
- **The differentiator**: every answer traces to the exact code section,
  version date, and source URL. This is the wedge against "just use ChatGPT"
  — teams report ~85% accuracy prompting general AI themselves, with zero
  provenance to check any individual field against.
- **Not yet proven**: the AEC-specific jurisdiction bundle (planning acts,
  zoning by-laws, submittal requirements) end-to-end for the beachhead city.
  That's the wedge in progress, not a shipped claim.

## Who pays

| Segment | The bleed | Status |
|---|---|---|
| **Large AEC consultancies** (AECOM, Jacobs, WSP, Stantec, Arup, Bechtel, Turner & Townsend, Mott MacDonald) | 2–3 months / 3+ senior staff per pursuit, up to 6–12 months on $1B+ bids | Warm: in conversation with AECOM via a strategist contact. Long procurement cycles. |
| **Mid-size regional engineering & environmental consultancies** | Same research burden, no in-house tooling, bid constantly | Fastest path to a paying pilot — can say yes without a 6-month procurement cycle. Outreach underway in Ontario + Alberta, sourced from live public RFP supplier lists. |

**Pricing anchor:** manual substitutes run $550–$800/site (standardized zoning
report) to $3,000–$15,000 (comprehensive due diligence). Price per-pursuit,
roughly $2K–$8K, anchored to the value of the pursuit and the senior time it
replaces — not per-API-call, which would put us in a race to the bottom
against Regrid/Pipeworx.

## The wedge & moat

Win Toronto/Ontario end-to-end before going broad — high RFP volume, warm
access, tractable data. Depth beats breadth early because accuracy and
citations are the differentiator, not coverage. Moat is staged: scraped public
data is table stakes; the real durability is the cited-accuracy quality bar
plus, eventually, the phone-call/non-scrapable tier that general AI can't
reach.

## What we have to prove

| # | Claim | Status |
|---|---|---|
| 1 | The research burden (2–3 months / 3+ FTEs) is real and general, not three anecdotes | Grounded in founder interviews (AECOM, civil, planner contacts); not independently published. Needs more structured interviews before it anchors the business case. |
| 2 | AEC pursuit teams will pay for this, not just agree it's a real problem | **The live test.** Untested at the pilot-conversion stage. |
| 3 | The jurisdiction bundle generalizes past one beachhead city | Unmeasured. |
| 4 | We can win mid-size firms fast enough to fund reaching the enterprise procurement cycle | In motion — outreach running now. |
| 5 | Disintermediation risk: frontier models + web search get good enough on messy municipal sites | Open risk. Design for it — start collecting the non-scrapable (phone-call) tier early rather than treating the scraped layer as the whole moat. |

**Guardrails on the claim itself:** compression is "months to days" for
enterprise pursuits, "weeks to days" for mid-size firms — never "months to one
day," which insiders won't believe. We only ever claim the **public** record;
we never imply completeness.
