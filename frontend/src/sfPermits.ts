import type { ChangePoint } from './samplePoints'

// The frontend does NO direct data-source work. It asks our own backend
// (/api/changes) for located change events; the backend is the only thing that
// touches DuckDB. Same-origin /api/* → FastAPI (Vite proxy in dev, Caddy in prod).

// SF bounding box (permits currently live for SF). minLng,minLat,maxLng,maxLat.
const SF_BBOX = '-122.52,37.70,-122.35,37.83'

// Shape the API returns (subset we use). See backend app/api/schemas.py ChangePoint.
type ApiChange = {
  id: string
  lat: number
  lon: number
  category: string
  event_type: string
  headline: string
  detail: string | null
  citation: { source: string; source_as_of: string | null; record_key: string | null }
}

// Map the API's category vocabulary to the map's marker kinds.
function toKind(c: ApiChange): ChangePoint['kind'] {
  if (c.event_type === 'place_closed') return 'closure'
  if (c.event_type === 'place_opened') return 'opening'
  return 'construction'
}

export async function fetchSfPermits(): Promise<ChangePoint[]> {
  const url = `/api/changes?bbox=${SF_BBOX}&category=construction&limit=300`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`/api/changes failed: ${res.status}`)
  const raw: ApiChange[] = await res.json()

  return raw.map((c) => ({
    id: c.id,
    lng: c.lon,
    lat: c.lat,
    city: 'San Francisco',
    headline: c.headline,
    detail: c.detail ?? '',
    source: c.citation.source + (c.citation.source_as_of ? ` · ${c.citation.source_as_of}` : ''),
    kind: toKind(c),
  }))
}
