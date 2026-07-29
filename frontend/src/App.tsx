import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CHANGE_META, KIND_COLOR, type ChangePoint } from './samplePoints'
import { fetchSfPermits } from './sfPermits'
import { fetchNeighborhoods } from './neighborhoods'
import { KNOWN_FOR } from './knownFor'
import type { FeatureCollection, Feature, Polygon, Position } from 'geojson'
import { Contribute } from './Contribute'
import { Docs } from './Docs'
import { ForAgents } from './ForAgents'
import { fetchResidentLayer, type ResidentAgg } from './residentLayer'
import { fetchHeadlines, type Headline } from './claims'
import { fetchReport, type AddressReport } from './report'
import { MobileSheet, useIsMobile } from './MobileSheet'
import { fetchSfBusinessChanges } from './bizChanges'
import { AddressSearch, type PickedAddress } from './AddressSearch'
import { PlaceCard, askPlaceholderFor } from './PlaceCard'
import { useAsk, type Mission } from './useAsk'
import { GROUNDED_TAGS, computeCityFacts, mapCaption, verdict, whyChips, type NbhdCardData, type NbhdSignals } from './interpreter'
import { EMPTY_FC, circlePolygon, scopeKey, scopeToAskContext, type Scope } from './scope'
import { HEX_METRIC_LABEL, fetchHexTrajectory, hexMetricFor } from './hexLayer'
import { logGateCompleted } from './lib/gateEvents'
import { MAX_PICKS, MISSIONS } from './missions'
import { PreferencePicker } from './PreferencePicker'
import { CommutePanel } from './CommutePanel'
import { ENABLED_MODES, MODES, formatDuration, routeColor, useCommute, type CommuteMode, type Origin } from './commute'
import './App.css'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY


// Diverging ramp → neighborhood TRAJECTORY over the last few years. Terracotta =
// worsening (e.g. crime climbing), periwinkle = improving. Softened from the old
// "Solar Shock" ramp: the two poles are now perceptually BALANCED in lightness
// (indigo used to be far darker than the orange, so "improving" always shouted
// louder), and pulled toward the cream midpoint so even strong movers read as a
// tint the terrain shows through — not a slab. Interpolated on `traj` ∈ [-1, 1].
const TRAJECTORY_STOPS: Array<[number, string]> = [
  [-1, '#e0764a'],   // strongly worsening — soft terracotta
  [-0.5, '#eca787'], // worsening — muted clay
  [0, '#f2e7e1'],    // flat — cream neutral (matches the chrome)
  [0.5, '#93a7e4'],  // improving — soft periwinkle
  [1, '#6d84dd'],    // strongly improving — periwinkle (balanced against the clay)
]

// Punchier poles for the small marks (arrows / pulse blobs) — a saturated color is
// fine on a mark a few px wide, where the same saturation on a whole-polygon slab
// reads harsh. Direction only; magnitude rides size/opacity.
const TRAJ_MARK_BETTER = '#3f5fd6'
const TRAJ_MARK_WORSE = '#e2643a'

// Warm ramp → FIT to the user's selected preferences (darker = better match).
// Deliberately a different hue from INTENSITY so "good for me" never reads as
// "lots of construction"; ties visually to the orange preference chips.
// Tops out at the selected-chip color (#FF6624) — never darker, which read muddy.
const MATCH_STOPS: Array<[number, string]> = [
  [0, '#fbe4d6'],
  [0.25, '#fdc39a'],
  [0.5, '#ff9f63'],
  [0.75, '#ff8038'],
  [1, '#ff6624'],
]

// REAL per-neighborhood signals, baked into the GeoJSON properties by the backend
// (/api/sf/neighborhoods → DuckDB metrics, 12-vs-12-month trends, rank-normalized
// 0..1). Captured at choropleth build into nbhdSignalsRef; consumed by the
// trajectory overlay and the preference fit below. The signal vocabulary and
// the chip grounding now live in interpreter.ts — the module that turns these
// ranks into plain language everywhere.

// Fill paint expressions, shared by the initial layer and the mode/preference
// effects so the views stay in lockstep. `trajectory*` = the default pulsing
// good/bad overlay; `match*` = colors by the per-neighborhood preference fit.
const trajectoryColor = () =>
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
const zoomFade = (expr: unknown) =>
  ['interpolate', ['linear'], ['zoom'],
    STREET_ZOOM - 1.2, expr,
    STREET_ZOOM + 0.8, ['*', 0.1, expr],
  ] as maplibregl.DataDrivenPropertyValueSpecification<number>

const trajectoryOpacity = () =>
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
const matchColor = () =>
  ['interpolate', ['linear'], ['coalesce', ['feature-state', 'match'], 0], ...MATCH_STOPS.flat()] as
    maplibregl.DataDrivenPropertyValueSpecification<string>
// match may legitimately be 0 (worst fit), so presence is tested against a
// sentinel (-1) rather than truthiness — a 0-fit area still shows, just lightest.
const matchOpacity = () =>
  // Hover is drawn as an outline (nbhd-line), not a brighter fill — resting tint only.
  zoomFade(['case', ['==', ['coalesce', ['feature-state', 'match'], -1], -1],
    0.06,
    0.72,
  ])

// ── Trajectory representation modes (a compare toggle) ─────────────────────────
// Four ways to render the SAME improving/worsening signal, switchable live so the
// look can be judged on the real map:
//   soft  — the softened diverging fill (the new baseline)
//   muted — soft fill + a neutral wash that knocks the vivid terrain back
//   glyph — a faint tint + ▲/▼ marks at each mover's centroid (calm, legible)
//   pulse — a whisper of tint + breathing translucent gradient blobs (heat feel)
// glyph/pulse are DOM markers (guaranteed to render, CSS-animated) rather than
// GL layers, so there's no glyph-font or per-frame-repaint risk.
type VizMode = 'soft' | 'muted' | 'glyph' | 'pulse'
const VIZ_MODES: Array<{ key: VizMode; label: string }> = [
  { key: 'soft', label: 'Soft fill' },
  { key: 'muted', label: 'Muted base' },
  { key: 'glyph', label: 'Arrows' },
  { key: 'pulse', label: 'Pulse' },
]
// Only movers past this |traj| get a mark — the calm middle of the city stays bare
// so the eye lands on what's actually changing.
const VIZ_MARK_MIN = 0.26

// Flat fill opacity for the glyph/pulse modes, where the marks (not the fill) carry
// the signal so the fill drops to a whisper the basemap reads through. Hover is an
// outline (nbhd-line), not a fill change, so opacity is constant.
const faintFill = (rest: number) =>
  zoomFade(rest)

// ── Muted land mask ────────────────────────────────────────────────────────────
// The muted base is ONE big cream polygon covering the whole world with San
// Francisco punched out as holes: SF alone reads vivid ('soft fill'), while the rest
// of the world stays a calm muted base — a fixed frame, independent of hover.
const WORLD_RING: Position[] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]
// 2× signed ring area (shoelace); its sign is the winding — used to keep holes wound
// opposite the outer ring so they cut the mask rather than fill it.
const ringArea2 = (r: Position[]): number => {
  let s = 0
  for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return s
}
// The world polygon with the given rings punched out as holes (empty → solid world).
const maskFeature = (holeRings: Position[][]): Feature<Polygon> => {
  const outerSign = Math.sign(ringArea2(WORLD_RING))
  const holes = holeRings.map((r) => (Math.sign(ringArea2(r)) === outerSign ? [...r].reverse() : r))
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [WORLD_RING, ...holes] } }
}
// A feature's exterior rings (Polygon → one, MultiPolygon → several) — the shapes
// used as mask holes so the hovered neighborhood reads vivid.
const exteriorRings = (f: Feature): Position[][] => {
  const g = f.geometry
  const out: Position[][] = []
  if (g?.type === 'Polygon') { if (g.coordinates[0]) out.push(g.coordinates[0]) }
  else if (g?.type === 'MultiPolygon') for (const poly of g.coordinates) { if (poly[0]) out.push(poly[0]) }
  return out
}

