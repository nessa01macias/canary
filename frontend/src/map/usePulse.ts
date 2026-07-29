// The trajectory overlay's "breathing": write a per-polygon sine into the
// `pulse` feature-state each frame. Cheap — ~40 features, one repaint per frame.
// Owns its own rAF handle + per-polygon phase table; callers just start/stop.

import { useEffect, useRef, type RefObject } from 'react'
import type * as maplibregl from 'maplibre-gl'

export type PulseMeta = Array<{ id: number; phase: number }>

export function usePulse(mapRef: RefObject<maplibregl.Map | null>) {
  const metaRef = useRef<PulseMeta>([])
  const rafRef = useRef<number | null>(null)

  const stop = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }
  const start = () => {
    const map = mapRef.current
    if (!map || rafRef.current != null || !metaRef.current.length) return
    const speed = 0.00105 // rad/ms → ~6s per breath (slow, calm)
    const tick = (ts: number) => {
      for (const m of metaRef.current) {
        map.setFeatureState(
          { source: 'nbhd', id: m.id },
          { pulse: 0.5 + 0.5 * Math.sin(ts * speed + m.phase) },
        )
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => stop, [])

  return { start, stop, setMeta: (meta: PulseMeta) => { metaRef.current = meta } }
}
