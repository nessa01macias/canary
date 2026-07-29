// Pure geometry over GeoJSON features — no map, no DOM, no fetch. Everything
// here is deterministic input → output, which is what makes the mask, the mark
// placement and the permit→neighborhood assignment testable in isolation.

import type { Feature, FeatureCollection, Polygon, Position } from 'geojson'

// ── Muted land mask ────────────────────────────────────────────────────────────
// The muted base is ONE big cream polygon covering the whole world with San
// Francisco punched out as holes: SF alone reads vivid ('soft fill'), while the rest
// of the world stays a calm muted base — a fixed frame, independent of hover.
export const WORLD_RING: Position[] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]

// 2× signed ring area (shoelace); its sign is the winding — used to keep holes wound
// opposite the outer ring so they cut the mask rather than fill it.
export const ringArea2 = (r: Position[]): number => {
  let s = 0
  for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return s
}

// The world polygon with the given rings punched out as holes (empty → solid world).
export const maskFeature = (holeRings: Position[][]): Feature<Polygon> => {
  const outerSign = Math.sign(ringArea2(WORLD_RING))
  const holes = holeRings.map((r) => (Math.sign(ringArea2(r)) === outerSign ? [...r].reverse() : r))
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [WORLD_RING, ...holes] } }
}

// A feature's exterior rings (Polygon → one, MultiPolygon → several) — the shapes
// used as mask holes so the hovered neighborhood reads vivid.
export const exteriorRings = (f: Feature): Position[][] => {
  const g = f.geometry
  const out: Position[][] = []
  if (g?.type === 'Polygon') { if (g.coordinates[0]) out.push(g.coordinates[0]) }
  else if (g?.type === 'MultiPolygon') for (const poly of g.coordinates) { if (poly[0]) out.push(poly[0]) }
  return out
}

// Area-weighted centroid of a feature's largest ring — where a per-neighborhood
// mark (arrow / blob) sits. Good enough for placement; blobby SF hoods keep it inside.
export function featureCentroid(f: Feature): Position {
  const rings: Position[][] = []
  const g = f.geometry
  if (g?.type === 'Polygon') { if (g.coordinates[0]) rings.push(g.coordinates[0]) }
  else if (g?.type === 'MultiPolygon') for (const poly of g.coordinates) { if (poly[0]) rings.push(poly[0]) }
  let best: Position = [0, 0]
  let bestArea = -1
  for (const r of rings) {
    let a = 0, cx = 0, cy = 0
    for (let i = 0; i + 1 < r.length; i++) {
      const cross = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
      a += cross
      cx += (r[i][0] + r[i + 1][0]) * cross
      cy += (r[i][1] + r[i + 1][1]) * cross
    }
    if (Math.abs(a) < 1e-12) continue
    if (Math.abs(a) > bestArea) {
      bestArea = Math.abs(a)
      best = [cx / (3 * a), cy / (3 * a)]
    }
  }
  return best
}

// Ray-cast point-in-ring (even-odd rule).
export function pointInRing(ring: Position[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Is (x,y) inside this feature? Even-odd across each polygon's rings so holes
// (a ring inside the outer) correctly punch out. Used to assign a permit to the
// neighborhood that actually contains it — independent of any name field.
export function pointInFeature(f: Feature, x: number, y: number): boolean {
  const g = f.geometry
  const polys: Position[][][] =
    g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []
  for (const poly of polys) {
    let inThis = false
    for (const ring of poly) if (pointInRing(ring, x, y)) inThis = !inThis
    if (inThis) return true
  }
  return false
}

// Axis-aligned bounds [[w,s],[e,n]] of a polygon/multipolygon feature — used to
// fit the map to a neighborhood when it's clicked in the Best-fit list.
export function featureBounds(f: Feature): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const scan = (ring: Position[]) => {
    for (const [x, y] of ring) {
      if (x < w) w = x; if (y < s) s = y; if (x > e) e = x; if (y > n) n = y
    }
  }
  const g = f.geometry
  if (g?.type === 'Polygon') g.coordinates.forEach(scan)
  else if (g?.type === 'MultiPolygon') for (const poly of g.coordinates) poly.forEach(scan)
  return [[w, s], [e, n]]
}

// Development hotspot per neighborhood: the $-weighted centroid of its
// permits, so the mark (esp. the pulse blob) sits where building is actually
// concentrated — not the geometric center of the polygon. Each permit is
// assigned to the polygon that CONTAINS it (point-in-polygon, authoritative
// and independent of any name field); weight by construction cost, with a
// net-units proxy when cost is missing. Hoods with no permits fall back to
// the area centroid. Returns a lookup by feature index.
export function permitHotspots(
  geo: FeatureCollection,
  permits: Array<{ lng: number; lat: number; cost?: number; netUnits?: number }>,
): (i: number) => Position {
  const bounds = geo.features.map((f) => featureBounds(f))
  const acc = geo.features.map(() => ({ x: 0, y: 0, w: 0 }))
  for (const pt of permits) {
    if (!Number.isFinite(pt.lng) || !Number.isFinite(pt.lat)) continue
    for (let i = 0; i < geo.features.length; i++) {
      const b = bounds[i]
      if (pt.lng < b[0][0] || pt.lng > b[1][0] || pt.lat < b[0][1] || pt.lat > b[1][1]) continue
      if (!pointInFeature(geo.features[i], pt.lng, pt.lat)) continue
      const w = pt.cost && pt.cost > 0 ? pt.cost : Math.abs(pt.netUnits ?? 0) * 1e5 + 1
      acc[i].x += pt.lng * w
      acc[i].y += pt.lat * w
      acc[i].w += w
      break // a permit belongs to exactly one neighborhood
    }
  }
  return (i: number): Position =>
    acc[i].w > 0 ? [acc[i].x / acc[i].w, acc[i].y / acc[i].w] : featureCentroid(geo.features[i])
}