// Point the fill + wash + markers at one mode. Fill stays present (even at ~0.04)
// in every mode so it remains the hover/click hit-target for the neighborhood.
function applyVizMode(map: maplibregl.Map, mode: VizMode, markers: maplibregl.Marker[]) {
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
function clearVizExtras(map: maplibregl.Map, markers: maplibregl.Marker[]) {
  if (map.getLayer('viz-wash')) map.setLayoutProperty('viz-wash', 'visibility', 'none')
  for (const mk of markers) mk.getElement().classList.remove('is-glyph', 'is-pulse')
}

// Area-weighted centroid of a feature's largest ring — where a per-neighborhood
// mark (arrow / blob) sits. Good enough for placement; blobby SF hoods keep it inside.
function featureCentroid(f: Feature): Position {
  const rings: Position[][] = []
  const g = f.geometry
  if (g?.type === 'Polygon') { if (g.coordinates[0]) rings.push(g.coordinates[0]) }
  else if (g?.type === 'MultiPolygon') for (const poly of g.coordinates) { if (poly[0]) rings.push(poly[0]) }
  let best: Position = [0, 0]
  let bestArea = -1
  for (const r of rings) {
    let a = 0, cx = 0, cy = 0
    for (let i = 0; i + 1 < r.length; i++) {
      const cross = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
      a += cross
      cx += (r[i][0] + r[i + 1][0]) * cross
      cy += (r[i][1] + r[i + 1][1]) * cross
    }
    if (Math.abs(a) < 1e-12) continue
    if (Math.abs(a) > bestArea) {
      bestArea = Math.abs(a)
      best = [cx / (3 * a), cy / (3 * a)]
    }
  }
  return best
}

// Ray-cast point-in-ring (even-odd rule).
function pointInRing(ring: Position[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
// Is (x,y) inside this feature? Even-odd across each polygon's rings so holes
// (a ring inside the outer) correctly punch out. Used to assign a permit to the
// neighborhood that actually contains it — independent of any name field.
function pointInFeature(f: Feature, x: number, y: number): boolean {
  const g = f.geometry
  const polys: Position[][][] =
    g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []
  for (const poly of polys) {
    let inThis = false
    for (const ring of poly) if (pointInRing(ring, x, y)) inThis = !inThis
    if (inThis) return true
  }
  return false
}

// Axis-aligned bounds [[w,s],[e,n]] of a polygon/multipolygon feature — used to
// fit the map to a neighborhood when it's clicked in the Best-fit list.
function featureBounds(f: Feature): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const scan = (ring: Position[]) => {
    for (const [x, y] of ring) {
      if (x < w) w = x; if (y < s) s = y; if (x > e) e = x; if (y > n) n = y
    }
  }
  const g = f.geometry
  if (g?.type === 'Polygon') g.coordinates.forEach(scan)
  else if (g?.type === 'MultiPolygon') for (const poly of g.coordinates) poly.forEach(scan)
  return [[w, s], [e, n]]
}

// Marker radius encodes magnitude ($ value), on a log scale, clamped.
function markerSize(cost?: number): number {
  if (!cost || cost <= 0) return 9
  const t = (Math.log10(cost) - 4) / 3 // ~$10k→0, ~$10M→1
  return Math.round(9 + Math.max(0, Math.min(1, t)) * 13) // 9..22px
}

// ONE LAYER, ZOOM AS THE AXIS (no mode toggle). At city scale you care about
// areas — the trajectory choropleth. Fly past STREET_ZOOM and the story becomes
// individual permits and businesses: the choropleth melts to a faint tint while
// the markers fade up. What used to be two tabs is now just… zooming.
const STREET_ZOOM = 14

// Routine "OTC alteration" permits are low-signal noise even at street zoom —
// reveal them only once the user is close enough for parcel detail to matter.
const ALTERATION_MIN_ZOOM = 15

// Central marker visibility: markers appear past STREET_ZOOM; routine (`.minor`)
// alterations additionally require zooming past the gate above.
function applyMarkerVisibility(els: HTMLElement[], zoom: number) {
  const showMarkers = zoom >= STREET_ZOOM
  for (const el of els) {
    const minor = el.classList.contains('minor')
    el.style.display = showMarkers && (!minor || zoom >= ALTERATION_MIN_ZOOM) ? '' : 'none'
  }
}

function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerElsRef = useRef<HTMLElement[]>([])
  const popupRef = useRef<maplibregl.Popup | null>(null)
  // Stable feature id ↔ neighborhood name, captured when the choropleth is built,
  // so the preference effect can write per-neighborhood fit into feature-state.
  const nbhdIdsRef = useRef<Array<{ id: number; nhood: string }>>([])
  // neighborhood name → its feature id + bounding box, so the Best-fit list can
  // glow the polygon on hover and fit the map to it on click.
  const nbhdMetaRef = useRef<Map<string, { id: number; bounds: [[number, number], [number, number]] }>>(new Map())
  // neighborhood name → its REAL signals (from backend-baked GeoJSON properties),
  // read by the preference-fit effect. See GROUNDED_TAGS.
  const nbhdSignalsRef = useRef<Map<string, NbhdSignals>>(new Map())
  // neighborhood name → everything the PlaceCard needs (signals + click-time
  // stats), captured at choropleth build so ANY code path (ask flyto, breadcrumb,
  // best-fit click) can open a neighborhood card without a map click event.
  const nbhdPropsRef = useRef<Map<string, NbhdCardData>>(new Map())
  // marker id → its DOM element, for the record rung's .is-scope highlight.
  const markerByIdRef = useRef<Map<string, HTMLElement>>(new Map())
  // neighborhood name → k-anonymised resident-review aggregates (the moat's read
  // side, GET /api/resident-layer). Read lazily by the hover popup.
  const residentRef = useRef<Map<string, ResidentAgg>>(new Map())
  // neighborhood name → recent local-news headlines (the CLAIMS tier, GET
  // /api/claims). Read lazily by the PlaceCard so a card can cite where its
  // picture comes from; empty for areas outside the news pilot.
  const headlinesRef = useRef<Map<string, Headline[]>>(new Map())
  // Read by the (once-created) hover popup closure to append a fit line.
  const matchInfoRef = useRef<{ active: boolean; count: number }>({ active: false, count: 0 })
  // Per-polygon pulse phase (built with the choropleth) + the running rAF handle
  // that drives the "breathing" trajectory overlay.
  const pulseMetaRef = useRef<Array<{ id: number; phase: number }>>([])
  const pulseRafRef = useRef<number | null>(null)
  // Per-neighborhood DOM marks (▲/▼ arrows + pulse blobs), built once with the
  // choropleth; the active VizMode toggles which — if any — are shown.
  const vizMarkersRef = useRef<maplibregl.Marker[]>([])
  // Which trajectory representation is on — a live compare toggle (see VizMode).
  // Default 'muted': the whole map reads as a calm base and the neighborhood you
  // hover pops to the vivid 'soft' look (the wash cuts out under the hovered area).
  const [vizMode, setVizMode] = useState<VizMode>('muted')
  const [sfCount, setSfCount] = useState<number | null>(null)
  const [contributing, setContributing] = useState(false)
  // The magic-moment report — fetched whenever the scope ladder is on its SPOT
  // rung (scope-subordinate state; the effect lives next to the scope machinery).
  const [report, setReport] = useState<AddressReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const reportPinRef = useRef<maplibregl.Marker | null>(null)
  const [researchOpen, setResearchOpen] = useState(false)
  const [docsTab, setDocsTab] = useState<string | undefined>(undefined)
  const [agentsOpen, setAgentsOpen] = useState(false)
  // One layer, zoom as the axis: past STREET_ZOOM the map is about individual
  // permits/businesses; below it, area trajectory. Replaces the old mode toggle.
  const [zoomedIn, setZoomedIn] = useState(false)
  // SF is the one lit-up city, so when it's panned/zoomed out of the viewport we
  // surface a bottom-center "back to SF" button (see the map init effect).
  const [sfOffscreen, setSfOffscreen] = useState(false)
  const zoomToCity = () => {
    const map = mapRef.current
    if (map && map.getZoom() >= STREET_ZOOM) map.easeTo({ zoom: 12.4, duration: 700 })
  }
  const [priorities, setPriorities] = useState<Set<string>>(new Set())
  // The shortlist = the chips shown in the panel (chosen in onboarding). `priorities`
  // is the ACTIVE subset that drives the map. A chip toggled off in the panel leaves
  // `priorities` but STAYS in `shortlist`, rendered as an empty-state button.
  const [shortlist, setShortlist] = useState<string[]>([])
  const [matchTop, setMatchTop] = useState<string[]>([])
  // THE preference picker — the only preference surface (mission tabs +
  // spotlight + folded catalog). First run shows it once after the map has had
  // a beat; "Choose what matters" and "Edit" reopen the same screen.
  const [mission, setMission] = useState<string | null>(() => localStorage.getItem('canary_mission'))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [firstRunPicker, setFirstRunPicker] = useState(() => !localStorage.getItem('canary_mission'))
  // Never interrupt before value: the breathing map IS the welcome.
  const [pickerReady, setPickerReady] = useState(false)
  // The give-to-get gate, REVERSED: the open-data chips are free; the gate is now
  // the community layer — resident reviews are unlocked by contributing one
  // (true Glassdoor timing: gate the salary page, not the front door). Persisted.
  const [residentUnlocked, setResidentUnlocked] = useState(
    () => localStorage.getItem('canary_resident_unlocked') === '1',
  )
  const unlockResidents = (area?: string) => {
    localStorage.setItem('canary_resident_unlocked', '1')
    setResidentUnlocked(true)
    logGateCompleted(area) // fake-door numerator, attributed to the reviewed area
  }
  // Same pattern for the mission — the hover verdict is mission-framed.
  const missionRef = useRef<string | null>(mission)
  missionRef.current = mission
  // Mobile only: the "⋯" menu that holds the secondary header actions.
  const [menuOpen, setMenuOpen] = useState(false)
  // The wizard's receipt line, shown on the city rung after chips seed.
  const [cityIntro, setCityIntro] = useState<string | null>(null)

  // Onboarding: add/remove a field from the shortlist (activating it on add). The
  // MAX_PICKS cap applies to shortlist membership.
  const toggleShortlist = (tag: string) => {
    const inList = shortlist.includes(tag)
    if (!inList && shortlist.length >= MAX_PICKS) return
    setShortlist((prev) => (inList ? prev.filter((t) => t !== tag) : [...prev, tag]))
    setPriorities((prev) => {
      const next = new Set(prev)
      if (inList) next.delete(tag)
      else next.add(tag)
      return next
    })
    if (!inList) zoomToCity() // the fit overlay reads at area scale
  }

  // Panel: flip a shortlisted chip on/off. It stays in the shortlist either way, so
  // deselecting leaves an empty-state button rather than removing it.
  const toggleActive = (tag: string) => {
    const activating = !priorities.has(tag)
    setPriorities((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
    if (activating) zoomToCity()
  }

  // Full reset from the onboarding "Clear" button.
  const clearAll = () => {
    setShortlist([])
    setPriorities(new Set())
  }

  // Best-fit list → map. Hover glows the neighborhood's border; click flies the map
  // to fit it (extra left padding clears the preferences panel).
  const glowNeighborhood = (nhood: string, on: boolean) => {
    const map = mapRef.current
    const meta = nbhdMetaRef.current.get(nhood)
    if (!map || !meta || !map.getLayer('nbhd-glow-core')) return
    map.setFeatureState({ source: 'nbhd', id: meta.id }, { glow: on })
  }
  // Ask Canary → the assistant drives the map: apply its suggested chips as the
  // active preference set (union, capped at MAX_PICKS) and read at area scale.
  const applyAssistantChips = (chips: string[]) => {
    setShortlist((prev) => [...prev, ...chips.filter((c) => !prev.includes(c))].slice(0, MAX_PICKS))
    setPriorities((prev) => {
      const next = new Set(prev)
      for (const c of chips) next.add(c)
      return new Set([...next].slice(0, MAX_PICKS))
    })
    setPickerOpen(false)
    zoomToCity()
  }

  // Picker handlers. The mission is a TAB inside the picker (a lens, not a
  // step); Done shows the RECEIPT — the city card says what just happened and
  // teaches the ask box at the moment of curiosity (never silent automation).
  const handleMissionTab = (id: string) => {
    localStorage.setItem('canary_mission', id)
    setMission(id)
  }
  const dismissPicker = () => {
    // First-run close counts as "exploring" so the picker doesn't re-ambush.
    if (!localStorage.getItem('canary_mission')) {
      localStorage.setItem('canary_mission', 'exploring')
      setMission('exploring')
    }
    setPickerOpen(false)
    setFirstRunPicker(false)
  }
  const finishPicker = () => {
    const picks = [...priorities]
    dismissPicker()
    if (picks.length) {
      setCityIntro(
        `Ranked all 41 neighborhoods by ${picks.map((s) => s.toLowerCase()).join(', ')}. ` +
          'Tap a best fit below — or ask me anything.',
      )
      openScope({ kind: 'city' }, { fromAsk: true })
    }
  }
  // "Just exploring" is a SKIP, not a form — the least-invested user gets the
  // lightest path: straight to the breathing map, with the city card telling
  // the story (what's rising, what's under pressure) instead of asking for input.
  const exploreInstead = () => {
    localStorage.setItem('canary_mission', 'exploring')
    setMission('exploring')
    setPickerOpen(false)
    setFirstRunPicker(false)
    setCityIntro('This is San Francisco changing — blues rising, oranges under pressure. Tap any area to read it, or ask anything.')
    openScope({ kind: 'city' }, { fromAsk: true })
  }

  // The ask flow. Questions carry the current scope as CONTEXT ("here" = the
  // place the card is about); action blocks auto-execute on the map below.
  const askFlow = useAsk()
  const runAsk = (q: string) => {
    // A global ask with no card open answers on the city rung.
    if (!scopeRef.current) openScope({ kind: 'city' }, { fromAsk: true })
    askFlow.ask(q, scopeToAskContext(scopeRef.current)).then(() => {})
  }
  useEffect(() => {
    const r = askFlow.result
    if (!r) return
    for (const b of r.blocks) {
      if (b.type === 'rank_map') {
        // Re-ranking is a CITY-scale action: demote scope so the camera and the
        // card stay locked (never two camera authorities racing).
        openScope({ kind: 'city' }, { fromAsk: true })
        applyAssistantChips(b.chips)
      } else if (b.type === 'flyto') {
        // The answer travels with the morph — fromAsk keeps it on the card.
        openScope({ kind: 'neighborhood', nhood: b.neighborhood }, { fromAsk: true })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askFlow.result])

  // ── The scope ladder: the PlaceCard and the camera are ONE object ─────────
  // city → neighborhood → spot (500 m) → record. Opening a scope moves the
  // camera to frame it AND draws it on the map (glow / circle / marker halo).
  const [scope, setScopeRaw] = useState<Scope | null>(null)
  const scopeRef = useRef<Scope | null>(null)
  scopeRef.current = scope
  const [mapReady, setMapReady] = useState(false)
  // True while OUR camera flight is in progress — the zoom-demotion effect
  // must ignore programmatic moves or every scope flyTo would self-dismiss.
  const programmaticMoveRef = useRef(false)
  const prevGlowIdRef = useRef<number | null>(null)
  const scopedMarkerRef = useRef<HTMLElement | null>(null)

  // The single transition door. User-driven navigation clears the ask answer
  // AND the hidden thread (a different place is a different conversation);
  // ask-driven morphs (fromAsk) keep both travelling with the scope.
  const openScope = (next: Scope | null, opts?: { fromAsk?: boolean }) => {
    if (scopeKey(next) === scopeKey(scopeRef.current)) return
    if (!opts?.fromAsk) {
      askFlow.clear()
      askFlow.resetThread()
    }
    setScopeRaw(next)
  }
  // The imperative map closure calls through this ref (openScope is recreated
  // per render; the map handlers are created once).
  const openScopeRef = useRef(openScope)
  openScopeRef.current = openScope

  const isMobile = useIsMobile()

  // Commute preview — the origin is wherever you're looking (the scoped spot /
  // neighborhood centroid / record); destinations are your saved places. The
  // hook fetches routes; the effect below draws them.
  const origin = useMemo<Origin | null>(() => {
    const s = scope
    if (!s) return null
    if (s.kind === 'spot') return { lat: s.lat, lng: s.lon }
    if (s.kind === 'record') return { lat: s.point.lat, lng: s.point.lng }
    if (s.kind === 'neighborhood') {
      if (s.clickLngLat) return { lat: s.clickLngLat[1], lng: s.clickLngLat[0] }
      const meta = nbhdMetaRef.current.get(s.nhood)
      if (meta) {
        const [[minLng, minLat], [maxLng, maxLat]] = meta.bounds
        return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 }
      }
    }
    return null // city (or neighborhood before its metadata loads)
  }, [scope])
  const commute = useCommute(origin)
  const commuteMarkersRef = useRef<maplibregl.Marker[]>([])
  const candidateMarkersRef = useRef<maplibregl.Marker[]>([])
  // Live geocoder candidates for the "add a place" field — every location of a
  // searched business, shown as grey dots you can click to pick.
  const [candidates, setCandidates] = useState<PickedAddress[]>([])
  const [addFieldKey, setAddFieldKey] = useState(0)
  // Promote a candidate (a map dot OR a dropdown row — same path) to a real
  // destination: it takes the next color, the grey candidates clear, and the
  // add-field resets so you can add another.
  const pickPlace = (p: PickedAddress) => {
    commute.addDestination({ label: p.label.split(',')[0].trim(), lng: p.center[0], lat: p.center[1] })
    setCandidates([])
    setAddFieldKey((k) => k + 1)
  }
  const pickPlaceRef = useRef(pickPlace)
  pickPlaceRef.current = pickPlace

  // Draw the commute routes (color-coded lines) + a time badge at each
  // destination, whenever the results change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    if (!map.getSource('commute-routes')) {
      map.addSource('commute-routes', { type: 'geojson', data: EMPTY_FC })
      // white casing under the colored line so routes read over any basemap
      map.addLayer({
        id: 'commute-routes-casing', type: 'line', source: 'commute-routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff', 'line-opacity': 0.9,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5.5, 16, 10],
        },
      })
      map.addLayer({
        id: 'commute-routes-line', type: 'line', source: 'commute-routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'], 'line-opacity': 0.95,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 6],
        },
      })
    }

    // One line per destination. There's no selected mode anymore, so we draw a
    // single representative path — drive if we have it, else whichever mode
    // resolved — and hang every mode's time off it as one label below.
    const legsByDest = commute.destinations.map((dest) => commute.legsFor(dest.id))
    const repGeomFor = (byMode: ReturnType<typeof commute.legsFor>) => {
      for (const m of ['drive', 'bike', 'walk'] as CommuteMode[]) {
        const leg = byMode[m]
        if (leg?.ok && leg.geometry) return leg.geometry
      }
      return null
    }
    const features: Feature[] = commute.destinations.flatMap((_dest, i) => {
      const geom = repGeomFor(legsByDest[i])
      return geom ? [{ type: 'Feature', properties: { color: routeColor(i) }, geometry: geom }] : []
    })
    ;(map.getSource('commute-routes') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection', features,
    })

    // Rebuild the overlays: a colored dot at each destination, plus ONE label on
    // its route line (at the line's midpoint) reading every mode's time — 🚗 · 🚲
    // · 🚶. Modes that haven't resolved read "—", so the label is complete the
    // moment a destination exists. Dot color matches the destination's row.
    commuteMarkersRef.current.forEach((m) => m.remove())
    commuteMarkersRef.current = []
    commute.destinations.forEach((dest, i) => {
      const byMode = legsByDest[i]
      const color = routeColor(i)

      const dot = document.createElement('div')
      dot.className = 'commute-pin'
      dot.style.setProperty('--c', color)
      commuteMarkersRef.current.push(
        new maplibregl.Marker({ element: dot, anchor: 'center' }).setLngLat([dest.lng, dest.lat]).addTo(map),
      )

      // Times ride on the line: anchor the label at the geometry's midpoint when
      // we have a path, otherwise float it just above the destination dot.
      const geom = repGeomFor(byMode)
      const coords = geom?.coordinates
      const at: [number, number] = coords?.length
        ? (coords[Math.floor(coords.length / 2)] as [number, number])
        : [dest.lng, dest.lat]

      const label = document.createElement('div')
      label.className = 'commute-line-label'
      label.style.setProperty('--c', color)
      label.title = dest.label
      label.innerHTML = ENABLED_MODES.map((m) => {
        const leg = byMode[m]
        const time = leg?.ok && leg.duration_s != null ? formatDuration(leg.duration_s) : '—'
        const icon = MODES.find((x) => x.id === m)?.icon ?? ''
        return `<span class="commute-leg"><span class="commute-leg-icon" aria-hidden="true">${icon}</span>${time}</span>`
      }).join('')
      commuteMarkersRef.current.push(
        new maplibregl.Marker({ element: label, anchor: 'bottom' }).setLngLat(at).addTo(map),
      )
    })
  }, [commute.resultsByMode, commute.destinations, mapReady])

  // Grey candidate dots for the live "add a place" search — one per location of
  // the searched business. Click a dot (or its dropdown row) to pick that spot;
  // they clear on pick or when the field empties.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    candidateMarkersRef.current.forEach((m) => m.remove())
    candidateMarkersRef.current = []
    candidates.forEach((c) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'commute-candidate'
      el.title = c.label
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        pickPlaceRef.current(c)
      })
      candidateMarkersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(c.center).addTo(map),
      )
    })
  }, [candidates, mapReady])

  // Camera + drawing, ONE effect — so what the map frames and what it draws
  // can never disagree with what the card describes.
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
        map.easeTo({ center: [-122.44, 37.75], zoom: 12.4, duration: 700 })
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

  // The first-run picker waits for the map (plus a beat) before asking anything.
  useEffect(() => {
    if (!mapReady || !firstRunPicker) return
    const t = setTimeout(() => setPickerReady(true), 1200)
    return () => clearTimeout(t)
  }, [mapReady, firstRunPicker])

  // Manual-zoom demotion: crossing the threshold with a mismatched scope closes
  // the card — the drawn scope no longer frames anything legible at that zoom.
  useEffect(() => {
    if (programmaticMoveRef.current) return
    const s = scopeRef.current
    if (zoomedIn && s?.kind === 'neighborhood') openScope(null)
    if (!zoomedIn && (s?.kind === 'spot' || s?.kind === 'record')) openScope(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomedIn])

  // Neighborhood rung → the hex texture. Lazily fetched per metric (server
  // caches too), keyed to the user's leading active chip; visibility rides the
  // scope so the one-encoding rule holds (city ramp OR hex texture, never both
  // fighting — the hexes sit above the fill only inside the zoom band).
  const hexCacheRef = useRef<Map<string, FeatureCollection>>(new Map())
  const hexMetric = scope?.kind === 'neighborhood' ? hexMetricFor([...priorities]) : null
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
    const cached = hexCacheRef.current.get(hexMetric)
    if (cached) show(cached)
    else {
      fetchHexTrajectory(hexMetric)
        .then((fc) => { hexCacheRef.current.set(hexMetric, fc); show(fc) })
        .catch(() => {}) // texture is an enhancement — its absence breaks nothing
    }
    return () => { stale = true }
  }, [hexMetric, mapReady])

  // Spot rung → fetch the report (stale-guarded; works even if the address was
  // picked before the map finished loading — the camera effect waits on
  // mapReady, the data doesn't have to).
  useEffect(() => {
    if (scope?.kind !== 'spot') {
      setReport(null)
      return
    }
    setReportLoading(true)
    setReport(null)
    let stale = false
    fetchReport(scope.lat, scope.lon)
      .then((r) => { if (!stale) setReport(r) })
      .catch((err) => {
        console.error('report failed:', err)
        if (!stale) openScope(null)
      })
      .finally(() => { if (!stale) setReportLoading(false) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey(scope)])

  // Drive the trajectory overlay's "breathing": write a per-polygon sine into the
  // `pulse` feature-state each frame. Cheap — ~36 features, one repaint per frame.
  const stopPulse = () => {
    if (pulseRafRef.current != null) {
      cancelAnimationFrame(pulseRafRef.current)
      pulseRafRef.current = null
    }
  }
  const startPulse = () => {
    const map = mapRef.current
    if (!map || pulseRafRef.current != null || !pulseMetaRef.current.length) return
    const speed = 0.00105 // rad/ms → ~6s per breath (slow, calm)
    const tick = (ts: number) => {
      for (const m of pulseMetaRef.current) {
        map.setFeatureState(
          { source: 'nbhd', id: m.id },
          { pulse: 0.5 + 0.5 * Math.sin(ts * speed + m.phase) },
        )
      }
      pulseRafRef.current = requestAnimationFrame(tick)
    }
    pulseRafRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    // On phones the 3D tilt + free rotation are a liability: one-finger pan,
    // pinch-zoom and an accidental two-finger twist all fight each other. Open
    // flat and north-up, and lock rotation/pitch gestures below.
    const isMobileInit =
      typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAPTILER_KEY
        ? `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`
        : 'https://demotiles.maplibre.org/style.json',
      // Open on the San Francisco peninsula. minZoom caps how far out the user
      // can pull back — the inner-Bay framing (SF + Marin, Oakland/Berkeley, down
      // to South SF) is the floor, so SF never shrinks to a lost dot on the wider
      // basemap. Calibrated against the intended framing; nudge to reframe.
      center: [-122.44, 37.75],
      zoom: 12.3,
      minZoom: 11,
      pitch: isMobileInit ? 0 : 50,
      bearing: isMobileInit ? 0 : -10,
      maxPitch: 85,
    })

    if (isMobileInit) {
      map.dragRotate.disable()
      map.touchZoomRotate.disableRotation()
      map.touchPitch?.disable()
    }

    // Real globe when zoomed out (MapLibre v5+). Guarded: if a style swap ever
    // drops projection support, the map silently stays mercator.
    map.once('style.load', () => {
      try {
        map.setProjection({ type: 'globe' })
      } catch {
        /* mercator fallback is fine */
      }
    })

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right')

    // "Take me home": the browser asks for location permission; on allow, fly to
    // the user (blue dot). Their city may have no scored neighborhoods yet — that's
    // the coverage story, not a bug. On deny/error nothing moves; the SF control
    // below always offers the one lit-up city as home.
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: false },
        fitBoundsOptions: { maxZoom: 12.5 },
        trackUserLocation: false,
        showUserLocation: true,
      }),
      'bottom-right',
    )

    // Fly back to the SF framing — the rescue hatch for anyone lost on the globe.
    const homeControl = {
      onAdd() {
        const div = document.createElement('div')
        div.className = 'maplibregl-ctrl maplibregl-ctrl-group'
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'home-sf-btn'
        btn.textContent = 'SF'
        btn.title = 'Back to San Francisco'
        btn.onclick = () =>
          map.flyTo({ center: [-122.44, 37.75], zoom: 12.3, pitch: 50, bearing: -10, duration: 2200 })
        div.appendChild(btn)
        return div
      },
      onRemove() {},
    }
    map.addControl(homeControl, 'bottom-right')
    mapRef.current = map

    // Change-point markers are DOM overlays, and MapLibre re-projects EVERY
    // attached marker on every move frame — with 3D terrain each reprojection also
    // samples elevation, so a few hundred markers reprojecting per frame is what
    // makes zooming lurch. They're hidden below STREET_ZOOM anyway, so keep them
    // OFF the map there and only attach once the user is zoomed in far enough to
    // see them. (Reveal/hide of routine alterations still happens via the gate.)
    const markers: maplibregl.Marker[] = []
    let markersOnMap = map.getZoom() >= STREET_ZOOM
    map.on('zoom', () => {
      const z = map.getZoom()
      const shouldShow = z >= STREET_ZOOM
      if (shouldShow !== markersOnMap) {
        for (const m of markers) {
          if (shouldShow) m.addTo(map)
          else m.remove()
        }
        markersOnMap = shouldShow
      }
      if (shouldShow) applyMarkerVisibility(markerElsRef.current, z)
      setZoomedIn(z >= STREET_ZOOM)
    })

    // Surface the "back to San Francisco" button the moment SF leaves the frame.
    // We test the SF center in *screen* space (project) rather than getBounds()
    // so pitch and the globe projection are handled correctly, with a margin so
    // the button appears just before SF fully slides off the edge.
    const syncSfOffscreen = () => {
      const canvas = map.getCanvas()
      const p = map.project([-122.44, 37.75])
      const margin = 48
      setSfOffscreen(
        p.x < margin ||
          p.y < margin ||
          p.x > canvas.clientWidth - margin ||
          p.y > canvas.clientHeight - margin,
      )
    }
    map.on('move', syncSfOffscreen)
    map.on('resize', syncSfOffscreen)

    const addPoint = (point: ChangePoint) => {
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
      // Respect the current mode + zoom so markers don't flash before the effects.
      applyMarkerVisibility([el], map.getZoom())
      el.title = `${point.city} · ${point.changeLabel ?? point.headline}`
      el.addEventListener('click', () => openScopeRef.current({ kind: 'record', point }))
      markerElsRef.current.push(el)
      markerByIdRef.current.set(point.id, el) // record-scope highlight lookup
      const marker = new maplibregl.Marker({ element: el }).setLngLat([point.lng, point.lat])
      if (markersOnMap) marker.addTo(map)
      markers.push(marker)
    }

    const buildChoropleth = (geo: FeatureCollection, permits: ChangePoint[]) => {
      // Trajectory stats are already baked into each feature's properties by the
      // backend (/api/sf/neighborhoods); we only render + rank here.

      // Assign stable numeric ids so feature-state (hover + preference fit) has a
      // reliable key, and remember the id ↔ neighborhood mapping for the effect.
      geo.features.forEach((f, i) => { f.id = i })
      nbhdIdsRef.current = geo.features.map((f, i) => ({
        id: i,
        nhood: String((f.properties as { nhood?: string })?.nhood ?? ''),
      }))
      nbhdMetaRef.current = new Map(
        geo.features.map((f, i) => [
          String((f.properties as { nhood?: string })?.nhood ?? ''),
          { id: i, bounds: featureBounds(f) },
        ]),
      )
      // Capture each neighborhood's REAL signals (baked in by the backend) for
      // the preference-fit effect.
      nbhdSignalsRef.current = new Map(
        geo.features.map((f) => {
          const pr = (f.properties ?? {}) as Partial<NbhdSignals> & { nhood?: string }
          return [
            String(pr.nhood ?? ''),
            {
              intensity: pr.intensity ?? 0,
              crimeTrend: pr.crimeTrend ?? 0.5,
              bizOpenTrend: pr.bizOpenTrend ?? 0.5,
              bizCloseTrend: pr.bizCloseTrend ?? 0.5,
              evictionTrend: pr.evictionTrend ?? 0.5,
              noiseTrend: pr.noiseTrend ?? 0.5,
              schoolScore: pr.schoolScore ?? 0.5,
              transitAccess: pr.transitAccess ?? 0.5,
              treeCanopy: pr.treeCanopy ?? 0.5,
              groceryAccess: pr.groceryAccess ?? 0.5,
              industryPresence: pr.industryPresence ?? 0.5,
              floodShare: pr.floodShare ?? 0.5,
              parkingPermits: pr.parkingPermits ?? 0.5,
              roadProjects: pr.roadProjects ?? 0.5,
              cannabisRetail: pr.cannabisRetail ?? 0.5,
              emsMinutes: pr.emsMinutes ?? 0.5,
              vacancyRate: pr.vacancyRate ?? 0.5,
              vacancyRateRaw: pr.vacancyRateRaw ?? null,
            },
          ]
        }),
      )

      // Trajectory overlay: rank neighborhoods by (investment, from live permits) −
      // (rising crime, real 12-vs-12-month trend from the pipeline), so the
      // diverging red↔blue ramp always spans its full range, then write the score
      // + its pulse amplitude onto each polygon. Both inputs are now real data.
      const rawTraj = geo.features.map((f) => {
        const pr = (f.properties ?? {}) as { netUnits?: number; densify?: number; taller?: number; totalCost?: number; crimeTrend?: number }
        const invest = (pr.netUnits ?? 0) * 3 + (pr.densify ?? 0) * 2 + (pr.taller ?? 0) * 2 + Math.log10((pr.totalCost ?? 0) + 1)
        return { f, raw: invest * 0.12 - (pr.crimeTrend ?? 0.5) * 2 }
      })
      const orderTraj = [...rawTraj].sort((a, b) => a.raw - b.raw)
      const denom = Math.max(1, orderTraj.length - 1)
      orderTraj.forEach((item, i) => {
        const centered = (i / denom) * 2 - 1 // −1 (worse) … 1 (better), linear by rank
        // Compress the middle toward neutral (signed gamma) so most of the city
        // reads calm cream and only clear movers take saturated color.
        const traj = Math.round(Math.sign(centered) * Math.abs(centered) ** 2.2 * 1000) / 1000
        // Only the strong movers — both extremes — breathe; ramp 0→1 across the
        // top/bottom of the range so the neutral majority stays perfectly still.
        const pulseAmp = Math.round(Math.min(1, Math.max(0, (Math.abs(traj) - 0.45) / 0.4)) * 1000) / 1000
        item.f.properties = { ...item.f.properties, traj, pulseAmp }
      })
      // Per-polygon pulse phase, spread so the map shimmers rather than blinking in
      // unison (the swing itself rides on `pulseAmp` inside trajectoryOpacity).
      pulseMetaRef.current = geo.features.map((_f, i) => ({
        id: i,
        phase: (i % 12) * ((Math.PI * 2) / 12),
      }))

      // Development hotspot per neighborhood: the $-weighted centroid of its
      // permits, so the mark (esp. the pulse blob) sits where building is actually
      // concentrated — not the geometric center of the polygon. Each permit is
      // assigned to the polygon that CONTAINS it (point-in-polygon, authoritative
      // and independent of any name field); weight by construction cost, with a
      // net-units proxy when cost is missing. Hoods with no permits fall back to
      // the area centroid.
      const bounds = geo.features.map((f) => featureBounds(f))
      const acc = geo.features.map(() => ({ x: 0, y: 0, w: 0 }))
      for (const pt of permits) {
        if (!Number.isFinite(pt.lng) || !Number.isFinite(pt.lat)) continue
        for (let i = 0; i < geo.features.length; i++) {
          const b = bounds[i]
          if (pt.lng < b[0][0] || pt.lng > b[1][0] || pt.lat < b[0][1] || pt.lat > b[1][1]) continue
          if (!pointInFeature(geo.features[i], pt.lng, pt.lat)) continue
          const w = pt.cost && pt.cost > 0 ? pt.cost : Math.abs(pt.netUnits ?? 0) * 1e5 + 1
          acc[i].x += pt.lng * w
          acc[i].y += pt.lat * w
          acc[i].w += w
          break // a permit belongs to exactly one neighborhood
        }
      }
      const hotspot = (i: number): Position =>
        acc[i].w > 0 ? [acc[i].x / acc[i].w, acc[i].y / acc[i].w] : featureCentroid(geo.features[i])

      // Per-neighborhood DOM marks for the glyph/pulse view modes. Built once,
      // hidden until a mode shows them; only clear movers (past VIZ_MARK_MIN) get
      // one so the calm middle of the city stays bare. pointer-events:none (CSS)
      // so a click falls through to the neighborhood underneath.
      for (const mk of vizMarkersRef.current) mk.remove()
      vizMarkersRef.current = geo.features.flatMap((f, i) => {
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

      // Everything the PlaceCard needs, per neighborhood — captured AFTER the
      // traj write-back so the card's verdict matches the polygon's color, and
      // typed here so no `Number(queryRenderedFeatures)` coercion survives.
      nbhdPropsRef.current = new Map(
        geo.features.map((f) => {
          const pr = (f.properties ?? {}) as Record<string, unknown> & { nhood?: string }
          const name = String(pr.nhood ?? '')
          const signals = nbhdSignalsRef.current.get(name)
          return [
            name,
            {
              ...(signals as NbhdSignals),
              nhood: name,
              permits: Number(pr.permits ?? 0),
              netUnits: Number(pr.netUnits ?? 0),
              totalCost: Number(pr.totalCost ?? 0),
              traj: Number(pr.traj ?? 0),
              descriptor: String(pr.descriptor ?? ''),
              trendsAsOf: (pr.trendsAsOf as string | null) ?? null,
            },
          ]
        }),
      )

      map.addSource('nbhd', { type: 'geojson', data: geo })

      map.addLayer({
        id: 'nbhd-fill',
        type: 'fill',
        source: 'nbhd',
        // Start hidden; the visibility effect reveals it once onboarding is
        // dismissed (the choropleth itself zoom-fades past STREET_ZOOM).
        layout: { visibility: 'none' },
        paint: {
          'fill-color': trajectoryColor(),
          'fill-opacity': trajectoryOpacity(),
        },
      })

      // The muted LAND mask: ONE big cream polygon over the whole world with SAN
      // FRANCISCO permanently punched out — so SF alone reads as vivid 'soft fill'
      // while the rest of the world stays a calm muted base (independent of hover).
      // Inserted BELOW the water layer (water keeps its natural blue) and below the
      // first symbol layer (labels stay crisp on top).
      const sfHoles = geo.features.flatMap(exteriorRings)
      map.addSource('viz-mask', { type: 'geojson', data: maskFeature(sfHoles) })
      const styleLayers = map.getStyle().layers ?? []
      const maskBefore =
        styleLayers.find((l) => l.type === 'fill' && /^water($|[_-])/i.test(l.id))?.id ??
        styleLayers.find((l) => l.type === 'symbol')?.id
      map.addLayer(
        {
          id: 'viz-wash', // kept: applyVizMode/clearVizExtras toggle this id's visibility
          type: 'fill',
          source: 'viz-mask',
          layout: { visibility: 'none' },
          paint: {
            'fill-color': '#efe8df',
            'fill-opacity': zoomFade(0.8), // strong enough to calm saturated terrain (parks/hills), not just urban gray
          },
        },
        maskBefore,
      )

      // The hex texture — "which corner is changing". Sits between the fill and
      // the borders; visible only while a neighborhood scope is open (the scope
      // effect flips visibility + hydrates the source from /api/hex-trajectory).
      // Amber = the metric rising on that block, blue = falling; intensity = |z|.
      // try/catch: the texture is an enhancement — a style-validation throw here
      // must NEVER take the borders/hover handlers below down with it.
      try {
        map.addSource('hex', { type: 'geojson', data: EMPTY_FC })
        // |z| clamped to 0..1 — reused as the per-feature factor at each zoom
        // stop (MapLibre only allows ["zoom"] in a TOP-LEVEL interpolate, so
        // the zoom curve is outside and the data expression lives in the stops).
        const zFactor = ['min', 1, ['abs', ['coalesce', ['get', 'z'], 0]]]
        map.addLayer({
          id: 'hex-fill',
          type: 'fill',
          source: 'hex',
          layout: { visibility: 'none' },
          paint: {
            'fill-color': [
              'match', ['get', 'direction'],
              'rising', '#FF9B29',
              'declining', '#355CF5',
              'rgba(0,0,0,0)',
            ] as maplibregl.DataDrivenPropertyValueSpecification<string>,
            // Zoom band ~12.5–14: fades in as a neighborhood frames, hands off
            // to the markers before street zoom (the decomposition stays intact).
            'fill-opacity': [
              'interpolate', ['linear'], ['zoom'],
              12.3, 0,
              12.8, ['*', 0.32, zFactor],
              13.6, ['*', 0.34, zFactor],
              STREET_ZOOM, ['*', 0.04, zFactor],
            ] as unknown as maplibregl.DataDrivenPropertyValueSpecification<number>,
          },
        })
      } catch (err) {
        console.error('hex texture layer failed (map continues without it):', err)
      }

      map.addLayer({
        id: 'nbhd-line',
        type: 'line',
        source: 'nbhd',
        paint: {
          // Resting borders are a faint hairline; on hover the border alone marks
          // the neighborhood — a crisp dark outline instead of a brighter fill.
          'line-color': [
            'case', ['boolean', ['feature-state', 'hover'], false], 'rgba(11,11,11,0.9)', 'rgba(11,11,11,0.28)',
          ] as maplibregl.DataDrivenPropertyValueSpecification<string>,
          'line-width': [
            'case', ['boolean', ['feature-state', 'hover'], false], 2.6, 0.8,
          ] as maplibregl.DataDrivenPropertyValueSpecification<number>,
        },
      })

      // Highlighted-neighborhood border: ONE thin crisp BLACK line, with just a
      // whisper of soft black glow so it reads as a single line, not a thick band.
      // The crisp core is the line; the faint blurred halo only softens its edge
      // outward. Both ride the `glow` feature-state (invisible until pointed at).
      const glowOn = (w: number, blur: number, op: number) =>
        ({
          'line-color': '#0b0b0b',
          'line-blur': blur,
          'line-width': ['case', ['boolean', ['feature-state', 'glow'], false], w, 0],
          'line-opacity': ['case', ['boolean', ['feature-state', 'glow'], false], op, 0],
        }) as maplibregl.LineLayerSpecification['paint']
      map.addLayer({ id: 'nbhd-glow-halo', type: 'line', source: 'nbhd', paint: glowOn(2.5, 2.5, 0.25) })
      map.addLayer({ id: 'nbhd-glow-core', type: 'line', source: 'nbhd', paint: glowOn(1.5, 0, 1) })

      // Hover: highlight + neutral verdict popup.
      let hoveredId: number | string | null = null
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'nb-popup', offset: 12 })
      popupRef.current = popup

      map.on('mousemove', 'nbhd-fill', (e) => {
        if (!e.features?.length) return
        map.getCanvas().style.cursor = 'pointer'
        const f = e.features[0]
        const newId = f.id ?? null
        if (newId !== hoveredId) {
          if (hoveredId !== null) map.setFeatureState({ source: 'nbhd', id: hoveredId }, { hover: false })
          hoveredId = newId
          if (hoveredId !== null) map.setFeatureState({ source: 'nbhd', id: hoveredId }, { hover: true })
        }
        const p = f.properties as Record<string, number | string>
        const st = hoveredId !== null ? map.getFeatureState({ source: 'nbhd', id: hoveredId }) : {}
        const { active, count } = matchInfoRef.current
        // The hover popup is a two-line PREVIEW — a scent, not a meal. The full
        // story (evidence, residents, ask) lives in the PlaceCard on click.
        const v = verdict(Number(p.traj) || 0)
        const fitLine =
          active && typeof st.match === 'number'
            ? ` · <span class="nb-pop-fit-inline">${Math.round(st.match * 100)}% fit${count > 1 ? ` on your ${count} picks` : ''}</span>`
            : ''
        // The hover is a short scent: name, one "known for" identity line, and
        // trajectory. The residents tease and the give-to-get unlock live one
        // click deeper, on the PlaceCard, where there's room to make the pitch
        // instead of crowding the highest-traffic surface with filler.
        const knownFor = KNOWN_FOR[String(p.nhood)]
        const knownLine = knownFor ? `<div class="nb-pop-known">${knownFor}</div>` : ''
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div class="nb-pop nb-pop--preview">
               <div class="nb-pop-name">${p.nhood}</div>
               ${knownLine}
               <div class="nb-pop-verdict nb-pop-verdict--${v.tone}">${v.glyph} ${v.label}${fitLine}</div>
             </div>`,
          )
          .addTo(map)
      })
      map.on('mouseleave', 'nbhd-fill', () => {
        map.getCanvas().style.cursor = ''
        if (hoveredId !== null) map.setFeatureState({ source: 'nbhd', id: hoveredId }, { hover: false })
        hoveredId = null
        popup.remove()
      })
      // The pulse is started by the paint effect once sfCount flips (layer ready).
    }

    map.on('load', () => {
      // No 3D terrain: a raster-dem + setTerrain makes MapLibre re-anchor the camera
      // to the elevation under the cursor every frame, and as DEM tiles refine that
      // anchor drifts — the map steps up and down and you "can't zoom into a parcel".
      // A flat basemap samples no elevation at all, so zoom/drag are dead smooth.

      // Hide outdoor-v2's neon route overlays — magenta bike routes ("Bicycle
      // local"/"longdistance") and the red/colored hiking trails — all of which
      // live on the `trail` source-layer. Pure noise for a neighborhood product,
      // and not something we draw. We match by source-layer rather than hardcode
      // the ~17 vendor layer IDs, so a MapTiler style bump can't silently bring
      // the lines back.
      try {
        for (const layer of map.getStyle().layers ?? []) {
          const srcLayer = (layer as { 'source-layer'?: string })['source-layer']
          if (srcLayer === 'trail') {
            map.setLayoutProperty(layer.id, 'visibility', 'none')
          }
          // Mountain peak triangles ("Mount Sutro 912 ft", …) are pure clutter at
          // city scale — hide both peak layers (the US customary-ft one and the
          // metric fallback), which live on the `mountain_peak` source-layer. A
          // future "show peaks" filter can flip these back on by source-layer.
          if (srcLayer === 'mountain_peak') {
            map.setLayoutProperty(layer.id, 'visibility', 'none')
          }
        }
      } catch {
        /* non-fatal: a validation throw just leaves the lines drawn */
      }

      // Transit stops: outdoor-v2's `Station` layer draws every named bus/tram/
      // subway stop from ~z12, which buries SF in icons at the city-wide framing.
      // We tighten it in two ways, and let it relax back as you zoom in to the
      // street. The base filter keeps `has name` (unnamed stops never show), so
      // the only question is WHICH named stops appear this far out.
      // outdoor-v2 marks the Station label `text-optional`, so the icon still
      // draws when its name is culled by label-collision — that's the bare,
      // "unnamed"-looking icons. Tie the icon to its label: no visible name,
      // no icon.
      if (map.getLayer('Station')) map.setLayoutProperty('Station', 'text-optional', false)

      const setStationScope = (z: number) => {
        if (!map.getLayer('Station')) return
        // Below street zoom, only the landmark stations — major interchanges the
        // vendor tags with subclass `station` (Caltrain, the big Muni/BART halls,
        // ferry terminals). Individual bus_stop / tram_stop / subway platforms are
        // dropped until you're zoomed in far enough to actually route by them.
        const farOut: maplibregl.FilterSpecification = [
          'all',
          ['in', 'class', 'bus', 'railway'],
          ['has', 'name'],
          ['==', 'subclass', 'station'],
        ]
        const closeIn: maplibregl.FilterSpecification = [
          'all',
          ['in', 'class', 'bus', 'railway'],
          ['has', 'name'],
        ]
        map.setFilter('Station', z >= STREET_ZOOM ? closeIn : farOut)
      }
      setStationScope(map.getZoom())
      map.on('zoom', () => setStationScope(map.getZoom()))

      // Scope drawing: the dashed circle that shows EXACTLY what a spot card is
      // counting ("within ~500 m" as pixels, not a caption nobody reads).
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

      // The scope camera/drawing effect (and anything queued before the style
      // loaded — e.g. an address picked during the initial second) starts now.
      setMapReady(true)

      // Click routing — every click sets a SCOPE; the ladder does the rest
      // (camera, drawing, card body, report fetch all key off it):
      //  - AREA zoom, click a neighborhood → neighborhood rung.
      //  - AREA zoom, click water/outside SF → close the card.
      //  - STREET zoom, click anywhere (non-marker) → spot rung (500 m report).
      map.on('click', (e) => {
        const target = e.originalEvent.target as HTMLElement | null
        if (target?.closest('.change-marker')) return
        const { lat, lng } = e.lngLat
        if (map.getZoom() < STREET_ZOOM) {
          const hits = map.queryRenderedFeatures(e.point, { layers: ['nbhd-fill'] })
          const nhood = hits.length ? String((hits[0].properties as { nhood?: string }).nhood ?? '') : ''
          openScopeRef.current(
            nhood ? { kind: 'neighborhood', nhood, clickLngLat: [lng, lat] } : null,
          )
        } else {
          openScopeRef.current({ kind: 'spot', lat, lon: lng })
        }
      })

      // The resident layer loads independently — reviews appearing (or not)
      // never blocks the map. Popup reads the ref lazily on hover.
      fetchResidentLayer()
        .then((byArea) => { residentRef.current = byArea })
        .catch(() => {}) // no reviews yet / endpoint down → popup simply omits the line

      // Local-news headlines load independently too — a card cites its sources
      // when we have them, and simply omits the section when we don't.
      fetchHeadlines()
        .then((byArea) => { headlinesRef.current = byArea })
        .catch(() => {}) // claims state not built / endpoint down → no news section

      // Only real data draws on the map — live permits + pipeline trends. The old
      // hardcoded CA "flavor points" are gone (LA/San Diego/etc. return when their
      // metros get live feeds).
      Promise.all([fetchSfPermits(), fetchNeighborhoods().catch(() => null)])
        .then(([permits, nbhd]) => {
          permits.forEach(addPoint)
          setSfCount(permits.length)
          if (nbhd) buildChoropleth(nbhd as unknown as FeatureCollection, permits)
        })
        .catch((err) => console.error('SF data failed:', err))

      // Business openings/closures (green/red) — the "block alive or dying"
      // layer next to the construction markers. Loads independently.
      fetchSfBusinessChanges()
        .then((biz) => biz.forEach(addPoint))
        .catch((err) => console.error('business changes failed:', err))
    })

    return () => {
      if (pulseRafRef.current != null) cancelAnimationFrame(pulseRafRef.current)
      pulseRafRef.current = null
      popupRef.current?.remove()
      markers.forEach((m) => m.remove())
      markerElsRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, [])

  // The zoom continuum's bookkeeping. Marker visibility and the choropleth's
  // opacity fade ride the zoom natively (listener + paint expression); this
  // effect handles what they can't: onboarding gating, the news card and the
  // "changing" flash standing down at street zoom, and the pulse.
  useEffect(() => {
    const map = mapRef.current
    // The picker sits on a LIGHT scrim — the map stays visible (and re-ranks
    // live) behind it, so the overlay never goes dark.
    if (map?.getLayer('nbhd-fill')) {
      map.setLayoutProperty('nbhd-fill', 'visibility', 'visible')
    }
    if (!zoomedIn && priorities.size === 0) startPulse()
    else stopPulse()
  }, [zoomedIn, sfCount, priorities])

  // Repaint the area overlay. Default (no preferences) = the pulsing trajectory
  // view (blue improving, red worsening); with preferences picked = a static
  // preference-fit overlay. Depends on sfCount so it runs once the layer exists.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('nbhd-fill')) return
    const items = nbhdIdsRef.current
    // Only preferences we can ground in REAL data rank the map (see GROUNDED_TAGS).
    // Selected-but-unwired chips are ignored rather than faked.
    const tags = [...priorities].filter((t) => t in GROUNDED_TAGS)

    if (tags.length === 0) {
      for (const it of items) map.setFeatureState({ source: 'nbhd', id: it.id }, { match: null })
      // The active representation mode owns the fill paint + its marks/wash. Fill
      // always applies (it zoom-fades); the marks + wash show only at area scale,
      // so they never linger over the street view.
      applyVizMode(map, vizMode, vizMarkersRef.current)
      if (zoomedIn) clearVizExtras(map, vizMarkersRef.current)
      matchInfoRef.current = { active: false, count: 0 }
      setMatchTop([])
      // Breathe only while the trajectory overlay is actually the visible view
      // (area scale, onboarding dismissed).
      if (!zoomedIn) startPulse()
      else stopPulse()
      return
    }

    // Preferences picked → static fit overlay; stand the pulse and the mode
    // marks/wash down (the fit ramp is its own, separate encoding).
    stopPulse()
    clearVizExtras(map, vizMarkersRef.current)
    // Mean fit across the chosen preferences, then min-max stretched across
    // neighborhoods so the ramp always uses its full contrast range.
    const scored = items.map((it) => {
      const signals = nbhdSignalsRef.current.get(it.nhood)
      return {
        nhood: it.nhood,
        id: it.id,
        fit: signals
          ? tags.reduce((sum, t) => sum + GROUNDED_TAGS[t](signals), 0) / tags.length
          : 0,
      }
    })
    const lo = Math.min(...scored.map((s) => s.fit))
    const hi = Math.max(...scored.map((s) => s.fit))
    const span = Math.max(1e-6, hi - lo)
    for (const s of scored) {
      map.setFeatureState({ source: 'nbhd', id: s.id }, { match: (s.fit - lo) / span })
    }
    map.setPaintProperty('nbhd-fill', 'fill-color', matchColor())
    map.setPaintProperty('nbhd-fill', 'fill-opacity', matchOpacity())
    matchInfoRef.current = { active: true, count: tags.length }
    setMatchTop(
      [...scored].sort((a, b) => b.fit - a.fit).slice(0, 3).map((s) => s.nhood).filter(Boolean),
    )
  }, [priorities, zoomedIn, sfCount, vizMode])

  const matchActive = priorities.size > 0

  return (
    <div id="app">
      {/* Top bar */}
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand">canary</span>
          <span className="brand-sep" />
          <span className="brand-sub">Real-world place intelligence for upwards mobility</span>
        </div>

        <div className="topbar-right">
          <button className="nav-quiet" onClick={() => { setDocsTab(undefined); setResearchOpen(true) }}>
            Docs
          </button>
          <button className="nav-quiet" onClick={() => setAgentsOpen(true)}>
            For AI apps
          </button>
          {/* Quiet on purpose: ONE primary CTA on the resting screen ("Choose
              what matters"). The review ask converts inside the cards, where
              the gate gives it context — not as a competing orange button. */}
          <button className="nav-quiet" onClick={() => setContributing(true)}>
            Review a neighborhood
          </button>
        </div>
      </header>

      {/* Mobile header — floating over the map (Google-Maps style). Shown only
          on phones (CSS hides the desktop .topbar there and vice-versa). The
          secondary actions collapse behind the "⋯" menu so the map stays clear. */}
      <div className="mtopbar">
        <div className="mtopbar-row">
          <span className="mtopbar-brand">canary</span>
          <div className="mtopbar-actions">
            <button
              type="button"
              className={`mmenu-btn${menuOpen ? ' is-open' : ''}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              <span className="mmenu-dots">⋯</span>
            </button>
          </div>
        </div>

        {menuOpen && (
          <>
            <div className="mmenu-scrim" onClick={() => setMenuOpen(false)} />
            <div className="mmenu" role="menu">
              <button
                role="menuitem"
                className="mmenu-item"
                onClick={() => { setMenuOpen(false); setDocsTab(undefined); setResearchOpen(true) }}
              >
                Documentation
              </button>
              <button
                role="menuitem"
                className="mmenu-item"
                onClick={() => { setMenuOpen(false); setAgentsOpen(true) }}
              >
                For AI apps
              </button>
              <button
                role="menuitem"
                className="mmenu-item is-primary"
                onClick={() => { setMenuOpen(false); setContributing(true) }}
              >
                + Review a neighborhood
              </button>
            </div>
          </>
        )}
      </div>

      {researchOpen && <Docs onClose={() => setResearchOpen(false)} initialTab={docsTab} />}

      {agentsOpen && (
        <ForAgents
          onClose={() => setAgentsOpen(false)}
          onOpenResearch={() => { setAgentsOpen(false); setDocsTab('research'); setResearchOpen(true) }}
        />
      )}

      {contributing && (
        <Contribute
          onClose={() => setContributing(false)}
          onSubmitted={unlockResidents}
          neighborhoods={nbhdIdsRef.current.map((n) => n.nhood).filter(Boolean).sort()}
        />
      )}

      {/* THE box — the card's handle. One input, docked exactly where the card
          opens, so a question and its answer are physically one column. Card
          closed, it's the front door (address or any question); card open, its
          placeholder follows the scope ("Ask about Noe Valley…"). */}
      <div className="ask-dock">
        <AddressSearch
          onPick={(s) => openScope({ kind: 'spot', lat: s.center[1], lon: s.center[0], label: s.label })}
          onAsk={runAsk}
          placeholder={
            askPlaceholderFor(scope) ?? MISSIONS.find((m) => m.id === mission)?.placeholder
          }
        />
      </div>

      {/* The PlaceCard — ONE card, one conversation, scoped to whatever the
          user is pointing at. The camera+drawing effect keeps the map framing
          exactly what it describes; the dock above is its question box. */}
      {scope && (
        <MobileSheet onClose={() => openScope(null)}>
          <PlaceCard
            scope={scope}
            onScope={openScope}
            mission={(mission as Mission) ?? null}
            nbhd={scope.kind === 'neighborhood' ? nbhdPropsRef.current.get(scope.nhood) ?? null : null}
            headlines={scope.kind === 'neighborhood' ? headlinesRef.current.get(scope.nhood) ?? [] : []}
            residents={scope.kind === 'neighborhood' ? residentRef.current.get(scope.nhood) ?? null : null}
            report={report}
            reportLoading={reportLoading}
            cityIntro={cityIntro}
            cityFacts={scope.kind === 'city' ? computeCityFacts(nbhdPropsRef.current.values()) : null}
            matchTop={matchTop}
            residentUnlocked={residentUnlocked}
            onUnlockResidents={() => setContributing(true)}
            ask={{
              busy: askFlow.busy,
              turns: askFlow.turns,
              lastQuestion: askFlow.lastQuestion,
              submit: runAsk,
            }}
          />
        </MobileSheet>
      )}

      {/* THE preference picker — the only preference surface. One screen, zero
          steps: mission tabs + the mission's question (8 grounded chips) +
          Kat's full catalog folded underneath. First run, "Choose what
          matters", and "Edit" all open THIS. Picks edit the live shortlist, so
          the map re-ranks behind the light scrim while you choose. */}
      {((firstRunPicker && pickerReady) || pickerOpen) && (
        <PreferencePicker
          mission={mission}
          onMission={handleMissionTab}
          onExplore={exploreInstead}
          contributed={residentUnlocked}
          onContribute={() => setContributing(true)}
          picks={shortlist}
          onToggle={toggleShortlist}
          onClear={clearAll}
          onDone={finishPicker}
          onClose={dismissPicker}
          firstRun={firstRunPicker}
        />
      )}

      {/* Map */}
      <div ref={mapContainer} id="map" />

      {/* Rescue hatch: when SF drifts out of frame, a bottom-center button flies
          the camera back to the lit-up city. Mirrors the "SF" map control but is
          impossible to miss for anyone lost on the globe. */}
      <button
        type="button"
        className={`recenter-fab${sfOffscreen && scope === null ? ' show' : ''}`}
        aria-hidden={!(sfOffscreen && scope === null)}
        tabIndex={sfOffscreen && scope === null ? 0 : -1}
        onClick={() => {
          const map = mapRef.current
          if (!map) return
          map.flyTo({
            center: [-122.44, 37.75],
            zoom: 12.3,
            pitch: isMobile ? 0 : 50,
            bearing: isMobile ? 0 : -10,
            duration: 2000,
          })
        }}
      >
        <span className="recenter-fab-icon" aria-hidden>⌖</span>
        Back to San Francisco
      </button>

      {/* Preferences panel — the shorthand summary of your picks. Both of its
          doors (Choose what matters / Edit) open THE picker. */}
      <MobileSheet dismissible={false} hidden={scope !== null}>
      <aside className="prefs-panel">
        <div className="prefs-head">
          <p className="prefs-eyebrow">Looking for</p>
          {shortlist.length > 0 && (
            <div className="prefs-head-actions">
              {priorities.size > 0 && (
                <button type="button" className="prefs-clear" onClick={() => setPriorities(new Set())}>
                  Clear
                </button>
              )}
              {/* Dashed, no-fill empty-state button that reopens the picker */}
              <button type="button" className="prefs-edit-ghost" onClick={() => setPickerOpen(true)}>
                Edit
              </button>
            </div>
          )}
        </div>
        {shortlist.length === 0 ? (
          <>
            <p className="prefs-hint">Tell us what matters and we’ll rank every neighborhood by fit.</p>
            <button type="button" className="prefs-cta" onClick={() => setPickerOpen(true)}>
              Choose what matters
            </button>
          </>
        ) : (
          <>
            <p className="prefs-hint">
              {priorities.size > 0
                ? `Ranking neighborhoods by your top ${priorities.size}.`
                : 'Tap a chip to rank neighborhoods by it.'}
            </p>
            <div className="prefs-tags">
              {shortlist.map((tag) => {
                const active = priorities.has(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`prefs-tag${active ? ' is-selected' : ''}`}
                    aria-pressed={active}
                    title={active ? 'Turn off' : 'Turn on'}
                    onClick={() => toggleActive(tag)}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
            {matchActive && matchTop.length > 0 && (
              <div className="prefs-result">
                <span className="prefs-result-label">Best fit</span>
                <ul className="prefs-result-list">
                  {matchTop.map((nhood) => {
                    // The WHY, per chip — trust needs the receipt, not just a rank.
                    const signals = nbhdSignalsRef.current.get(nhood)
                    const why = signals ? whyChips(signals, [...priorities]) : []
                    return (
                      <li key={nhood}>
                        <button
                          type="button"
                          className="prefs-result-item"
                          onMouseEnter={() => glowNeighborhood(nhood, true)}
                          onMouseLeave={() => glowNeighborhood(nhood, false)}
                          onFocus={() => glowNeighborhood(nhood, true)}
                          onBlur={() => glowNeighborhood(nhood, false)}
                          onClick={() => openScope({ kind: 'neighborhood', nhood })}
                        >
                          <span className="prefs-result-rank" />
                          <span className="prefs-result-body">
                            <span className="prefs-result-name">{nhood}</span>
                            {why.length > 0 && (
                              <span className="prefs-result-why">
                                {why.map((w) => `${w.chip.toLowerCase()} ${w.ok ? '✓' : '✗'}`).join(' · ')}
                              </span>
                            )}
                          </span>
                          <span className="prefs-result-go" aria-hidden="true">→</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </aside>
      </MobileSheet>

      {/* Commute preview — floats bottom-left; usable any time, comes alive once
          a spot is scoped (the origin routes run from). */}
      <aside className="commute-dock">
        <CommutePanel
          commute={commute}
          originReady={origin !== null}
          onAddPick={pickPlace}
          onSuggestions={setCandidates}
          addFieldKey={addFieldKey}
        />
      </aside>

      {/* Bottom legend strip — swaps with the mode */}
      <footer className="legend-strip">
        {zoomedIn ? (
          <>
            <div className="legend-item">
              <span className="legend-dot" style={{ background: KIND_COLOR.construction }} />
              Permit · Construction
            </div>
            <div className="legend-item">
              <span className="legend-dot" style={{ background: KIND_COLOR.opening }} />
              Business Opening
            </div>
            <div className="legend-item">
              <span className="legend-dot" style={{ background: KIND_COLOR.closure }} />
              Business Closure
            </div>
            <div className="legend-item legend-size">
              <span className="legend-dot sz-s" style={{ background: '#999' }} />
              <span className="legend-dot sz-l" style={{ background: '#999' }} />
              dot size = $ value
            </div>
            <div className="legend-hint">{mapCaption(true, priorities.size)}</div>
          </>
        ) : matchActive ? (
          <>
            <div className="legend-item legend-ramp">
              <span>weaker fit</span>
              <span
                className="ramp-bar"
                style={{
                  background: `linear-gradient(90deg, ${MATCH_STOPS.map(
                    ([s, c]) => `${c} ${s * 100}%`,
                  ).join(', ')})`,
                }}
              />
              <span>stronger fit</span>
            </div>
            <div className="legend-hint">{mapCaption(false, priorities.size, hexMetric ? HEX_METRIC_LABEL[hexMetric] : null)}</div>
          </>
        ) : (
          <>
            <div className="legend-item legend-ramp">
              <span>getting worse</span>
              <span
                className="ramp-bar"
                style={{
                  background: `linear-gradient(90deg, ${TRAJECTORY_STOPS.map(
                    ([s, c]) => `${c} ${((s + 1) / 2) * 100}%`,
                  ).join(', ')})`,
                }}
              />
              <span>getting better</span>
            </div>
            <div className="viz-toggle" role="group" aria-label="Trajectory style">
              <span className="viz-toggle-label">style</span>
              {VIZ_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`viz-toggle-btn${vizMode === m.key ? ' is-on' : ''}`}
                  aria-pressed={vizMode === m.key}
                  onClick={() => setVizMode(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="legend-hint">{mapCaption(false, 0, hexMetric ? HEX_METRIC_LABEL[hexMetric] : null)}</div>
          </>
        )}
      </footer>

    </div>
  )
}

export default App
