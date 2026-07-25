# Where the data comes from

Every number in Canary traces back to a public record. This page lists what we read,
what it tells you, and how fresh it is. Nothing here is scraped from private
platforms; everything is published by a government or under an open license.

| Source | What it tells you | Updated |
|---|---|---|
| San Francisco building permits | What's being built: every permit filed, approved, and completed, with cost and housing units. History reaches back over a century. | Daily |
| SF registered businesses | Openings and closings, street by street, back decades. The backbone of the business-churn signal. | Daily |
| SF police incident reports | Reported incidents since 2018. We separate crimes reported by victims from proactive police activity, so a crackdown never reads as a crime wave. | Daily |
| SF 311 service requests | Noise, street cleanliness, encampments and more, since 2008. Measured as what they are: complaints, not conditions. | Daily |
| SF eviction notices | Displacement pressure by neighborhood and cause. | Daily |
| SF zoning, planning & development pipeline | What can be built, and what's formally proposed. | As published |
| Overture Maps & Foursquare Open Places | Independent monthly snapshots of what businesses exist, used to cross-check the registry. | Monthly |
| US Census (ACS, TIGER) | Population and geography context. | Annual |
| FEMA flood zones & CAL FIRE hazard maps | Risk layers for any address. | As published |
| California ABC & cannabis licenses | Liquor and cannabis licensing: a leading indicator of nightlife and retail change. | As published |
| Transit (GTFS), street trees, schools (CAASPP), EPA facilities | Access and environment context per neighborhood. | As published |

## The rules the data lives by

- **Two dates on everything.** Every record carries the source's own publication date
  and the date we fetched it. "Fresh" is checkable, not a slogan.
- **Citations, never verdicts.** We publish what happened, with the record behind it.
  We never label a neighborhood "good" or "bad."
- **No protected-class data.** Race, ethnicity, and income are excluded from every
  metric and every model, everywhere, by design.
- **Complaints are complaints.** Report-based data (police reports, 311) measures
  reporting behavior as well as reality; where the two diverge, we say so — see the
  Validation page for the corrections we've published about our own data.
