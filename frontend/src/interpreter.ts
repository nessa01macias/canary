// The interpreter — where personalization reaches the LANGUAGE.
//
// Deterministic templates over the rank-normalized 0..1 signals the backend
// bakes onto every neighborhood polygon. A rank IS a comparison ("more than
// most of SF" is literally true by quintile), so plain language costs no LLM
// call and can't hallucinate. Canon constraint 3 applies throughout: facts
// with direction, never quality labels — "crime falling 8 months" is ours,
// "safe" is not.

import type { Mission } from './useAsk'

// Every neighborhood's REAL signals (backend-baked GeoJSON properties, all
// rank-normalized 0..1 across SF's 41 areas). 0.5 = neutral/no data.
export type NbhdSignals = {
  intensity: number      // permit-derived structural-change intensity (0..1)
  crimeTrend: number     // higher = crime rising (real, DataSF via pipeline)
  bizOpenTrend: number   // higher = business openings accelerating
  bizCloseTrend: number  // higher = closings accelerating
  evictionTrend: number  // higher = evictions rising
  noiseTrend: number     // higher = 311 noise complaints rising
  schoolScore: number    // CAASPP % met-or-exceeded, tested-count weighted
  transitAccess: number  // distinct transit stops (Cal-ITP GTFS)
  treeCanopy: number     // street trees per km² (city inventory)
  groceryAccess: number  // open grocery stores (Foursquare OS Places)
  industryPresence: number // EPA TRI toxic-release facilities
  floodShare: number     // share of area in FEMA SFHA flood zones
  parkingPermits: number // RPP-eligible parcels
  roadProjects: number   // SFMTA projects intersecting
  cannabisRetail: number // licensed cannabis retailers (DCC)
  emsMinutes: number     // median fire/EMS response, higher = slower
  vacancyRate: number    // storefront vacancy RANK (Prop-D tax roll)
  vacancyRateRaw?: number | null // the raw rate (0..1) — rank language alone misled
}

// Preference chips we can GROUND in live data today → a real fit score in 0..1.
// Chips not in this map are ignored by the fit ranking (never faked).
export const GROUNDED_TAGS: Record<string, (s: NbhdSignals) => number> = {
  'Low crime':          (s) => 1 - s.crimeTrend,
  'Business openings':  (s) => s.bizOpenTrend,
  'Vacancy trend':      (s) => 1 - s.vacancyRate,
  'New construction':   (s) => s.intensity,
  'Quiet':              (s) => 1 - s.noiseTrend,
  'Housing stability':  (s) => 1 - s.evictionTrend,
  'Good schools':            (s) => s.schoolScore,
  'Transit access':          (s) => s.transitAccess,
  'Tree canopy':             (s) => s.treeCanopy,
  'Groceries & retail':      (s) => s.groceryAccess,
  'Away from industry':      (s) => 1 - s.industryPresence,
  'Flood risk':              (s) => 1 - s.floodShare, // picking it = wanting LOW risk
  'Parking':                 (s) => s.parkingPermits,
  'Road projects':           (s) => s.roadProjects,
  'Liquor & cannabis':       (s) => s.cannabisRetail,
  'Fast emergency response': (s) => 1 - s.emsMinutes,
}

// Quintile thresholds: >=HI / <=LO make "faster than most of SF" literally true.
export const HI = 0.8
export const LO = 0.2

// What a card knows about a neighborhood (signals + the click-time stats).
export type NbhdCardData = NbhdSignals & {
  nhood: string
  permits: number
  netUnits: number
  totalCost: number
  traj: number           // rank-normalized −1..1 (the choropleth's color)
  descriptor: string
  trendsAsOf?: string | null
}

// ---------------------------------------------------------------------------
// Verdict — the one-glance direction of a whole area (hover + card header).
// Same ±0.12 thresholds the old news card used.
// ---------------------------------------------------------------------------
export type Verdict = { label: string; glyph: string; tone: 'up' | 'down' | 'flat' }

export function verdict(traj: number): Verdict {
  if (traj > 0.12) return { label: 'Improving', glyph: '▲', tone: 'up' }
  if (traj < -0.12) return { label: 'Getting worse', glyph: '▼', tone: 'down' }
  return { label: 'Holding steady', glyph: '▪', tone: 'flat' }
}

// ---------------------------------------------------------------------------
// Direction line — the mission-framed lede. The two strongest deviations among
// the signals THIS mission cares about, phrased as directional facts.
// ---------------------------------------------------------------------------
type SignalPhrase = { key: keyof NbhdSignals; hi: string; lo: string }

