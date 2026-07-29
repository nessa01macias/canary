// The kind drives the three-way color legend (construction / closure / opening).
export type ChangeKind = 'construction' | 'closure' | 'opening'

// The *pipeline stage* is a certainty axis, not a value judgment:
// filed (someone's proposing) → approved → issued (it's actually happening).
export type Stage = 'filed' | 'approved' | 'issued' | 'unknown'

// What KIND of change a permit represents — the trajectory signal, derived from
// the before→after fields DataSF ships but the old UI threw away.
export type ChangeType =
  | 'densify'     // proposed units > existing units
  | 'convert'     // existing use ≠ proposed use
  | 'taller'      // proposed stories > existing stories
  | 'adu'         // accessory dwelling unit added
  | 'newbuild'    // new construction
  | 'alteration'  // routine work, no structural change detected
  | 'closure'
  | 'opening'

export type ChangePoint = {
  id: string
  lng: number
  lat: number
  city: string
  headline: string
  detail: string
  source: string
  kind: ChangeKind

  // ── Trajectory fields (present on real permits; optional on flavor points) ──
  neighborhood?: string
  cost?: number
  stage?: Stage
  changeType?: ChangeType
  changeLabel?: string     // the before→after delta, e.g. "1 → 2 units"
  existingUse?: string
  proposedUse?: string
  existingUnits?: number
  proposedUnits?: number
  existingStories?: number
  proposedStories?: number
  netUnits?: number        // proposedUnits − existingUnits
  status?: string
}

// NOTE: the hardcoded CA "flavor points" that used to live here are gone —
// the map draws ONLY real data (live DataSF permits via /api/sf/permits,
// pipeline trends via /api/sf/neighborhoods). Other metros return when their
// live feeds land (Shovels.ai, per DATA_SOURCES.md). This module now only
// carries the shared ChangePoint types.

// ── Shared rendering vocabulary for change points ─────────────────────────
// Lives here (with the types) so both the map (App) and the PlaceCard's
// record rung read one source of truth.

export const KIND_COLOR: Record<ChangeKind, string> = {
  construction: '#FF6624',
  closure:      '#c1443c',
  opening:      '#3f8f5c',
}

export const KIND_LABEL: Record<ChangeKind, string> = {
  construction: 'Permit · Construction',
  closure:      'Business Closure',
  opening:      'Business Opening',
}

// changeType → glyph (a channel SEPARATE from color, so no palette limit) + copy.
export const CHANGE_META: Record<ChangeType, { label: string; glyph: string; blurb: string }> = {
  densify:    { label: 'Densifying',       glyph: '＋', blurb: 'Adding homes to the parcel' },
  convert:    { label: 'Use converting',   glyph: '⇄', blurb: 'Changing what the building is for' },
  taller:     { label: 'Building taller',  glyph: '↑', blurb: 'Adding stories' },
  newbuild:   { label: 'New construction', glyph: '◆', blurb: 'Ground-up build' },
  adu:        { label: 'ADU added',        glyph: '△', blurb: 'Backyard / in-law unit' },
  alteration: { label: 'Alteration',       glyph: '',  blurb: 'Routine work, structure unchanged' },
  closure:    { label: 'Business closure', glyph: '✕', blurb: '' },
  opening:    { label: 'Business opening', glyph: '＋', blurb: '' },
}

// Pipeline stage = a CERTAINTY axis (not a value judgment on the area).
export const STAGE_META: Record<Stage, { label: string; hint: string; cls: string }> = {
  filed:    { label: 'Filed',    hint: 'proposed',      cls: 'stage-filed' },
  approved: { label: 'Approved', hint: 'greenlit',      cls: 'stage-approved' },
  issued:   { label: 'Issued',   hint: 'happening now', cls: 'stage-issued' },
  unknown:  { label: 'Filed',    hint: 'on record',     cls: 'stage-filed' },
}
