// ── Trajectory representation modes (a compare toggle) ─────────────────────────
// Four ways to render the SAME improving/worsening signal, switchable live so the
// look can be judged on the real map:
//   soft  — the softened diverging fill (the new baseline)
//   muted — soft fill + a neutral wash that knocks the vivid terrain back
//   glyph — a faint tint + ▲/▼ marks at each mover's centroid (calm, legible)
//   pulse — a whisper of tint + breathing translucent gradient blobs (heat feel)
// glyph/pulse are DOM markers (guaranteed to render, CSS-animated) rather than
// GL layers, so there's no glyph-font or per-frame-repaint risk.

import * as maplibregl from 'maplibre-gl'
import type { FeatureCollection, Position } from 'geojson'
import { TRAJ_MARK_BETTER, TRAJ_MARK_WORSE, trajectoryColor, trajectoryOpacity, zoomFade } from './paint'

export type VizMode = 'soft' | 'muted' | 'glyph' | 'pulse'

export const VIZ_MODES: Array<{ key: VizMode; label: string }> = [
  { key: 'soft', label: 'Soft fill' },
  { key: 'muted', label: 'Muted base' },
  { key: 'glyph', label: 'Arrows' },
  { key: 'pulse', label: 'Pulse' },
]

// Only movers past this |traj| get a mark — the calm middle of the city stays bare
// so the eye lands on what's actually changing.
export const VIZ_MARK_MIN = 0.26

// Flat fill opacity for the glyph/pulse modes, where the marks (not the fill) carry
// the signal so the fill drops to a whisper the basemap reads through. Hover is an
// outline (nbhd-line), not a fill change, so opacity is constant.
const faintFill = (rest: number) =>
  zoomFade(rest)

// Point the fill + wash + markers at one mode. Fill stays present (even at ~0.04)
// in every mode so it remains the hover/click hit-target for the neighborhood.
export function applyVizMode(map: maplibregl.Map, mode: VizMode, markers: maplibregl.Marker[]) {
  if (!map.getLayer('nbhd-fill')) return
  map.setPaintProperty('nbhd-fill', 'fill-color', trajectoryColor())
  map.setPaintProperty(
    'nbhd-fill',
    'fill-opacity',
    mode === 'glyph' ? faintFill(0.08) : mode === 'pulse' ? faintFill(0.04) : trajectoryOpacity(),
  )
  if (map.getLayer('viz-wash'))
    map.setLayoutProperty('viz-wash', 'visibility', mode === 'muted' ? 'visible' : 'none')
  for (const mk of markers) {
    const el = mk.getElement()
    el.classList.toggle('is-glyph', mode === 'glyph')
    el.classList.toggle('is-pulse', mode === 'pulse')
  }
}

// Stand the mode extras down (match-fit view, or street zoom): hide the wash and
// every mark. The fill paint is owned by whichever overlay is taking over.
export function clearVizExtras(map: maplibregl.Map, markers: maplibregl.Marker[]) {
  if (map.getLayer('viz-wash')) map.setLayoutProperty('viz-wash', 'visibility', 'none')
  for (const mk of markers) mk.getElement().classList.remove('is-glyph', 'is-pulse')
}

// Per-neighborhood DOM marks for the glyph/pulse view modes. Built once (with the
// choropleth), hidden until a mode shows them; only clear movers (past
// VIZ_MARK_MIN) get one so the calm middle of the city stays bare.
// pointer-events:none (CSS) so a click falls through to the neighborhood underneath.
export function buildVizMarkers(
  map: maplibregl.Map,
  geo: FeatureCollection,
  hotspot: (i: number) => Position,
): maplibregl.Marker[] {
  return geo.features.flatMap((f, i) => {
    const traj = Number((f.properties as { traj?: number })?.traj ?? 0)
    const atraj = Math.abs(traj)
    if (atraj < VIZ_MARK_MIN) return []
    const up = traj > 0
    const el = document.createElement('div')
    el.className = 'viz-marker'
    el.dataset.dir = up ? 'up' : 'down'
    el.style.setProperty('--c', up ? TRAJ_MARK_BETTER : TRAJ_MARK_WORSE)
    el.style.setProperty('--mag', atraj.toFixed(3))
    // Spread the breathing/ping phase so the blobs shimmer, not blink in unison.
    el.style.setProperty('--delay', `${(-(i % 6) * 0.9).toFixed(2)}s`)
    // ring = the emanating "ping"; core = the crisp breathing dot (both pulse
    // mode only); glyph = the arrow (arrows mode).
    el.innerHTML = '<span class="viz-ring"></span><span class="viz-core"></span><span class="viz-glyph"></span>'
    const mk = new maplibregl.Marker({ element: el })
      .setLngLat(hotspot(i) as [number, number])
      .addTo(map)
    return [mk]
  })
}