// Which signals each mission reads first (lead order from QUESTION_MAP.md).
const MISSION_SIGNALS: Record<string, SignalPhrase[]> = {
  moving: [
    { key: 'crimeTrend', hi: 'crime reports rising', lo: 'crime reports falling' },
    { key: 'noiseTrend', hi: 'one of SF’s noisiest right now', lo: 'getting quieter' },
    { key: 'evictionTrend', hi: 'eviction filings climbing', lo: 'evictions among SF’s lowest' },
    { key: 'bizOpenTrend', hi: 'businesses opening fast', lo: 'business openings slowing' },
  ],
  buying: [
    { key: 'intensity', hi: 'densifying — heavy construction pipeline', lo: 'little new construction' },
    { key: 'crimeTrend', hi: 'crime reports rising', lo: 'crime reports falling' },
    { key: 'evictionTrend', hi: 'eviction filings climbing', lo: 'housing turnover among SF’s calmest' },
    { key: 'noiseTrend', hi: 'noise complaints climbing', lo: 'getting quieter' },
  ],
  opening_business: [
    { key: 'bizOpenTrend', hi: 'business openings accelerating', lo: 'business openings slowing' },
    { key: 'vacancyRate', hi: 'storefront vacancy among SF’s highest', lo: 'storefronts nearly full' },
    { key: 'noiseTrend', hi: 'street activity climbing (311 noise)', lo: 'quiet streets' },
    { key: 'intensity', hi: 'heavy construction pipeline', lo: 'little construction coming' },
  ],
  exploring: [
    { key: 'intensity', hi: 'one of SF’s fastest-changing areas', lo: 'one of SF’s calmest areas' },
    { key: 'bizOpenTrend', hi: 'businesses opening fast', lo: 'business openings slowing' },
    { key: 'crimeTrend', hi: 'crime reports rising', lo: 'crime reports falling' },
    { key: 'noiseTrend', hi: 'noise complaints climbing', lo: 'getting quieter' },
  ],
}

export function directionLine(s: NbhdCardData, mission: Mission | null): string {
  const phrases = MISSION_SIGNALS[mission ?? 'exploring'] ?? MISSION_SIGNALS.exploring
  const hits = phrases
    .map((p) => ({ p, rank: s[p.key] as number }))
    .filter(({ rank }) => rank >= HI || rank <= LO)
    .sort((a, b) => Math.abs(b.rank - 0.5) - Math.abs(a.rank - 0.5))
    .slice(0, 2)
    .map(({ p, rank }) => (rank >= HI ? p.hi : p.lo))
  return hits.length ? hits.join(' · ') : s.descriptor
}

// ---------------------------------------------------------------------------
// Evidence lines — the cited "why", mission-ordered. (Absorbs headlines.ts.)
// ---------------------------------------------------------------------------
export type Tone = 'up' | 'down' | 'neutral'
export type EvidenceLine = { key: string; text: string; tone: Tone; source: string; date: string }

// Which evidence leads, per mission (QUESTION_MAP lead order).
const MISSION_EVIDENCE_ORDER: Record<string, string[]> = {
  moving: ['crime', 'noise', 'evictions', 'biz', 'construction', 'vacancy'],
  buying: ['construction', 'crime', 'evictions', 'noise', 'vacancy', 'biz'],
  opening_business: ['biz', 'vacancy', 'noise', 'construction', 'crime', 'evictions'],
  exploring: ['construction', 'crime', 'biz', 'noise', 'evictions', 'vacancy'],
}

