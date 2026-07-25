// The kind drives the three-way color legend (construction / closure / opening).
export type ChangeKind = 'construction' | 'closure' | 'opening'

// The *pipeline stage* is a certainty axis, not a value judgment:
// filed (someone's proposing) → approved → issued (it's actually happening).
export type Stage = 'filed' | 'approved' | 'issued' | 'unknown'

// What KIND of change a permit represents — the trajectory signal, derived from
// the before→after fields DataSF ships but the old UI threw away.
export type ChangeType =
  | 'densify'     // proposed units > existing units
  | 'convert'     // existing use ≠ proposed use
  | 'taller'      // proposed stories > existing stories
  | 'adu'         // accessory dwelling unit added
  | 'newbuild'    // new construction
  | 'alteration'  // routine work, no structural change detected
  | 'closure'
  | 'opening'

export type ChangePoint = {
  id: string
  lng: number
  lat: number
  city: string
  headline: string
  detail: string
  source: string
  kind: ChangeKind

  // ── Trajectory fields (present on real permits; optional on flavor points) ──
  neighborhood?: string
  cost?: number
  stage?: Stage
  changeType?: ChangeType
  changeLabel?: string     // the before→after delta, e.g. "1 → 2 units"
  existingUse?: string
  proposedUse?: string
  existingUnits?: number
  proposedUnits?: number
  existingStories?: number
  proposedStories?: number
  netUnits?: number        // proposedUnits − existingUnits
  status?: string
}

// Flavor points across California outside SF (SF itself is live from DataSF).
// Stand-ins until each metro gets its own live feed (Shovels.ai, per DATA_SOURCES.md).
export const samplePoints: ChangePoint[] = [
  {
    id: 'la-1',
    lng: -118.2437,
    lat: 34.0522,
    city: 'Los Angeles',
    headline: 'Mixed-use permit filed, Arts District',
    detail: '6-story mixed-use building approved within 300m — 120 residential units + ground-floor retail.',
    source: 'LADBS Building Permits (sample)',
    kind: 'construction',
    changeType: 'densify',
    changeLabel: '0 → 120 units',
    stage: 'approved',
    cost: 48_000_000,
    netUnits: 120,
  },
  {
    id: 'sd-1',
    lng: -117.1611,
    lat: 32.7157,
    city: 'San Diego',
    headline: 'Retail churn, North Park',
    detail: '3 storefronts closed, 2 opened in the last 90 days — above the neighborhood baseline turnover rate.',
    source: 'Overture Places monthly diff (sample)',
    kind: 'closure',
    changeType: 'closure',
    changeLabel: '−1 net storefront',
  },
  {
    id: 'sac-1',
    lng: -121.4944,
    lat: 38.5816,
    city: 'Sacramento',
    headline: 'Rezoning approved, R Street Corridor',
    detail: 'Parcel rezoned from industrial to mixed-use — signals corridor-wide redevelopment pressure.',
    source: 'City of Sacramento Zoning (sample)',
    kind: 'construction',
    changeType: 'convert',
    changeLabel: 'industrial → mixed-use',
    stage: 'approved',
  },
  {
    id: 'oak-1',
    lng: -122.2712,
    lat: 37.8044,
    city: 'Oakland',
    headline: 'New grocery opening, Temescal',
    detail: 'New full-service grocery opened — correlated historically with ~0.5% area home-price lift (HBS/Luca Starbucks study).',
    source: 'Foursquare OS Places (sample)',
    kind: 'opening',
    changeType: 'opening',
    changeLabel: '+1 anchor tenant',
  },
  {
    id: 'fre-1',
    lng: -119.7871,
    lat: 36.7378,
    city: 'Fresno',
    headline: 'Warehouse permit filed, Southeast Fresno',
    detail: '85,000 sq ft distribution facility permitted — first industrial filing in this tract in 3 years.',
    source: 'City of Fresno Permits (sample)',
    kind: 'construction',
    changeType: 'newbuild',
    changeLabel: 'new 85k sq ft facility',
    stage: 'filed',
    cost: 12_000_000,
  },
]
