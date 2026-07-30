// The sub-neighborhood texture — "which corner of the neighborhood is
// changing". Every competitor's map stops at the neighborhood polygon because
// their data does; ours is H3-native, so the hexes are nearly free.
// GET /api/hex-trajectory serves the pipeline's precomputed per-hex trajectory
// rows as polygons (server-cached; ~700 rankable hexes per metric).

import type { FeatureCollection } from 'geojson'
import { apiFetch } from './api'

// Which metric textures the hexes, given the user's leading active chip.
// Only trend-metrics appear here — attribute chips (schools, flood…) have no
// monthly hex series to texture by.
export const HEX_METRIC_BY_CHIP: Record<string, string> = {
  'New construction': 'permits_issued',
  'Business openings': 'biz_openings',
  'Low crime': 'crime_incidents',
  'Quiet': 'threeoneone_noise',
  'Housing stability': 'evictions_filed',
  'Vacancy trend': 'biz_closings',
}

export const HEX_METRIC_LABEL: Record<string, string> = {
  permits_issued: 'construction',
  biz_openings: 'business openings',
  crime_incidents: 'crime reports',
  threeoneone_noise: 'noise reports',
  evictions_filed: 'eviction filings',
  biz_closings: 'business closings',
}

export function hexMetricFor(activeChips: string[]): string {
  for (const chip of activeChips) {
    const m = HEX_METRIC_BY_CHIP[chip]
    if (m) return m
  }
  return 'permits_issued' // the forward layer — the differentiator — by default
}

export async function fetchHexTrajectory(metric: string): Promise<FeatureCollection> {
  const res = await apiFetch(`/api/hex-trajectory?metric=${encodeURIComponent(metric)}`)
  if (!res.ok) throw new Error(`/api/hex-trajectory failed: ${res.status}`)
  return res.json()
}