export function evidenceLines(s: NbhdCardData, mission: Mission | null): EvidenceLine[] {
  const asOf = s.trendsAsOf ?? 'latest snapshot'
  const out: EvidenceLine[] = []
  const push = (key: string, text: string, source: string, tone: Tone = 'neutral') =>
    out.push({ key, text, tone, source, date: asOf })

  if (s.permits > 0)
    push('construction', `${s.permits} building permit${s.permits === 1 ? '' : 's'} on record in the recent window`, 'DataSF · Building Permits')
  if (s.netUnits >= 3)
    push('construction', `+${Math.round(s.netUnits)} net housing units approved`, 'DataSF · Building Permits')
  if (s.totalCost >= 1_000_000)
    push('construction', `$${(s.totalCost / 1e6).toFixed(1)}M in construction investment filed`, 'DataSF · Building Permits')

  if (s.crimeTrend >= HI)
    push('crime', 'Police-reported incidents rising faster than most of SF, year over year', 'DataSF · Police reports', 'down')
  else if (s.crimeTrend <= LO)
    push('crime', 'Police-reported incidents falling faster than most of SF, year over year', 'DataSF · Police reports', 'up')

  if (s.bizOpenTrend >= HI)
    push('biz', 'Business openings accelerating vs the prior year', 'DataSF · Registered Businesses', 'up')
  else if (s.bizOpenTrend <= LO)
    push('biz', 'Business openings slowing vs the prior year', 'DataSF · Registered Businesses', 'down')

  if (s.noiseTrend >= HI)
    push('noise', '311 noise complaints climbing vs the prior year', 'DataSF · 311 cases', 'down')
  else if (s.noiseTrend <= LO)
    push('noise', '311 noise complaints quieting vs the prior year', 'DataSF · 311 cases', 'up')

  if (s.evictionTrend >= HI)
    push('evictions', 'Eviction filings rising vs the prior year', 'SF Rent Board · eviction notices', 'down')

  // Vacancy carries its RAW rate whenever we have it — "among the highest" alone
  // misled when the underlying number was 1.2% (the trust bug of 2026-07-25).
  const rawPct = s.vacancyRateRaw != null ? `${(s.vacancyRateRaw * 100).toFixed(1)}% of storefronts vacant` : null
  if (s.vacancyRate >= HI)
    push('vacancy', rawPct ? `${rawPct} — among the city's highest` : "Storefront vacancy among the city's highest", 'SF · Prop-D vacancy roll', 'down')
  else if (s.vacancyRate <= LO && rawPct)
    push('vacancy', `${rawPct} — among the city's lowest`, 'SF · Prop-D vacancy roll', 'up')

  if (out.length === 0)
    push('quiet', 'No notable movement in the public record this window', 'DataSF')

  // Mission decides what leads; stable within a group.
  const order = MISSION_EVIDENCE_ORDER[mission ?? 'exploring'] ?? MISSION_EVIDENCE_ORDER.exploring
  const pos = (k: string) => { const i = order.indexOf(k); return i === -1 ? order.length : i }
  return out.sort((a, b) => pos(a.key) - pos(b.key)).slice(0, 5)
}

// ---------------------------------------------------------------------------
// Why line — per active chip, does this area deliver? (Best-fit list + card.)
// ---------------------------------------------------------------------------
export type ChipVerdict = { chip: string; ok: boolean }

export function whyChips(signals: NbhdSignals, activeChips: string[]): ChipVerdict[] {
  const out: ChipVerdict[] = []
  for (const chip of activeChips) {
    const score = GROUNDED_TAGS[chip]?.(signals)
    if (score == null) continue
    if (score >= 0.6) out.push({ chip, ok: true })
    else if (score <= 0.4) out.push({ chip, ok: false })
    // mid-range chips say nothing — a ✓ or ✗ there would overclaim
    if (out.length === 3) break
  }
  return out
}

// ---------------------------------------------------------------------------
// City facts — the city rung's dossier body (the card is never a bare chat).
// ---------------------------------------------------------------------------
export type CityFacts = {
  rising: string[]
  declining: string[]
  permits: number
  netUnits: number
}

export function computeCityFacts(areas: Iterable<NbhdCardData>): CityFacts | null {
  const list = [...areas]
  if (list.length === 0) return null
  const byTraj = [...list].sort((a, b) => b.traj - a.traj)
  return {
    rising: byTraj.slice(0, 3).filter((a) => a.traj > 0.05).map((a) => a.nhood),
    declining: byTraj.slice(-3).filter((a) => a.traj < -0.05).map((a) => a.nhood).reverse(),
    permits: list.reduce((n, a) => n + a.permits, 0),
    netUnits: Math.round(list.reduce((n, a) => n + a.netUnits, 0)),
  }
}

// ---------------------------------------------------------------------------
// Map caption — the map narrates itself. Deterministic over app state, always
// matching what the pixels currently mean (the five-year-old test for colors).
// ---------------------------------------------------------------------------
export function mapCaption(
  zoomedIn: boolean,
  activeChipCount: number,
  hexMetricLabel?: string | null,
): string {
  if (zoomedIn) return 'Each dot is one real permit or business change — click it for the record'
  if (hexMetricLabel)
    return `Small hexes = block-level ${hexMetricLabel} — amber rising, blue falling`
  if (activeChipCount > 0)
    return `Warmer = closer fit to your ${activeChipCount} pick${activeChipCount > 1 ? 's' : ''} — click an area to see why`
  return 'Each area breathes with how fast it’s changing — click one to read it'
}
