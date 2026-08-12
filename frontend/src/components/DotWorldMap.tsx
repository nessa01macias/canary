import { useEffect, useMemo, useRef } from 'react'
import DottedMap from 'dotted-map'

// A flat backdrop of the world rendered as dots — mostly dark and still,
// with a rotating handful flashing orange, evoking scattered public records
// resolving into cited data points across jurisdictions. Dots are toggled
// via direct DOM refs (not React state) so the animation loop never
// re-renders the few thousand points making up the map.
const LIGHT_BATCH = 10
const LIGHT_DURATION_MS = 1600
const TICK_MS = 900

export function DotWorldMap({ className }: { className?: string }) {
  // Orthographic (globe) projection instead of the default flat mercator —
  // it renders as a circle, which crops gracefully into a short wide strip
  // (just the rim of the globe) instead of a squashed, unrecognizable map.
  const map = useMemo(() => new DottedMap({
    height: 100,
    grid: 'diagonal',
    projection: { name: 'orthographic', center: { lat: 12, lng: -25 } },
  }), [])
  const points = useMemo(() => map.getPoints(), [map])
  const circleRefs = useRef<(SVGCircleElement | null)[]>([])

  useEffect(() => {
    const timers: number[] = []
    const interval = window.setInterval(() => {
      for (let i = 0; i < LIGHT_BATCH; i++) {
        const idx = Math.floor(Math.random() * points.length)
        const node = circleRefs.current[idx]
        if (!node) continue
        node.classList.add('is-lit')
        timers.push(window.setTimeout(() => node.classList.remove('is-lit'), LIGHT_DURATION_MS))
      }
    }, TICK_MS)
    return () => {
      clearInterval(interval)
      timers.forEach(clearTimeout)
    }
  }, [points])

  return (
    <svg
      className={`landing-dotmap${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${map.image.width} ${map.image.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {points.map((p, i) => (
        <circle
          key={i}
          ref={(el) => { circleRefs.current[i] = el }}
          className="landing-dotmap-point"
          cx={p.x}
          cy={p.y}
          r={0.42}
        />
      ))}
    </svg>
  )
}
