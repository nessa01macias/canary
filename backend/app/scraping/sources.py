from dataclasses import dataclass


@dataclass(frozen=True)
class Source:
    slug: str
    url: str
    note: str


# Queued in CONTEXT.md "RESOURCES ALREADY COLLECTED" / "STATUS / NEXT ACTIONS".
SOURCES = [
    Source(
        slug="opportunity-atlas",
        url="https://www.opportunityatlas.org",
        note="Mission precedent: Chetty's neighborhood upward-mobility data, updated ~once a decade.",
    ),
    Source(
        slug="safetipin",
        url="https://safetipin.com",
        note="Crowdsourced safety audits — Glassdoor-adjacent give-to-get mechanic in safety.",
    ),
    Source(
        slug="reddit-realestate-1ct126o",
        url="https://www.reddit.com/r/RealEstate/comments/1ct126o",
        note="r/RealEstate thread: how did you decide where to live.",
    ),
    Source(
        slug="reddit-mortgages-1uk8qtt",
        url="https://www.reddit.com/r/Mortgages/comments/1uk8qtt",
        note="r/Mortgages hesitant-buyer thread.",
    ),
]
