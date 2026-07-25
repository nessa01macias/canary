import type { ChangePoint } from './samplePoints'

const SF_PERMITS_URL =
  'https://data.sfgov.org/resource/i98e-djp9.json?$limit=300&$order=permit_creation_date DESC'

type RawPermit = {
  permit_number: string
  permit_type_definition?: string
  description?: string
  street_number?: string
  street_name?: string
  street_suffix?: string
  status?: string
  estimated_cost?: string
  neighborhoods_analysis_boundaries?: string
  location?: { type: string; coordinates: [number, number] }
}

export async function fetchSfPermits(): Promise<ChangePoint[]> {
  const res = await fetch(SF_PERMITS_URL)
  if (!res.ok) throw new Error(`DataSF request failed: ${res.status}`)
  const raw: RawPermit[] = await res.json()

  return raw
    .filter((p) => p.location?.coordinates)
    .map((p) => {
      const [lng, lat] = p.location!.coordinates
      const address = [p.street_number, p.street_name, p.street_suffix].filter(Boolean).join(' ')
      return {
        id: `sf-${p.permit_number}`,
        lng,
        lat,
        city: 'San Francisco',
        headline: p.permit_type_definition ?? 'Building permit filed',
        detail: `${address} — ${p.description ?? 'no description'} (status: ${p.status ?? 'unknown'}${
          p.estimated_cost ? `, est. $${Number(p.estimated_cost).toLocaleString()}` : ''
        })`,
        source: `DataSF Building Permits · ${p.neighborhoods_analysis_boundaries ?? 'SF'}`,
        kind: 'construction' as const,
      }
    })
}
