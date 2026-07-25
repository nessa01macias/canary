import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react'

/** True while the viewport is phone-sized. Drives the map's touch UX (sheet,
 *  hidden zoom buttons) without touching the desktop layout. */
export function useIsMobile(query = '(max-width: 640px)') {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatch(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return match
}

// Snap heights as a fraction of viewport height: peek · half · full.
const SNAPS = [0.32, 0.58, 0.92]
const DEFAULT_SNAP = 1 // open at "half", like a Google Maps place card
const DISMISS_BELOW = 0.16 // drag under this fraction → close

/**
 * Google-Maps-style draggable bottom sheet. On phones it wraps the given card
 * in a sheet with a grab handle that drags between snap points (and dismisses
 * when flung down). On larger screens it's a pass-through — `children` keep
 * their own desktop positioning, so nothing about the desktop UI changes.
 */
export function MobileSheet({
  children,
  onClose,
}: {
  children: ReactNode
  onClose?: () => void
}) {
  const isMobile = useIsMobile()
  const [snap, setSnap] = useState(DEFAULT_SNAP)
  const [dragH, setDragH] = useState<number | null>(null)
  const drag = useRef<{ startY: number; startH: number } | null>(null)
  // Re-read viewport height on rotation/resize so snaps stay proportional.
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800))
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (!isMobile) return <>{children}</>

  const height = dragH ?? SNAPS[snap] * vh

  const onPointerDown = (e: PointerEvent) => {
    drag.current = { startY: e.clientY, startH: height }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return
    const dy = drag.current.startY - e.clientY // dragging up is positive
    setDragH(Math.min(vh * 0.94, Math.max(60, drag.current.startH + dy)))
  }
  const onPointerUp = () => {
    if (!drag.current) return
    const h = dragH ?? height
    drag.current = null
    setDragH(null)
    if (h < vh * DISMISS_BELOW && onClose) {
      onClose()
      return
    }
    // Snap to the nearest detent.
    let best = 0
    let bestDist = Infinity
    SNAPS.forEach((s, i) => {
      const d = Math.abs(s * vh - h)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    setSnap(best)
  }

  return (
    <div
      className="msheet"
      style={{ height, transition: dragH == null ? undefined : 'none' }}
    >
      <div
        className="msheet-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="button"
        aria-label="Drag to resize, or drag down to close"
        tabIndex={0}
      >
        <span className="msheet-grip" />
      </div>
      <div className="msheet-body">{children}</div>
    </div>
  )
}
