// Camera + drawing for the scope ladder, ONE effect — so what the map frames
// and what it draws can never disagree with what the card describes. Owns the
// scope circle, the report pin, the neighborhood glow and the record-marker
// halo; returns the programmatic-move flag the zoom-demotion rule needs.

import { useEffect, useRef, type RefObject } from 'react'
import * as maplibregl from 'maplibre-gl'
import { EMPTY_FC, circlePolygon, scopeKey, type Scope } from '../lib/scope'
import { SF_CENTER } from './constants'
import type { NbhdMeta } from './choropleth'

// Scope drawing: the dashed circle that shows EXACTLY what a spot card is
// counting ("within ~500 m" as pixels, not a caption nobody reads). Added once
// at map load; the effect below hydrates/clears its source as scopes change.
export function addScopeCircleLayers(map: maplibregl.Map) {
  map.addSource('scope-circle', { type: 'geojson', data: EMPTY_FC })
  map.addLayer({
    id: 'scope-circle-fill', type: 'fill', source: 'scope-circle',
    paint: { 'fill-color': '#FF6624', 'fill-opacity': 0.07 },
  })
  map.addLayer({
    id: 'scope-circle-line', type: 'line', source: 'scope-circle',
    paint: {
      'line-color': '#FF6624', 'line-width': 1.6,
      'line-dasharray': [2, 2], 'line-opacity': 0.75,
    },
  })
}

export function useScopeCamera(opts: {
  mapRef: RefObject<maplibregl.Map | null>
  mapReady: boolean
  scope: Scope | null
  isMobile: boolean
  /** neighborhood name → feature id + bounds (from prepareNbhdData). */
  nbhdMetaRef: RefObject<Map<string, NbhdMeta>>
  /** record id → its marker element (for the .is-scope halo). */
  markerByIdRef: RefObject<Map<string, HTMLElement>>
}) {
  const { mapRef, mapReady, scope, isMobile, nbhdMetaRef, markerByIdRef } = opts

  // True while OUR camera flight is in progress — the zoom-demotion effect
  // must ignore programmatic moves or every scope flyTo would self-dismiss.
  const programmaticMoveRef = useRef(false)
  const reportPinRef = useRef<maplibregl.Marker | null>(null)
  const prevGlowIdRef = useRef<number | null>(null)
  const scopedMarkerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const s = scope

    // — drawing: the map shows exactly what the card is counting —
    const circleSrc = map.getSource('scope-circle') as maplibregl.GeoJSONSource | undefined
    circleSrc?.setData(
      s?.kind === 'spot'
        ? { type: 'FeatureCollection', features: [circlePolygon(s.lat, s.lon)] }
        : EMPTY_FC,
    )
    reportPinRef.current?.remove()
    reportPinRef.current = null
    if (s?.kind === 'spot') {
      const el = document.createElement('div')
      el.className = 'report-pin'
      reportPinRef.current = new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map)
    }
    if (prevGlowIdRef.current != null) {
      map.setFeatureState({ source: 'nbhd', id: prevGlowIdRef.current }, { glow: false })
      prevGlowIdRef.current = null
    }
    if (s?.kind === 'neighborhood') {
      const meta = nbhdMetaRef.current.get(s.nhood)
      if (meta && map.getLayer('nbhd-glow-core')) {
        map.setFeatureState({ source: 'nbhd', id: meta.id }, { glow: true })
        prevGlowIdRef.current = meta.id
      }
    }
    scopedMarkerRef.current?.classList.remove('is-scope')
    scopedMarkerRef.current = null
    if (s?.kind === 'record') {
      const el = markerByIdRef.current.get(s.point.id)
      if (el) {
        el.classList.add('is-scope')
        scopedMarkerRef.current = el
      }
    }

    // — camera: fly to frame the scope —
    if (!s) return
    programmaticMoveRef.current = true
    map.once('moveend', () => { programmaticMoveRef.current = false })
    const pad = isMobile
      ? { top: 80, bottom: Math.round(window.innerHeight * 0.42), left: 24, right: 24 }
      : { top: 120, bottom: 90, left: 340, right: 400 }
    switch (s.kind) {
      case 'city':
        map.easeTo({ center: SF_CENTER, zoom: 12.4, duration: 700 })
        break
      case 'neighborhood': {
        const meta = nbhdMetaRef.current.get(s.nhood)
        // maxZoom 13.6: a neighborhood fit must never cross STREET_ZOOM (14),
        // or the demotion rule would dismiss the card it just opened.
        if (meta) map.fitBounds(meta.bounds, { padding: pad, duration: 900, maxZoom: 13.6 })
        break
      }
      case 'spot':
        map.flyTo({
          center: [s.lon + (isMobile ? 0 : 0.004), s.lat],
          zoom: Math.max(map.getZoom(), 14.2),
          duration: 900,
        })
        break
      case 'record':
        map.easeTo({
          center: [s.point.lng + (isMobile ? 0 : 0.003), s.point.lat],
          zoom: Math.max(map.getZoom(), 15),
          duration: 600,
        })
        break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey(scope), mapReady])

  return { programmaticMoveRef }
}
