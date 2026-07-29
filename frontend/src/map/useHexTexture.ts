// Neighborhood rung → the hex texture ("which corner is changing"). Lazily
// fetched per metric (server caches too), keyed to the user's leading active
// chip; visibility rides the scope so the one-encoding rule holds (city ramp OR
// hex texture, never both fighting — the hexes sit above the fill only inside
// the zoom band).

import { useEffect, useRef, type RefObject } from 'react'
import type * as maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { fetchHexTrajectory } from '../hexLayer'

export function useHexTexture(
  mapRef: RefObject<maplibregl.Map | null>,
  mapReady: boolean,
  hexMetric: string | null,
) {
  const cacheRef = useRef<Map<string, FeatureCollection>>(new Map())

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getLayer('hex-fill')) return
    if (!hexMetric) {
      map.setLayoutProperty('hex-fill', 'visibility', 'none')
      return
    }
    let stale = false
    const show = (fc: FeatureCollection) => {
      if (stale) return
      const src = map.getSource('hex') as maplibregl.GeoJSONSource | undefined
      src?.setData(fc)
      map.setLayoutProperty('hex-fill', 'visibility', 'visible')
    }
    const cached = cacheRef.current.get(hexMetric)
    if (cached) show(cached)
    else {
      fetchHexTrajectory(hexMetric)
        .then((fc) => { cacheRef.current.set(hexMetric, fc); show(fc) })
        .catch(() => {}) // texture is an enhancement — its absence breaks nothing
    }
    return () => { stale = true }
  }, [hexMetric, mapReady, mapRef])
}
