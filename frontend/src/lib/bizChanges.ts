import type { ChangePoint } from './samplePoints'
import { apiFetch } from './api'

// Business openings/closures for the map — green/red dots that tell the "block
// alive or dying" story next to the construction markers. Served by our backend
// (/api/changes?category=business), which joins the registered business NAME and
// clamps out the registry's future-dated dirt. Same-origin /api/* as everything.

const SF_BBOX = '-122.52,37.70,-122.35,37.83'

type ApiChange = {
  id: string
  lat: number
  lon: number
  event_type: string
  event_time: string | null
  headline: string
  citation: { source: string; source_as_of: string | null; record_key: string | null }
}

function sinceMonthsAgo(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d.toISOString().slice(0, 10)
}

export async function fetchSfBusinessChanges(): Promise<ChangePoint[]> {
  const url = `/api/changes?bbox=${SF_BBOX}&category=business&since=${sinceMonthsAgo(3)}&limit=300`
  const res = await apiFetch(url)
  if (!res.ok) throw new Error(`/api/changes (business) failed: ${res.status}`)
  const raw: ApiChange[] = await res.json()

  return raw.map((c) => {
    const opened = c.event_type === 'place_opened'
    return {
      id: c.id,
      lng: c.lon,
      lat: c.lat,
      city: 'San Francisco',
      headline: c.headline, // the registered business name
      detail: `${opened ? 'Opened' : 'Closed'} ${c.event_time ?? ''} — SF Registered Business Locations`,
      source: `${c.citation.source}${c.citation.source_as_of ? ` · ${c.citation.source_as_of}` : ''}`,
      kind: opened ? ('opening' as const) : ('closure' as const),
      changeType: opened ? ('opening' as const) : ('closure' as const),
      changeLabel: opened ? 'opened' : 'closed',
      status: opened ? 'opened' : 'closed',
    }
  })
}
