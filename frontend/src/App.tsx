import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CHANGE_META, KIND_COLOR, type ChangePoint } from './samplePoints'
import { fetchSfPermits } from './sfPermits'
import { fetchNeighborhoods } from './neighborhoods'
import type { FeatureCollection, Feature, Polygon, Position } from 'geojson'
import { Contribute } from './Contribute'
import { Docs } from './Docs'
import { ForAgents } from './ForAgents'
import { fetchResidentLayer, type ResidentAgg } from './residentLayer'
import { fetchReport, type AddressReport } from './report'
import { MobileSheet, useIsMobile } from './MobileSheet'
import { fetchSfBusinessChanges } from './bizChanges'
import { AddressSearch } from './AddressSearch'
import { PlaceCard } from './PlaceCard'
import { useAsk, type Mission } from './useAsk'
import { GROUNDED_TAGS, mapCaption, verdict, whyChips, type NbhdCardData, type NbhdSignals } from './interpreter'
import { EMPTY_FC, circlePolygon, scopeKey, scopeToAskContext, type Scope } from './scope'
import { HEX_METRIC_LABEL, fetchHexTrajectory, hexMetricFor } from './hexLayer'
import { logGateCompleted } from './lib/gateEvents'
import './App.css'

// Mission → the chips it seeds, and the omnibox voice it speaks in.
const MISSIONS: { id: string; icon: string; label: string; seed: string[]; placeholder: string }[] = [
  { id: 'moving', icon: '🏠', label: 'Moving here', seed: ['Quiet', 'Low crime', 'Housing stability'],
    placeholder: 'Where should I live? Ask, or type an address…' },
  { id: 'buying', icon: '🔑', label: 'Buying a home', seed: ['New construction', 'Good schools', 'Flood risk'],
    placeholder: "What's approved to be built near…? Ask, or type an address…" },
  { id: 'opening_business', icon: '☕', label: 'Opening a business', seed: ['Business openings', 'Vacancy trend', 'Transit access'],
    placeholder: 'Where should the shop go? Ask, or type an address…' },
  { id: 'exploring', icon: '🧭', label: 'Just exploring', seed: [],
    placeholder: "Ask anything — “which neighborhoods are getting quieter?”" },
]

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY


// Diverging ramp → neighborhood TRAJECTORY over the last few years. Orange =
// worsening (e.g. crime climbing), blue = improving. The "Solar Shock" palette;
// its cream midpoint matches the app's chrome so a flat neighborhood recedes into
// the page rather than shouting. Interpolated on `traj` ∈ [-1, 1].
const TRAJECTORY_STOPS: Array<[number, string]> = [
  [-1, '#ff6624'],   // strongly worsening — deep orange
  [-0.5, '#ff9b29'], // worsening — orange
  [0, '#f2e7e1'],    // flat — cream neutral (matches the chrome)
  [0.5, '#355cf5'],  // improving — blue
  [1, '#2329a8'],    // strongly improving — indigo
]

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
  zoomFade(['case',
    ['boolean', ['feature-state', 'hover'], false], 0.9,
    ['+',
      ['+', 0.1, ['*', 0.28, ['abs', ['coalesce', ['get', 'traj'], 0]]]],
      ['*', ['coalesce', ['feature-state', 'pulse'], 0],
        ['*', 0.2, ['coalesce', ['get', 'pulseAmp'], 0]]]],
  ])
const matchColor = () =>
  ['interpolate', ['linear'], ['coalesce', ['feature-state', 'match'], 0], ...MATCH_STOPS.flat()] as
    maplibregl.DataDrivenPropertyValueSpecification<string>
// match may legitimately be 0 (worst fit), so presence is tested against a
// sentinel (-1) rather than truthiness — a 0-fit area still shows, just lightest.
const matchOpacity = () =>
  zoomFade(['case', ['==', ['coalesce', ['feature-state', 'match'], -1], -1],
    0.06,
    ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0.72],
  ])

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

