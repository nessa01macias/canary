// The frontend does NO direct data-source work. It asks our backend
// (/api/sf/neighborhoods) for the SF neighborhood polygons with trajectory
// aggregates already baked into each feature's properties, plus the ranked
// trajectory list. All aggregation runs server-side (see backend app/api/sf_live.py).

// Minimal GeoJSON typing — enough for what we join onto.
import { apiFetch } from './api'

export type NbhdFeature = {
  type: 'Feature'
  properties: Record<string, unknown> & { nhood: string }
  geometry: unknown
}

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

// The collection now carries its trajectory list alongside the features.
export type NbhdCollection = {
  type: 'FeatureCollection'
  features: NbhdFeature[]
  trajectory: NbhdTrajectory[]
}

export async function fetchNeighborhoods(): Promise<NbhdCollection> {
  const res = await apiFetch('/api/sf/neighborhoods')
  if (!res.ok) throw new Error(`/api/sf/neighborhoods failed: ${res.status}`)
  return res.json()
}
