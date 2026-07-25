export type ChangePoint = {
  id: string
  lng: number
  lat: number
  city: string
  headline: string
  detail: string
  source: string
  kind: 'construction' | 'closure' | 'opening'
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
  },
]
