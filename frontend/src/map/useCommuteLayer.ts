// Drawing side of the commute preview — the routes, the destination dots, the
// on-line time labels, and the grey candidate dots for the "add a place" search.
// State + fetching live in commute.ts (useCommute); these hooks only draw.

import { useEffect, useRef, type RefObject } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Feature, LineString, Position } from 'geojson'
import type { PickedAddress } from '../components/AddressSearch'
import {
  ENABLED_MODES, MODES, formatDuration, formatDistance, routeColor, ORIGIN_COLOR,
  type CommuteMode, type CommuteState, type LegsByMode,
} from '../lib/commute'
import { EMPTY_FC } from '../lib/scope'

// One line per destination. There's no selected mode anymore, so we draw a
// single representative path — drive if we have it, else whichever mode
// resolved — and hang every mode's time off it as one label.
const repGeomFor = (byMode: LegsByMode) => {
  for (const m of ['drive', 'bike', 'walk'] as CommuteMode[]) {
    const leg = byMode[m]
    if (leg?.ok && leg.geometry) return leg.geometry
  }
  return null
}

// ── Gradient route lines ──────────────────────────────────────────────────────
// A route can't fade along its length in one MapLibre line layer: `line-gradient`
// only reads `line-progress` (never per-feature data), and `line-color` is a
// single flat color per feature. So we bake the ramp into the geometry — resample
// the path into a run of short equal-length slivers, each carrying the color it
// should be at that point (origin color → destination color). ~40 slivers reads
// as a smooth fade at map line widths.
const GRADIENT_STEPS = 40

const hexToRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
// Linear RGB mix of two #rrggbb colors at t ∈ [0,1] → #rrggbb.
const mixHex = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`
}
// Planar segment length with a cos(lat) correction on longitude — we only need
// relative lengths to space the samples, so an equirectangular approx is plenty.
const segLen = (a: Position, b: Position): number => {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) * Math.PI) / 360)
  return Math.hypot(dx, b[1] - a[1])
}
// The point a given distance `d` along a polyline (given its cumulative lengths).
const pointAtDist = (coords: Position[], cum: number[], d: number): Position => {
  if (d <= 0) return coords[0]
  const total = cum[cum.length - 1]
  if (d >= total) return coords[coords.length - 1]
  let i = 1
  while (i < cum.length && cum[i] < d) i++
  const span = cum[i] - cum[i - 1] || 1
  const t = (d - cum[i - 1]) / span
  const a = coords[i - 1]
  const b = coords[i]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}
// Split one route geometry into GRADIENT_STEPS colored slivers fading from→to.
const gradientFeatures = (geom: LineString, from: string, to: string): Feature[] => {
  const coords = geom.coordinates
  if (coords.length < 2) return []
  const cum = [0]
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + segLen(coords[i - 1], coords[i]))
  const total = cum[cum.length - 1]
  if (total === 0) return []
  const step = total / GRADIENT_STEPS
  const out: Feature[] = []
  let prev = coords[0]
  for (let s = 1; s <= GRADIENT_STEPS; s++) {
    const pt = pointAtDist(coords, cum, step * s)
    out.push({
      type: 'Feature',
      properties: { color: mixHex(from, to, (s - 0.5) / GRADIENT_STEPS) },
      geometry: { type: 'LineString', coordinates: [prev, pt] },
    })
    prev = pt
  }
  return out
}

// Draw the commute routes (color-coded lines) + a time badge at each
// destination, whenever the results change.
export function useCommuteRoutesLayer(
  mapRef: RefObject<maplibregl.Map | null>,
  mapReady: boolean,
  commute: CommuteState,
) {
  const markersRef = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    if (!map.getSource('commute-routes')) {
      map.addSource('commute-routes', { type: 'geojson', data: EMPTY_FC })
      // white casing under the colored line so routes read over any basemap
      map.addLayer({
        id: 'commute-routes-casing', type: 'line', source: 'commute-routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff', 'line-opacity': 0.9,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5.5, 16, 10],
        },
      })
      map.addLayer({
        id: 'commute-routes-line', type: 'line', source: 'commute-routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'], 'line-opacity': 0.95,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 6],
        },
      })
    }

    const legsByDest = commute.destinations.map((dest) => commute.legsFor(dest.id))
    const features: Feature[] = commute.destinations.flatMap((_dest, i) => {
      const geom = repGeomFor(legsByDest[i])
      // Fade each route from the origin's blue at the start to its own dot color
      // at the destination — a blue→green ramp for a green destination.
      return geom ? gradientFeatures(geom, ORIGIN_COLOR, routeColor(i)) : []
    })
    ;(map.getSource('commute-routes') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection', features,
    })

    // Rebuild the overlays: a colored dot at each destination, plus ONE label on
    // its route line (at the line's midpoint) reading every mode's distance + time
    // — 🚗 3.4 mi · 12 min. Modes that haven't resolved read "—", so the label is
    // complete the moment a destination exists. Dot color matches the row.
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    // The origin ("you are here") dot — the blue end every gradient springs from.
    // All routes share the origin, so pin it once at the start of any resolved
    // path (routes are returned origin-first).
    const originGeom = legsByDest.map(repGeomFor).find(Boolean)
    if (originGeom?.coordinates.length) {
      const el = document.createElement('div')
      el.className = 'commute-pin commute-origin'
      el.style.setProperty('--c', ORIGIN_COLOR)
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(originGeom.coordinates[0] as [number, number]).addTo(map),
      )
    }

    commute.destinations.forEach((dest, i) => {
      const byMode = legsByDest[i]
      const color = routeColor(i)

      const dot = document.createElement('div')
      dot.className = 'commute-pin'
      dot.style.setProperty('--c', color)
      markersRef.current.push(
        new maplibregl.Marker({ element: dot, anchor: 'center' }).setLngLat([dest.lng, dest.lat]).addTo(map),
      )

      // Times ride on the line: anchor the label at the geometry's midpoint when
      // we have a path, otherwise float it just above the destination dot.
      const geom = repGeomFor(byMode)
      const coords = geom?.coordinates
      const at: [number, number] = coords?.length
        ? (coords[Math.floor(coords.length / 2)] as [number, number])
        : [dest.lng, dest.lat]

      const label = document.createElement('div')
      label.className = 'commute-line-label'
      label.style.setProperty('--c', color)
      label.title = dest.label
      label.innerHTML = ENABLED_MODES.map((m) => {
        const leg = byMode[m]
        const time = leg?.ok && leg.duration_s != null ? formatDuration(leg.duration_s) : '—'
        const dist = leg?.ok ? formatDistance(leg.distance_m) : ''
        const icon = MODES.find((x) => x.id === m)?.icon ?? ''
        // Distance sits ahead of time (muted) so you read how far, then how long.
        const detail = dist ? `<span class="commute-leg-dist">${dist}</span>${time}` : time
        return `<span class="commute-leg"><span class="commute-leg-icon" aria-hidden="true">${icon}</span>${detail}</span>`
      }).join('')
      markersRef.current.push(
        new maplibregl.Marker({ element: label, anchor: 'bottom' }).setLngLat(at).addTo(map),
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commute.resultsByMode, commute.destinations, mapReady])
}

// Grey candidate dots for the live "add a place" search — one per location of
// the searched business. Click a dot (or its dropdown row) to pick that spot;
// they clear on pick or when the field empties.
export function useCandidateDots(
  mapRef: RefObject<maplibregl.Map | null>,
  mapReady: boolean,
  candidates: PickedAddress[],
  onPick: (p: PickedAddress) => void,
) {
  const markersRef = useRef<maplibregl.Marker[]>([])
  // The click handlers are created per rebuild but must call the LATEST picker
  // (it closes over commute state) — the ref pattern keeps them fresh.
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    candidates.forEach((c) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'commute-candidate'
      el.title = c.label
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onPickRef.current(c)
      })
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(c.center).addTo(map),
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, mapReady])
}
