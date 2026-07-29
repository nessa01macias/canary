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

const CHROME_H = 34 // grab-handle strip + body bottom padding, added to content
const MAX_VH = 0.88 // never taller than this fraction of the viewport
const DISMISS_RATIO = 0.6 // drag below 60% of the resting height → close

/**
 * Google-Maps-style bottom sheet that *hugs its content* — the resting height is
 * the content's natural height (capped at MAX_VH, with the body scrolling past
 * that), so a short card is a short sheet with no empty space. Drag the handle
 * down to dismiss (dismissible sheets) or it springs back. On non-phone widths
 * it's a pass-through: `children` keep their own desktop positioning.
 */
export function MobileSheet({
  children,
  onClose,
  dismissible = true,
  hidden = false,
}: {
  children: ReactNode
  onClose?: () => void
  /** When false, dragging down springs back instead of closing. */
  dismissible?: boolean
  /** Mobile-only: render nothing (e.g. yield the bottom to another sheet). */
  hidden?: boolean
}) {
  const isMobile = useIsMobile()
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800))
  const [contentH, setContentH] = useState(0)
  const [dragH, setDragH] = useState<number | null>(null)
  const drag = useRef<{ startY: number; startH: number } | null>(null)
  // Measure an inner wrapper whose height is ALWAYS just the content — never the
  // scrolling body (that box stretches to the sheet height, which would feed the
  // measurement back into the height and make the sheet grow on its own).
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Measure the content so the sheet can hug it, and re-measure when it changes
  // (chips added, report finishes loading, etc.).
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const measure = () => setContentH(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isMobile])

  if (!isMobile) return <>{children}</>
  if (hidden) return null

  const maxH = vh * MAX_VH
  const restH = contentH > 0 ? Math.min(contentH + CHROME_H, maxH) : null
  const height = dragH != null ? dragH : restH // null → CSS `auto` (first paint)

  const onPointerDown = (e: PointerEvent) => {
    drag.current = { startY: e.clientY, startH: height ?? restH ?? 200 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return
    const dy = drag.current.startY - e.clientY // up is positive
    // Clamp UP to the resting height so you can never pull it taller than the
    // content (that's the empty-space bug). Clamp DOWN to a small nub.
    const upper = restH ?? maxH
    setDragH(Math.min(upper, Math.max(48, drag.current.startH + dy)))
  }
  const onPointerUp = () => {
    if (!drag.current) return
    const h = dragH ?? height ?? restH ?? 0
    drag.current = null
    setDragH(null)
    if (dismissible && restH && h < restH * DISMISS_RATIO && onClose) onClose()
  }

  return (
    <div
      className="msheet"
      style={{
        height: height != null ? height : undefined,
        maxHeight: maxH,
        transition: dragH == null ? undefined : 'none',
      }}
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
      <div className="msheet-body">
        <div className="msheet-content" ref={contentRef}>
          {children}
        </div>
      </div>
    </div>
  )
}
