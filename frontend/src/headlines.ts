// "Why" lines for a neighborhood's news card — REAL statements derived from the
// data we actually serve, each cited to its public source with its as-of date.
// (Replaces the placeholder that fabricated headlines under real outlet names —
// fake citations are the one thing this product can never do.)

export type Headline = { title: string; source: string; date: string }

// The real per-neighborhood stats the card already has on hand (from the
// backend-baked GeoJSON properties captured on click).
export type NbhdNewsStats = {
  nhood: string
  permits: number
  netUnits: number
  totalCost: number
  crimeTrend?: number      // rank-normalized 0..1 across SF (1 = fastest-rising)
  bizOpenTrend?: number
  noiseTrend?: number
  evictionTrend?: number
  vacancyRate?: number
  trendsAsOf?: string | null
}

const HI = 0.8 // top-quintile rank → "among SF's fastest-rising" is literally true
const LO = 0.2

export function neighborhoodHeadlines(s: NbhdNewsStats): Headline[] {
  const asOf = s.trendsAsOf ?? 'latest snapshot'
  const out: Headline[] = []
  const push = (title: string, source: string) => out.push({ title, source, date: asOf })

  if (s.permits > 0)
    push(
      `${s.permits} building permit${s.permits === 1 ? '' : 's'} on record in the recent window`,
      'DataSF · Building Permits',
    )
  if (s.netUnits >= 3)
    push(`+${Math.round(s.netUnits)} net housing units approved`, 'DataSF · Building Permits')
  if (s.totalCost >= 1_000_000)
    push(
      `$${(s.totalCost / 1e6).toFixed(1)}M in construction investment filed`,
      'DataSF · Building Permits',
    )

  if ((s.crimeTrend ?? 0.5) >= HI)
    push('Police-reported incidents rising faster than most of SF, year over year', 'DataSF · Police reports')
  else if ((s.crimeTrend ?? 0.5) <= LO)
    push('Police-reported incidents falling faster than most of SF, year over year', 'DataSF · Police reports')

  if ((s.bizOpenTrend ?? 0.5) >= HI)
    push('Business openings accelerating vs the prior year', 'DataSF · Registered Businesses')
  else if ((s.bizOpenTrend ?? 0.5) <= LO)
    push('Business openings slowing vs the prior year', 'DataSF · Registered Businesses')

  if ((s.noiseTrend ?? 0.5) >= HI)
    push('311 noise complaints climbing vs the prior year', 'DataSF · 311 cases')
  else if ((s.noiseTrend ?? 0.5) <= LO)
    push('311 noise complaints quieting vs the prior year', 'DataSF · 311 cases')

  if ((s.evictionTrend ?? 0.5) >= HI)
    push('Eviction filings rising vs the prior year', 'SF Rent Board · eviction notices')

  if ((s.vacancyRate ?? 0.5) >= HI)
    push("Storefront vacancy among the city's highest", 'SF · commercial vacancy tax roll')

  // Never an empty card: state the quiet truthfully.
  if (out.length === 0)
    push('No notable movement in the public record this window', 'DataSF')

  return out.slice(0, 5)
}
