import type { ChangePoint } from './samplePoints'

// SF "Analysis Neighborhoods" polygons — the `nhood` property matches the
// permit field `neighborhoods_analysis_boundaries` 1:1 (verified: 36/36).
const SF_NBHD_GEOJSON =
  'https://data.sfgov.org/api/geospatial/j2bu-swwd?method=export&format=GeoJSON'

// Minimal GeoJSON typing — enough for what we join onto.
export type NbhdFeature = {
  type: 'Feature'
  properties: Record<string, unknown> & { nhood: string }
  geometry: unknown
}
export type NbhdCollection = { type: 'FeatureCollection'; features: NbhdFeature[] }

export type NbhdTrajectory = {
  nhood: string
  permits: number
  totalCost: number
  netUnits: number
  densify: number
  convert: number
  taller: number
  adu: number
  intensity: number // 0..1, normalized across neighborhoods — drives fill color
  descriptor: string // neutral, factual one-liner (never good/bad)
}

export async function fetchNeighborhoods(): Promise<NbhdCollection> {
  const res = await fetch(SF_NBHD_GEOJSON)
  if (!res.ok) throw new Error(`SF neighborhoods request failed: ${res.status}`)
  return res.json()
}

// Neutral descriptor — states what's happening, lets the reader judge value.
// (DESIGN CONSTRAINT: facts, never "improving/declining" labels.)
function describe(t: Omit<NbhdTrajectory, 'descriptor' | 'intensity'>): string {
  if (t.permits === 0) return 'No recent permit activity'
  if (t.netUnits >= 5 || t.densify >= 3) return 'Densifying — parcels adding units'
  if (t.convert >= 3) return 'Use converting — buildings changing purpose'
  if (t.taller >= 3) return 'Building taller — added stories'
  if (t.totalCost >= 10_000_000) return 'Capital-intensive — large-dollar projects'
  if (t.adu >= 3) return 'Backyard density — ADUs added'
  return 'Steady — mostly minor alterations'
}

export function aggregate(points: ChangePoint[]): Map<string, NbhdTrajectory> {
  const raw = new Map<string, Omit<NbhdTrajectory, 'intensity' | 'descriptor'>>()

  for (const p of points) {
    const nb = p.neighborhood
    if (!nb) continue
    const a =
      raw.get(nb) ??
      { nhood: nb, permits: 0, totalCost: 0, netUnits: 0, densify: 0, convert: 0, taller: 0, adu: 0 }
    a.permits += 1
    a.totalCost += p.cost ?? 0
    a.netUnits += Math.max(0, p.netUnits ?? 0)
    if (p.changeType === 'densify') a.densify += 1
    if (p.changeType === 'convert') a.convert += 1
    if (p.changeType === 'taller') a.taller += 1
    if (p.changeType === 'adu') a.adu += 1
    raw.set(nb, a)
  }

  // Composite score weighted toward STRUCTURAL change over routine volume.
  const score = (a: Omit<NbhdTrajectory, 'intensity' | 'descriptor'>) =>
    a.netUnits * 3 +
    a.densify * 2 +
    a.convert * 2 +
    a.taller * 2 +
    a.adu * 1 +
    Math.log10(a.totalCost + 1) * 2 +
    a.permits * 0.3

  const maxScore = Math.max(1, ...[...raw.values()].map(score))

  const out = new Map<string, NbhdTrajectory>()
  for (const [nb, a] of raw) {
    out.set(nb, {
      ...a,
      intensity: Math.min(1, score(a) / maxScore),
      descriptor: describe(a),
    })
  }
  return out
}
