// Change-point markers — the individual permits / business openings / closures
// that own the street-zoom view. This module builds and sizes the DOM elements;
// attach/detach bookkeeping (the zoom-jitter fix) stays with the map lifecycle.

import { CHANGE_META, KIND_COLOR, type ChangePoint } from '../samplePoints'
import { ALTERATION_MIN_ZOOM, STREET_ZOOM } from './constants'

// Marker radius encodes magnitude ($ value), on a log scale, clamped.
export function markerSize(cost?: number): number {
  if (!cost || cost <= 0) return 9
  const t = (Math.log10(cost) - 4) / 3 // ~$10k→0, ~$10M→1
  return Math.round(9 + Math.max(0, Math.min(1, t)) * 13) // 9..22px
}

// Central marker visibility: markers appear past STREET_ZOOM; routine (`.minor`)
// alterations additionally require zooming past ALTERATION_MIN_ZOOM.
export function applyMarkerVisibility(els: HTMLElement[], zoom: number) {
  const showMarkers = zoom >= STREET_ZOOM
  for (const el of els) {
    const minor = el.classList.contains('minor')
    el.style.display = showMarkers && (!minor || zoom >= ALTERATION_MIN_ZOOM) ? '' : 'none'
  }
}

// One change-point → one styled, clickable DOM element (kind color, $-scaled
// size, structural/minor class, glyph when big enough to read).
export function createChangeMarkerElement(point: ChangePoint, onClick: () => void): HTMLElement {
  const el = document.createElement('div')
  el.className = 'change-marker'
  el.style.setProperty('--color', KIND_COLOR[point.kind])
  const size = markerSize(point.cost)
  el.style.width = `${size}px`
  el.style.height = `${size}px`
  const glyph = point.changeType ? CHANGE_META[point.changeType].glyph : ''
  if (glyph && size >= 15) {
    el.textContent = glyph
    el.classList.add('has-glyph')
  }
  if (point.changeType && point.changeType !== 'alteration') el.classList.add('structural')
  else if (point.changeType === 'alteration') el.classList.add('minor')
  el.title = `${point.city} · ${point.changeLabel ?? point.headline}`
  el.addEventListener('click', onClick)
  return el
}