// 2× the signed area of a ring (shoelace). Sign encodes winding: it's the channel
// MapLibre uses to tell an exterior ring from a hole.
function ringArea2(r: Position[]): number {
  let s = 0
  for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return s
}

// Every vertex across all neighborhood polygons — the input to the convex hull
// that defines the SF cutout.
function collectVertices(geo: FeatureCollection): Position[] {
  const pts: Position[] = []
  for (const f of geo.features) {
    const g = f.geometry
    if (g?.type === 'Polygon') for (const r of g.coordinates) pts.push(...r)
    else if (g?.type === 'MultiPolygon')
      for (const poly of g.coordinates) for (const r of poly) pts.push(...r)
  }
  return pts
}

// Andrew's monotone-chain convex hull → the tightest single ring enclosing all of
// SF. One clean polygon (no inter-neighborhood seams) is what lets the cutout show
// continuous water and parkland, instead of leaving the gaps between the individual
// neighborhood shapes — the ocean, the bay margins, big parks — flat white.
function convexHull(pts: Position[]): Position[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: Position, a: Position, b: Position) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Position[] = []
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop()
    lower.push(pt)
  }
  const upper: Position[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop()
    upper.push(pt)
  }
  lower.pop()
  upper.pop()
  const hull = lower.concat(upper)
  hull.push(hull[0]) // close the ring
  return hull
}

// One big white polygon covering the whole pannable area, with a SINGLE hole cut
// over San Francisco. Everything outside the hole is flat white; inside it the real
// basemap — water, parks, trees, streets — shows through untouched. The hole is the
// convex hull of every neighborhood vertex, expanded slightly so a margin of the
// surrounding ocean and bay reads as water rather than getting clipped to the coast.
function buildSfMask(geo: FeatureCollection): Feature<Polygon> {
  const hull = convexHull(collectVertices(geo))

  // Push each hull vertex out from the centroid so open water around the city is
  // revealed too — otherwise the hull hugs the coastline and hides the ocean/bay.
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length
  const PAD = 1.12 // ~12% ≈ a ~1.5 km ring of visible water around SF
  const sfHole: Position[] = hull.map(([x, y]) => [cx + (x - cx) * PAD, cy + (y - cy) * PAD])

  // Outer ring — the WHOLE world, so every zoom level outside SF reads as the
  // blank white globe (the mask hides the basemap everywhere but the SF hole).
  const outer: Position[] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ]
  // A hole must wind opposite the exterior or earcut fills it instead of cutting it.
  const outerSign = Math.sign(ringArea2(outer))
  const hole = Math.sign(ringArea2(sfHole)) === outerSign ? [...sfHole].reverse() : sfHole

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [outer, hole] },
  }
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

// How many priorities a user may pick in onboarding — the top-N we rank areas by.
const MAX_PICKS = 6

type PrefField = { label: string; available?: boolean }
type PrefTier = { title: string; fields: PrefField[] }

