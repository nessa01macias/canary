// The address report — the magic-moment surface. Click a point, get "what is
// this place becoming": recent cited changes within the hex ring, metric
// trajectories, reference attributes. Mirrors backend AddressReport
// (app/api/schemas.py); the same object the $29 PDF and the agent API serve.

import { apiFetch } from './api'

export type ReportCitation = {
  source: string
  source_as_of: string | null
  record_key: string | null
  record_url: string | null
}

export type ReportChange = {
  id: string
  lat: number
  lon: number
  category: 'construction' | 'business' | 'safety' | 'housing' | 'other'
  event_type: string
  event_time: string | null
  headline: string
  detail: string | null
  value: number | null
  units_delta: number | null
  citation: ReportCitation
}

export type ReportSeriesPoint = { period: string; value: number; n: number | null }

export type ReportTrajectory = {
  metric: string
  direction: 'rising' | 'declining' | 'stable'
  slope_per_month: number | null
  change_pct: number | null
  latest_value: number | null
  window_months: number
  series: ReportSeriesPoint[]
  citation: ReportCitation
}

export type AddressReport = {
  query: {
    lat: number
    lon: number
    h3_9: string
    ring_k: number
    display_name: string | null
  }
  generated_at: string
  pipeline_version: string | null
  changes: ReportChange[]
  trajectories: ReportTrajectory[]
  attributes: Record<string, unknown>
  // Which neighborhood the attribute facts describe (spine boundaries differ
  // from the map's polygons near edges — badge it, never let surfaces disagree).
  attributes_area?: string | null
  sources: { source: string }[]
}

// ring_k=1 ≈ the center hex + its 6 neighbors ≈ everything within ~500 m.
export async function fetchReport(lat: number, lon: number): Promise<AddressReport> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    ring_k: '1',
    since: sinceMonthsAgo(24),
    window_months: '24',
  })
  const res = await apiFetch(`/api/report?${params}`)
  if (!res.ok) throw new Error(`/api/report failed: ${res.status}`)
  return res.json()
}

function sinceMonthsAgo(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d.toISOString().slice(0, 10)
}
