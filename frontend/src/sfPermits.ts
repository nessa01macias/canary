import type { ChangePoint, ChangeType, Stage } from './samplePoints'

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
  revised_cost?: string
  neighborhoods_analysis_boundaries?: string
  existing_use?: string
  proposed_use?: string
  existing_units?: string
  proposed_units?: string
  number_of_existing_stories?: string
  number_of_proposed_stories?: string
  adu?: string
  filed_date?: string
  approved_date?: string
  issued_date?: string
  location?: { type: string; coordinates: [number, number] }
}

const num = (v?: string): number | undefined => {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

const tidy = (s?: string) => (s ? s.trim().toLowerCase() : undefined)

// The pipeline stage is a certainty axis: filed → approved → issued.
function deriveStage(p: RawPermit): Stage {
  if (p.issued_date) return 'issued'
  if (p.approved_date) return 'approved'
  if (p.filed_date) return 'filed'
  return 'unknown'
}

// Classify the before→after story. Priority: the most structural change wins,
// because that's what actually moves an area's trajectory.
function deriveChange(p: RawPermit): { type: ChangeType; label: string } {
  const eu = num(p.existing_units)
  const pu = num(p.proposed_units)
  const es = num(p.number_of_existing_stories)
  const ps = num(p.number_of_proposed_stories)
  const exUse = tidy(p.existing_use)
  const prUse = tidy(p.proposed_use)
  const isAdu = String(p.adu).toLowerCase() === 'true' || p.adu === '1'

  if (eu !== undefined && pu !== undefined && pu > eu)
    return { type: 'densify', label: `${eu} → ${pu} units` }

  if (exUse && prUse && exUse !== prUse)
    return { type: 'convert', label: `${p.existing_use} → ${p.proposed_use}` }

  if (es !== undefined && ps !== undefined && ps > es)
    return { type: 'taller', label: `+${ps - es} ${ps - es === 1 ? 'story' : 'stories'} (${es} → ${ps})` }

  if (isAdu) return { type: 'adu', label: 'ADU added' }

  // Brand-new construction: no prior units on record but proposed units exist.
  if ((eu === undefined || eu === 0) && pu !== undefined && pu > 0)
    return { type: 'newbuild', label: `new — ${pu} ${pu === 1 ? 'unit' : 'units'}` }

  return { type: 'alteration', label: p.permit_type_definition ?? 'alteration' }
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
      const cost = num(p.revised_cost) ?? num(p.estimated_cost)
      const stage = deriveStage(p)
      const { type: changeType, label: changeLabel } = deriveChange(p)
      const eu = num(p.existing_units)
      const pu = num(p.proposed_units)
      const netUnits = eu !== undefined && pu !== undefined ? pu - eu : undefined

      return {
        id: `sf-${p.permit_number}`,
        lng,
        lat,
        city: 'San Francisco',
        // The change IS the headline — not "a permit exists".
        headline: changeLabel,
        detail: `${address || 'San Francisco'} — ${p.description ?? 'no description'}`,
        source: `DataSF Building Permits · ${p.neighborhoods_analysis_boundaries ?? 'SF'}`,
        kind: 'construction' as const,
        neighborhood: p.neighborhoods_analysis_boundaries,
        cost,
        stage,
        changeType,
        changeLabel,
        existingUse: p.existing_use,
        proposedUse: p.proposed_use,
        existingUnits: eu,
        proposedUnits: pu,
        existingStories: num(p.number_of_existing_stories),
        proposedStories: num(p.number_of_proposed_stories),
        netUnits,
        status: p.status,
      }
    })
}