// The full field catalog the onboarding picker offers, grouped by tier. `available`
// fields are live or compute-ready today; the rest are shown but disabled ("soon")
// until their data source lands (federal feeds, the Census key, deed records…).
const PREFERENCE_TIERS: PrefTier[] = [
  {
    title: 'Fundamentals',
    fields: [
      { label: 'Good schools', available: true },
      { label: 'Low crime', available: true },
      { label: 'Short commute', available: true },
      { label: 'Low property tax', available: true },
      { label: 'Walkable', available: true },
      { label: 'Home prices' }, // Prop 13 → needs deed records / FHFA
    ],
  },
  {
    title: 'Risk & rules',
    fields: [
      { label: 'Flood risk', available: true },
      { label: 'Fire risk', available: true },
      { label: 'Zoning', available: true },
      { label: 'Jurisdiction', available: true },
      { label: 'Parking', available: true },
      { label: 'Broadband & cell' }, // federal, pending
    ],
  },
  {
    title: 'Sensory',
    fields: [
      { label: 'Quiet', available: true },       // 311
      { label: 'Tree canopy', available: true }, // tree inventory
      { label: 'Clean air' },                    // on-demand raster / federal
      { label: 'No rail noise' },
      { label: 'Away from industry', available: true }, // EPA TRI facilities
    ],
  },
  {
    title: 'Getting around',
    fields: [
      { label: 'Transit access', available: true },
      { label: 'Groceries & retail', available: true }, // Overture
      { label: 'Fast emergency response', available: true },
      { label: 'School bus routes', available: true },
      { label: 'Urgent care nearby' }, // HIFLD, pending
    ],
  },
  {
    title: 'Who lives here',
    fields: [
      { label: 'Political lean', available: true },
      { label: 'Renters vs owners' }, // needs Census key
      { label: 'Age mix' },           // needs Census key
    ],
  },
  {
    title: 'Where it’s heading',
    fields: [
      { label: 'New construction', available: true },
      { label: 'Rezoning', available: true },
      { label: 'Transit expansion', available: true },
      { label: 'Business openings', available: true }, // business velocity
      { label: 'Vacancy trend', available: true },
      { label: 'Housing stability', available: true }, // eviction-filings trend (real)
      { label: 'Road projects', available: true },
      { label: 'Liquor & cannabis', available: true },
    ],
  },
]

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
  // Read by the (once-created) hover popup closure to append a fit line.
  const matchInfoRef = useRef<{ active: boolean; count: number }>({ active: false, count: 0 })
  // Per-polygon pulse phase (built with the choropleth) + the running rAF handle
  // that drives the "breathing" trajectory overlay.
  const pulseMetaRef = useRef<Array<{ id: number; phase: number }>>([])
  const pulseRafRef = useRef<number | null>(null)
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
  // The chip catalog: reachable any time via "Choose what matters", but no longer
  // the forced first screen (the mission picker is). Open data → never gated.
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  // Mission — the personalization seed, chosen on first run. Frames every Ask
  // answer and seeds the starting chips.
  const [mission, setMission] = useState<string | null>(() => localStorage.getItem('canary_mission'))
  const [missionOpen, setMissionOpen] = useState(() => !localStorage.getItem('canary_mission'))
  // The give-to-get gate, REVERSED: the open-data chips are free; the gate is now
  // the community layer — resident reviews are unlocked by contributing one
  // (true Glassdoor timing: gate the salary page, not the front door). Persisted.
  const [residentUnlocked, setResidentUnlocked] = useState(
    () => localStorage.getItem('canary_resident_unlocked') === '1',
  )
  const unlockResidents = () => {
    localStorage.setItem('canary_resident_unlocked', '1')
    setResidentUnlocked(true)
    logGateCompleted() // fake-door numerator (>15-20% completion = flywheel real)
  }
  // The hover popup is imperative MapLibre HTML, so its handler closure would
  // capture a stale unlock flag — mirror it in a ref the builder reads live.
  const residentUnlockedRef = useRef(residentUnlocked)
  residentUnlockedRef.current = residentUnlocked
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
    setOnboardingOpen(false)
    zoomToCity()
  }

  // Mission pick → seed chips, personalize, close the picker — and show the
  // RECEIPT: the city card says what just happened and teaches the ask box at
  // the exact moment of curiosity (never silent automation).
  const pickMission = (id: string, seed?: string[]) => {
    localStorage.setItem('canary_mission', id)
    setMission(id)
    setMissionOpen(false)
    const picks = seed ?? MISSIONS.find((m) => m.id === id)?.seed ?? []
    if (picks.length) {
      applyAssistantChips(picks)
      setCityIntro(
        `Ranked all 41 neighborhoods by ${picks.map((s) => s.toLowerCase()).join(', ')}. ` +
          'Tap a best fit below — or ask me anything.',
      )
      openScope({ kind: 'city' }, { fromAsk: true })
    }
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
      // Open on the San Francisco peninsula, but let the user zoom all the way
      // out: the world renders as a blank white globe with SF as the only lit
      // patch — the coverage map IS the story (one metro colored in, more coming).
      center: [-122.44, 37.75],
      zoom: 12.3,
      minZoom: 1,
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
    // the user (blue dot). Their city may be blank white — that's the coverage
    // story, not a bug. On deny/error nothing moves; the SF control below always
    // offers the one lit-up city as home.
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

    // Reveal/hide routine alteration markers as the user crosses the zoom gate.
    map.on('zoom', () => {
      const z = map.getZoom()
      applyMarkerVisibility(markerElsRef.current, z)
      setZoomedIn(z >= STREET_ZOOM)
    })

    const markers: maplibregl.Marker[] = []

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
      markers.push(
        new maplibregl.Marker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map),
      )
    }

    const buildChoropleth = (geo: FeatureCollection) => {
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

      // Paint everything OUTSIDE San Francisco flat white, while letting the bay
      // and ocean read as water. The mask is one big polygon (the whole pannable
      // area) with the SF area punched out as one hole, inserted just below the
      // basemap's water layer so water still renders on top of the white.
      const layers = map.getStyle().layers ?? []
      const waterBeforeId =
        layers.find((l) => l.type === 'fill' && /^water($|[_-])/i.test(l.id))?.id ??
        layers.find((l) => l.type !== 'symbol' && /water/i.test(l.id))?.id ??
        layers.find((l) => l.type === 'symbol')?.id
      map.addSource('sf-mask', { type: 'geojson', data: buildSfMask(geo) })
      map.addLayer(
        {
          id: 'sf-mask-fill',
          type: 'fill',
          source: 'sf-mask',
          paint: { 'fill-color': '#ffffff', 'fill-opacity': 1 },
        },
        waterBeforeId,
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

      // The hex texture — "which corner is changing". Sits between the fill and
      // the borders; visible only while a neighborhood scope is open (the scope
      // effect flips visibility + hydrates the source from /api/hex-trajectory).
      // Amber = the metric rising on that block, blue = falling; intensity = |z|.
      map.addSource('hex', { type: 'geojson', data: EMPTY_FC })
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
          // Zoom band ~12.5–14: fades in as a neighborhood frames, hands off to
          // the markers before street zoom (the decomposition stays intact).
          'fill-opacity': [
            '*',
            ['interpolate', ['linear'], ['zoom'], 12.3, 0, 12.8, 0.32, 13.6, 0.34, STREET_ZOOM, 0.04],
            ['min', 1, ['abs', ['coalesce', ['get', 'z'], 0]]],
          ] as maplibregl.DataDrivenPropertyValueSpecification<number>,
        },
      })

      map.addLayer({
        id: 'nbhd-line',
        type: 'line',
        source: 'nbhd',
        paint: {
          'line-color': 'rgba(11,11,11,0.28)',
          'line-width': [
            'case', ['boolean', ['feature-state', 'hover'], false], 2.4, 0.8,
          ] as maplibregl.DataDrivenPropertyValueSpecification<number>,
        },
      })

      // Glowing blue border for the neighborhood the Best-fit list is pointing at.
      // Two coincident lines: a wide, blurred halo + a crisp core. Both ride the
      // `glow` feature-state, so they're invisible until the list sets it.
      const glowOn = (w: number, blur: number, op: number) =>
        ({
          'line-color': '#2f80ff',
          'line-blur': blur,
          'line-width': ['case', ['boolean', ['feature-state', 'glow'], false], w, 0],
          'line-opacity': ['case', ['boolean', ['feature-state', 'glow'], false], op, 0],
        }) as maplibregl.LineLayerSpecification['paint']
      map.addLayer({ id: 'nbhd-glow-halo', type: 'line', source: 'nbhd', paint: glowOn(11, 6, 0.6) })
      map.addLayer({ id: 'nbhd-glow-core', type: 'line', source: 'nbhd', paint: glowOn(2.5, 0.6, 1) })

      // Hover: highlight + neutral verdict popup.
      let hoveredId: number | string | null = null
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'nb-popup', offset: 12 })
      popupRef.current = popup

      map.on('mousemove', 'nbhd-fill', (e) => {
        if (!e.features?.length) return
        map.getCanvas().style.cursor = 'pointer'
        const f = e.features[0]
        if (hoveredId !== null) map.setFeatureState({ source: 'nbhd', id: hoveredId }, { hover: false })
        hoveredId = f.id ?? null
        if (hoveredId !== null) map.setFeatureState({ source: 'nbhd', id: hoveredId }, { hover: true })
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
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div class="nb-pop nb-pop--preview">
               <div class="nb-pop-name">${p.nhood}</div>
               <div class="nb-pop-verdict nb-pop-verdict--${v.tone}">${v.glyph} ${v.label}${fitLine}</div>
               <div class="nb-pop-more">click to read this area</div>
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
      if (MAPTILER_KEY) {
        map.addSource('terrain', {
          type: 'raster-dem',
          url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`,
          tileSize: 256,
        })
        map.setTerrain({ source: 'terrain', exaggeration: 1.8 })
      }

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

      // Only real data draws on the map — live permits + pipeline trends. The old
      // hardcoded CA "flavor points" are gone (LA/San Diego/etc. return when their
      // metros get live feeds).
      Promise.all([fetchSfPermits(), fetchNeighborhoods().catch(() => null)])
        .then(([permits, nbhd]) => {
          permits.forEach(addPoint)
          setSfCount(permits.length)
          if (nbhd) buildChoropleth(nbhd as unknown as FeatureCollection)
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
    // Keep the trajectory overlay dark behind the onboarding modal — it only
    // lights up once the user dismisses onboarding ("Show my map").
    const showArea = !onboardingOpen
    if (map?.getLayer('nbhd-fill')) {
      map.setLayoutProperty('nbhd-fill', 'visibility', showArea ? 'visible' : 'none')
    }
    if (showArea && !zoomedIn && priorities.size === 0) startPulse()
    else stopPulse()
  }, [zoomedIn, sfCount, priorities, onboardingOpen])

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
      map.setPaintProperty('nbhd-fill', 'fill-color', trajectoryColor())
      map.setPaintProperty('nbhd-fill', 'fill-opacity', trajectoryOpacity())
      matchInfoRef.current = { active: false, count: 0 }
      setMatchTop([])
      // Breathe only while the trajectory overlay is actually the visible view
      // (area scale, onboarding dismissed).
      if (!zoomedIn && !onboardingOpen) startPulse()
      else stopPulse()
      return
    }

    // Preferences picked → static fit overlay; stand the pulse down.
    stopPulse()
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
  }, [priorities, zoomedIn, sfCount, onboardingOpen])

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

        {/* The centerpiece: the product's promise as a control. */}
        <AddressSearch
          onPick={(s) => openScope({ kind: 'spot', lat: s.center[1], lon: s.center[0], label: s.label })}
          onAsk={runAsk}
          placeholder={MISSIONS.find((m) => m.id === mission)?.placeholder}
        />

        <div className="topbar-right">
          <button className="nav-quiet" onClick={() => { setDocsTab(undefined); setResearchOpen(true) }}>
            Docs
          </button>
          <button className="nav-quiet" onClick={() => setAgentsOpen(true)}>
            For AI apps
          </button>
          <button className="contribute-btn" onClick={() => setContributing(true)}>
            + Review a neighborhood
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

      {/* The PlaceCard — ONE card, one conversation, scoped to whatever the
          user is pointing at. The camera+drawing effect keeps the map framing
          exactly what it describes; every rung ends in an ask input. */}
      {scope && (
        <MobileSheet onClose={() => openScope(null)}>
          <PlaceCard
            scope={scope}
            onScope={openScope}
            mission={(mission as Mission) ?? null}
            nbhd={scope.kind === 'neighborhood' ? nbhdPropsRef.current.get(scope.nhood) ?? null : null}
            residents={scope.kind === 'neighborhood' ? residentRef.current.get(scope.nhood) ?? null : null}
            report={report}
            reportLoading={reportLoading}
            cityIntro={cityIntro}
            matchTop={matchTop}
            residentUnlocked={residentUnlocked}
            onUnlockResidents={() => setContributing(true)}
            ask={{
              busy: askFlow.busy,
              result: askFlow.result,
              lastQuestion: askFlow.lastQuestion,
              submit: runAsk,
            }}
          />
        </MobileSheet>
      )}

      {/* First-run mission picker — one question that personalizes everything. */}
      {missionOpen && (
        <div className="mission-overlay">
          <div className="mission-card">
            <p className="prefs-eyebrow">Welcome to Canary</p>
            <h2 className="ob-title">What brings you here?</h2>
            <p className="ob-sub">We'll tailor the map — and you can change it anytime.</p>
            <div className="mission-grid">
              {MISSIONS.map((m) => (
                <button key={m.id} className="mission-btn" onClick={() => pickMission(m.id)}>
                  <span className="mission-icon">{m.icon}</span>
                  <span className="mission-label">{m.label}</span>
                </button>
              ))}
            </div>
            <button className="mission-skip" onClick={() => { pickMission('exploring') }}>
              Skip — just show me the map
            </button>
          </div>
        </div>
      )}

      {/* Map */}
      <div ref={mapContainer} id="map" />

      {/* Preferences panel — a shorthand summary of what onboarding picked.
          Hidden until the onboarding is dismissed ("Show my map"), so it never
          peeks out behind the picker on first load or during an edit. */}
      {!onboardingOpen && (
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
              <button type="button" className="prefs-edit-ghost" onClick={() => setOnboardingOpen(true)}>
                Edit
              </button>
            </div>
          )}
        </div>
        {shortlist.length === 0 ? (
          <>
            <p className="prefs-hint">Tell us what matters and we’ll rank every neighborhood by fit.</p>
            <button type="button" className="prefs-cta" onClick={() => setOnboardingOpen(true)}>
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
      )}

      {/* Onboarding — centered picker across the full tiered field catalog */}
      {onboardingOpen && (
        <div
          className="onboarding"
          role="dialog"
          aria-modal="true"
          aria-label="Choose what matters to you"
          onClick={(e) => e.target === e.currentTarget && setOnboardingOpen(false)}
        >
          <div className="onboarding-card">
            <button className="ob-close" onClick={() => setOnboardingOpen(false)} aria-label="Close">×</button>
            <p className="prefs-eyebrow">Welcome</p>
            <h2 className="ob-title">Hey! Let’s find the best parcel for you.</h2>
            <p className="ob-sub">
              Pick up to {MAX_PICKS}. We’ll rank every San Francisco neighborhood by how well it fits.
            </p>

            <div className="ob-tiers">
              {PREFERENCE_TIERS.map((tier) => {
                // Gate reversed: the chip catalog is all open civic data, so every
                // tier is free. The give-to-get moment moved to the depth that
                // matters — resident-review details (see `residentUnlocked`).
                return (
                  <section key={tier.title} className="ob-tier">
                    <p className="ob-tier-title">{tier.title}</p>
                    <div className="prefs-tags">
                      {tier.fields.map((f) => {
                        const sel = shortlist.includes(f.label)
                        const atCap = shortlist.length >= MAX_PICKS && !sel
                        return (
                          <button
                            key={f.label}
                            type="button"
                            className={`prefs-tag${sel ? ' is-selected' : ''}${f.available ? '' : ' is-soon'}`}
                            aria-pressed={sel}
                            disabled={!f.available || atCap}
                            onClick={() => toggleShortlist(f.label)}
                          >
                            <span className="tag-label">{f.label}</span>
                            {!f.available && <span className="soon">soon</span>}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>

            <div className="ob-footer">
              <span className="ob-count">{shortlist.length} / {MAX_PICKS} selected</span>
              <div className="ob-actions">
                {shortlist.length > 0 && (
                  <button type="button" className="ob-clear" onClick={clearAll}>
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  className="ob-done"
                  disabled={shortlist.length === 0}
                  onClick={() => setOnboardingOpen(false)}
                >
                  Show my map
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
            <div className="legend-hint">{mapCaption(false, 0, hexMetric ? HEX_METRIC_LABEL[hexMetric] : null)}</div>
          </>
        )}
      </footer>

    </div>
  )
}

export default App
