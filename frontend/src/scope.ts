// The scope ladder — the one mental model of the whole UI. The PlaceCard and
// the camera are ONE object: opening a scope moves the map to frame exactly
// what the card describes, and the map draws the scope (polygon glow, 500 m
// circle, highlighted marker). City → neighborhood → spot → record.

import type { Feature, FeatureCollection, Polygon } from 'geojson'
import type { ChangePoint } from './samplePoints'

export type Scope =
  | { kind: 'city' }
  | { kind: 'neighborhood'; nhood: string; clickLngLat?: [number, number] }
  | { kind: 'spot'; lat: number; lon: number; label?: string }
  | { kind: 'record'; point: ChangePoint }

// Stable identity for effects/transitions — same key = same scope, no-op.
export const scopeKey = (s: Scope | null): string =>
  !s ? 'none'
  : s.kind === 'city' ? 'city'
  : s.kind === 'neighborhood' ? `n:${s.nhood}`
  : s.kind === 'spot' ? `s:${s.lat.toFixed(5)},${s.lon.toFixed(5)}`
  : `r:${s.point.id}`

// The breadcrumb parent — climbing the ladder one rung up.
export function parentScope(s: Scope): Scope | null {
  switch (s.kind) {
    case 'city': return null
    case 'neighborhood': return { kind: 'city' }
    case 'spot': return { kind: 'city' } // neighborhood unknown without a polygon hit; city is honest
    case 'record': return { kind: 'spot', lat: s.point.lat, lon: s.point.lng }
  }
}

// The spot rung's radius. ONE constant shared by the drawn circle and every
// "within ~500 m" badge string, so map, card, and copy can never drift.
export const SPOT_RADIUS_M = 500

// Hand-rolled circle polygon (equirectangular — same constants as the report
// card's distance math; exact enough at neighborhood scale, no turf needed).
export function circlePolygon(lat: number, lon: number, radiusM = SPOT_RADIUS_M, steps = 64): Feature<Polygon> {
  const coords: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const dLon = (radiusM * Math.cos(a)) / (111320 * Math.cos(lat * (Math.PI / 180)))
    const dLat = (radiusM * Math.sin(a)) / 110574
    coords.push([lon + dLon, lat + dLat])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } }
}

export const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

// What /api/ask receives as `context` — where the user is asking FROM.
export type AskContext = {
  scope: Scope['kind']
  nhood?: string
  lat?: number
  lon?: number
  record_id?: string
}

export function scopeToAskContext(s: Scope | null): AskContext | undefined {
  if (!s) return undefined
  switch (s.kind) {
    case 'city': return { scope: 'city' }
    case 'neighborhood': return { scope: 'neighborhood', nhood: s.nhood }
    case 'spot': return { scope: 'spot', lat: s.lat, lon: s.lon }
    case 'record':
      return {
        scope: 'record', record_id: s.point.id,
        nhood: s.point.neighborhood, lat: s.point.lat, lon: s.point.lng,
      }
  }
}
