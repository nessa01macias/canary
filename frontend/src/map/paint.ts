// Paint expressions + color ramps for the neighborhood fill — shared by the
// initial layer and the mode/preference effects so the views stay in lockstep.
// `trajectory*` = the default pulsing good/bad overlay; `match*` = colors by the
// per-neighborhood preference fit.

import type * as maplibregl from 'maplibre-gl'
import { STREET_ZOOM } from './constants'

// Diverging ramp → neighborhood TRAJECTORY over the last few years. Terracotta =
// worsening (e.g. crime climbing), periwinkle = improving. Softened from the old
// "Solar Shock" ramp: the two poles are now perceptually BALANCED in lightness
// (indigo used to be far darker than the orange, so "improving" always shouted
// louder), and pulled toward the cream midpoint so even strong movers read as a
// tint the terrain shows through — not a slab. Interpolated on `traj` ∈ [-1, 1].
export const TRAJECTORY_STOPS: Array<[number, string]> = [
  [-1, '#e0764a'],   // strongly worsening — soft terracotta
  [-0.5, '#eca787'], // worsening — muted clay
  [0, '#f2e7e1'],    // flat — cream neutral (matches the chrome)
  [0.5, '#93a7e4'],  // improving — soft periwinkle
  [1, '#6d84dd'],    // strongly improving — periwinkle (balanced against the clay)
]

// Punchier poles for the small marks (arrows / pulse blobs) — a saturated color is
// fine on a mark a few px wide, where the same saturation on a whole-polygon slab
// reads harsh. Direction only; magnitude rides size/opacity.
export const TRAJ_MARK_BETTER = '#3f5fd6'
export const TRAJ_MARK_WORSE = '#e2643a'

// Warm ramp → FIT to the user's selected preferences (darker = better match).
// Deliberately a different hue from INTENSITY so "good for me" never reads as
// "lots of construction"; ties visually to the orange preference chips.
// Tops out at the selected-chip color (#FF6624) — never darker, which read muddy.
export const MATCH_STOPS: Array<[number, string]> = [
  [0, '#fbe4d6'],
  [0.25, '#fdc39a'],
  [0.5, '#ff9f63'],
  [0.75, '#ff8038'],
  [1, '#ff6624'],
]

export const trajectoryColor = () =>
  ['interpolate', ['linear'], ['coalesce', ['get', 'traj'], 0], ...TRAJECTORY_STOPS.flat()] as
    maplibregl.DataDrivenPropertyValueSpecification<string>

// Opacity is deliberately low so fills read as tints the basemap shows through,
// not blocks. Two parts: a faint STATIC tint that grows with trend strength (so a
// flat neighborhood nearly disappears into the cream), plus a gentle breathing
// swing that only the strong movers get (`pulseAmp` is 0 for the calm majority).
// Hover still wins for legibility.
// Zoom continuum: full strength at city scale, melted to a whisper past
// STREET_ZOOM so the markers own the street view. ['zoom'] must be the
// top-level interpolate, with the data expression at each stop.
export const zoomFade = (expr: unknown) =>
  ['interpolate', ['linear'], ['zoom'],
    STREET_ZOOM - 1.2, expr,
    STREET_ZOOM + 0.8, ['*', 0.1, expr],
  ] as maplibregl.DataDrivenPropertyValueSpecification<number>

export const trajectoryOpacity = () =>
  // Hover is drawn as an outline (nbhd-line), not a brighter fill — so the fill
  // opacity is the resting tint at all times. Capped low so it stays a tint, never
  // a block: a flat neighborhood ~0.07, a strong mover ~0.20 at rest and ~0.30 at
  // the top of its breath.
  zoomFade(
    ['+',
      ['+', 0.07, ['*', 0.13, ['abs', ['coalesce', ['get', 'traj'], 0]]]],
      ['*', ['coalesce', ['feature-state', 'pulse'], 0],
        ['*', 0.1, ['coalesce', ['get', 'pulseAmp'], 0]]]],
  )

export const matchColor = () =>
  ['interpolate', ['linear'], ['coalesce', ['feature-state', 'match'], 0], ...MATCH_STOPS.flat()] as
    maplibregl.DataDrivenPropertyValueSpecification<string>

// match may legitimately be 0 (worst fit), so presence is tested against a
// sentinel (-1) rather than truthiness — a 0-fit area still shows, just lightest.
export const matchOpacity = () =>
  // Hover is drawn as an outline (nbhd-line), not a brighter fill — resting tint only.
  zoomFade(['case', ['==', ['coalesce', ['feature-state', 'match'], -1], -1],
    0.06,
    0.72,
  ])
