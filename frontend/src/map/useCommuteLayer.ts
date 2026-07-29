// Drawing side of the commute preview — the routes, the destination dots, the
// on-line time labels, and the grey candidate dots for the "add a place" search.
// State + fetching live in commute.ts (useCommute); these hooks only draw.

import { useEffect, useRef, type RefObject } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Feature } from 'geojson'
import type { PickedAddress } from '../components/AddressSearch'
import {
  ENABLED_MODES, MODES, formatDuration, routeColor,
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
      return geom ? [{ type: 'Feature', properties: { color: routeColor(i) }, geometry: geom }] : []
    })
    ;(map.getSource('commute-routes') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection', features,
    })

    // Rebuild the overlays: a colored dot at each destination, plus ONE label on
    // its route line (at the line's midpoint) reading every mode's time — 🚗 · 🚲
    // · 🚶. Modes that haven't resolved read "—", so the label is complete the
    // moment a destination exists. Dot color matches the destination's row.
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
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
        const icon = MODES.find((x) => x.id === m)?.icon ?? ''
        return `<span class="commute-leg"><span class="commute-leg-icon" aria-hidden="true">${icon}</span>${time}</span>`
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
