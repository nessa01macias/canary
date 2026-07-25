import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { ChangePoint, ChangeType, Stage } from './samplePoints'
import { fetchSfPermits } from './sfPermits'
import { fetchNeighborhoods, type NbhdTrajectory } from './neighborhoods'
import type { FeatureCollection, Feature, Polygon, Position } from 'geojson'
import { Contribute } from './Contribute'
import { Docs } from './Docs'
import { fetchResidentLayer, type ResidentAgg } from './residentLayer'
import { fetchReport, type AddressReport } from './report'
import { ReportCard } from './ReportCard'
import './App.css'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY

const KIND_COLOR: Record<ChangePoint['kind'], string> = {
  construction: '#FF6624',
  closure:      '#c1443c',
  opening:      '#3f8f5c',
}

const KIND_LABEL: Record<ChangePoint['kind'], string> = {
  construction: 'Permit · Construction',
  closure:      'Business Closure',
  opening:      'Business Opening',
}

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
// trajectory overlay and the preference fit below. No placeholder hashes remain.
type NbhdSignals = {
  intensity: number      // permit-derived structural-change intensity (0..1)
  crimeTrend: number     // higher = crime rising (real, DataSF via pipeline)
  bizOpenTrend: number   // higher = business openings accelerating
  bizCloseTrend: number  // higher = closings accelerating
  evictionTrend: number  // higher = evictions rising
  noiseTrend: number     // higher = 311 noise complaints rising
}

// Preference chips we can GROUND in live data today → a real fit score in 0..1.
// Chips not in this map are ignored by the fit ranking (never faked): their data
// sources aren't wired yet, and a hash pretending otherwise is worse than honesty.
const GROUNDED_TAGS: Record<string, (s: NbhdSignals) => number> = {
  'Low crime':          (s) => 1 - s.crimeTrend,
  'Business openings':  (s) => s.bizOpenTrend,
  'Vacancy trend':      (s) => 1 - s.bizCloseTrend,
  'New construction':   (s) => s.intensity,
  'Quiet':              (s) => 1 - s.noiseTrend, // real 311 noise-complaint trend
  'Housing stability':  (s) => 1 - s.evictionTrend, // real eviction-filings trend
}

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
const trajectoryOpacity = () =>
  ['case',
    ['boolean', ['feature-state', 'hover'], false], 0.9,
    ['+',
      ['+', 0.1, ['*', 0.28, ['abs', ['coalesce', ['get', 'traj'], 0]]]],
      ['*', ['coalesce', ['feature-state', 'pulse'], 0],
        ['*', 0.2, ['coalesce', ['get', 'pulseAmp'], 0]]]],
  ] as maplibregl.DataDrivenPropertyValueSpecification<number>
const matchColor = () =>
  ['interpolate', ['linear'], ['coalesce', ['feature-state', 'match'], 0], ...MATCH_STOPS.flat()] as
    maplibregl.DataDrivenPropertyValueSpecification<string>
// match may legitimately be 0 (worst fit), so presence is tested against a
// sentinel (-1) rather than truthiness — a 0-fit area still shows, just lightest.
const matchOpacity = () =>
  ['case', ['==', ['coalesce', ['feature-state', 'match'], -1], -1],
    0.06,
    ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0.72],
  ] as maplibregl.DataDrivenPropertyValueSpecification<number>

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

  // Outer ring — comfortably larger than maxBounds so it always fills the viewport.
  const outer: Position[] = [
    [-124.6, 36.3],
    [-120.4, 36.3],
    [-120.4, 39.5],
    [-124.6, 39.5],
    [-124.6, 36.3],
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

// changeType → glyph (a channel SEPARATE from color, so no palette limit) + copy.
const CHANGE_META: Record<ChangeType, { label: string; glyph: string; blurb: string }> = {
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
const STAGE_META: Record<Stage, { label: string; hint: string; cls: string }> = {
  filed:    { label: 'Filed',    hint: 'proposed',      cls: 'stage-filed' },
  approved: { label: 'Approved', hint: 'greenlit',      cls: 'stage-approved' },
  issued:   { label: 'Issued',   hint: 'happening now', cls: 'stage-issued' },
  unknown:  { label: 'Filed',    hint: 'on record',     cls: 'stage-filed' },
}

// Marker radius encodes magnitude ($ value), on a log scale, clamped.
function markerSize(cost?: number): number {
  if (!cost || cost <= 0) return 9
  const t = (Math.log10(cost) - 4) / 3 // ~$10k→0, ~$10M→1
  return Math.round(9 + Math.max(0, Math.min(1, t)) * 13) // 9..22px
}

type Mode = 'areas' | 'permits'

// Routine "OTC alteration" permits are low-signal noise at city zoom — reveal
// them only once the user is close enough for street detail to matter.
const ALTERATION_MIN_ZOOM = 15

// Central marker visibility: markers show only in permits mode, and routine
// (`.minor`) alterations additionally require zooming past the gate above.
function applyMarkerVisibility(els: HTMLElement[], mode: Mode, zoom: number) {
  const showPermits = mode === 'permits'
  for (const el of els) {
    const minor = el.classList.contains('minor')
    el.style.display = showPermits && (!minor || zoom >= ALTERATION_MIN_ZOOM) ? '' : 'none'
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
      { label: 'Away from industry' },
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
  const modeRef = useRef<Mode>('areas')
  // Stable feature id ↔ neighborhood name, captured when the choropleth is built,
  // so the preference effect can write per-neighborhood fit into feature-state.
  const nbhdIdsRef = useRef<Array<{ id: number; nhood: string }>>([])
  // neighborhood name → its feature id + bounding box, so the Best-fit list can
  // glow the polygon on hover and fit the map to it on click.
  const nbhdMetaRef = useRef<Map<string, { id: number; bounds: [[number, number], [number, number]] }>>(new Map())
  // neighborhood name → its REAL signals (from backend-baked GeoJSON properties),
  // read by the preference-fit effect. See GROUNDED_TAGS.
  const nbhdSignalsRef = useRef<Map<string, NbhdSignals>>(new Map())
  // neighborhood name → k-anonymised resident-review aggregates (the moat's read
  // side, GET /api/resident-layer). Read lazily by the hover popup.
  const residentRef = useRef<Map<string, ResidentAgg>>(new Map())
  // Read by the (once-created) hover popup closure to append a fit line.
  const matchInfoRef = useRef<{ active: boolean; count: number }>({ active: false, count: 0 })
  // Per-polygon pulse phase (built with the choropleth) + the running rAF handle
  // that drives the "breathing" trajectory overlay.
  const pulseMetaRef = useRef<Array<{ id: number; phase: number }>>([])
  const pulseRafRef = useRef<number | null>(null)
  const [selected, setSelected] = useState<ChangePoint | null>(null)
  const [sfCount, setSfCount] = useState<number | null>(null)
  const [contributing, setContributing] = useState(false)
  // The magic-moment report: click anywhere → what's changing within ~500 m.
  const [report, setReport] = useState<AddressReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const reportPinRef = useRef<maplibregl.Marker | null>(null)
  const [researchOpen, setResearchOpen] = useState(false)
  const [traj, setTraj] = useState<NbhdTrajectory[]>([])
  const [mode, setMode] = useState<Mode>('areas')
  const [priorities, setPriorities] = useState<Set<string>>(new Set())
  // The shortlist = the chips shown in the panel (chosen in onboarding). `priorities`
  // is the ACTIVE subset that drives the map. A chip toggled off in the panel leaves
  // `priorities` but STAYS in `shortlist`, rendered as an empty-state button.
  const [shortlist, setShortlist] = useState<string[]>([])
  const [matchTop, setMatchTop] = useState<string[]>([])
  // Onboarding picker opens first so the user chooses what to rank neighborhoods by.
  const [onboardingOpen, setOnboardingOpen] = useState(true)

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
    if (!inList) setMode('areas')
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
    if (activating) setMode('areas')
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
  const zoomToNeighborhood = (nhood: string) => {
    const map = mapRef.current
    const meta = nbhdMetaRef.current.get(nhood)
    if (!map || !meta) return
    map.fitBounds(meta.bounds, {
      padding: { top: 120, bottom: 90, left: 360, right: 100 },
      duration: 900,
      maxZoom: 15,
    })
  }

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

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAPTILER_KEY
        ? `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`
        : 'https://demotiles.maplibre.org/style.json',
      // Frame on the San Francisco peninsula. This is the furthest-out view the
      // map should ever show — never the whole California/world map.
      center: [-122.44, 37.75],
      zoom: 12.3,
      // Lock the zoom-out floor to the SF framing so the world is never rendered.
      minZoom: 12.3,
      // Keep panning inside the SF Bay Area so users can't drift off to the
      // world. Kept wider than the viewport so it never overrides the zoom above.
      maxBounds: [
        [-123.2, 37.1], // south-west
        [-121.5, 38.6], // north-east
      ],
      pitch: 50,
      bearing: -10,
      maxPitch: 85,
    })

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right')
    mapRef.current = map

    // Reveal/hide routine alteration markers as the user crosses the zoom gate.
    map.on('zoom', () => applyMarkerVisibility(markerElsRef.current, modeRef.current, map.getZoom()))

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
      applyMarkerVisibility([el], modeRef.current, map.getZoom())
      el.title = `${point.city} · ${point.changeLabel ?? point.headline}`
      el.addEventListener('click', () => setSelected(point))
      markerElsRef.current.push(el)
      markers.push(
        new maplibregl.Marker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map),
      )
    }

    const buildChoropleth = (geo: FeatureCollection, trajectory: NbhdTrajectory[]) => {
      // Trajectory stats are already baked into each feature's properties by the
      // backend (/api/sf/neighborhoods); we only render + rank here.
      setTraj([...trajectory].sort((a, b) => b.intensity - a.intensity))

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
        layout: { visibility: modeRef.current === 'areas' ? 'visible' : 'none' },
        paint: {
          'fill-color': trajectoryColor(),
          'fill-opacity': trajectoryOpacity(),
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
        const fitLine =
          active && typeof st.match === 'number'
            ? `<div class="nb-pop-fit">${Math.round(st.match * 100)}% fit · ${count} filter${count > 1 ? 's' : ''}</div>`
            : ''
        // Resident layer: attributed opinion (k ≥ 3 reviewers), rendered as what
        // residents SAID — never our own quality label.
        const res = residentRef.current.get(String(p.nhood))
        const fmt = (v: number | null) => (v == null ? '–' : v.toFixed(1))
        const resLine = res
          ? `<div class="nb-pop-res">Residents (${res.n}): safety <b>${fmt(res.safety)}</b> · quiet <b>${fmt(res.noise)}</b> · getting better <b>${fmt(res.trajectory)}</b> <span class="nb-pop-res-scale">/5</span></div>`
          : ''
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div class="nb-pop">
               <div class="nb-pop-name">${p.nhood}</div>
               ${fitLine}
               <div class="nb-pop-desc">${p.descriptor}</div>
               <div class="nb-pop-stats">
                 <span><b>${p.permits}</b> permits</span>
                 <span><b>+${p.netUnits}</b> net units</span>
                 <span><b>$${(Number(p.totalCost) / 1e6).toFixed(1)}M</b></span>
               </div>
               ${resLine}
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

      // The magic moment: click anywhere → the address report for that point.
      // Marker/panel clicks are excluded (they have their own interactions).
      map.on('click', (e) => {
        const target = e.originalEvent.target as HTMLElement | null
        if (target?.closest('.change-marker')) return
        const { lat, lng } = e.lngLat
        reportPinRef.current?.remove()
        const pin = document.createElement('div')
        pin.className = 'report-pin'
        reportPinRef.current = new maplibregl.Marker({ element: pin }).setLngLat([lng, lat]).addTo(map)
        setReportOpen(true)
        setReportLoading(true)
        setReport(null)
        fetchReport(lat, lng)
          .then((r) => setReport(r))
          .catch((err) => {
            console.error('report failed:', err)
            setReportOpen(false)
            reportPinRef.current?.remove()
          })
          .finally(() => setReportLoading(false))
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
          if (nbhd) buildChoropleth(nbhd as unknown as FeatureCollection, nbhd.trajectory)
        })
        .catch((err) => console.error('SF data failed:', err))
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

  // Toggle markers ↔ choropleth when the mode changes, and run the trajectory
  // "breathing" only while the default area overlay is actually on screen.
  useEffect(() => {
    modeRef.current = mode
    const map = mapRef.current
    applyMarkerVisibility(markerElsRef.current, mode, map?.getZoom() ?? 0)
    if (map?.getLayer('nbhd-fill')) {
      map.setLayoutProperty('nbhd-fill', 'visibility', mode === 'areas' ? 'visible' : 'none')
    }
    if (mode === 'areas' && priorities.size === 0) startPulse()
    else stopPulse()
  }, [mode, sfCount, priorities])

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
      // Breathe only while the trajectory overlay is actually the visible view.
      if (mode === 'areas') startPulse()
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
  }, [priorities, mode, sfCount])

  const activeNbhds = traj.filter((t) => t.permits > 0).length
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

        <div className="mode-toggle" role="tablist" aria-label="View mode">
          <button
            role="tab"
            aria-selected={mode === 'areas'}
            className={mode === 'areas' ? 'active' : ''}
            onClick={() => setMode('areas')}
          >
            Area trajectory
          </button>
          <button
            role="tab"
            aria-selected={mode === 'permits'}
            className={mode === 'permits' ? 'active' : ''}
            onClick={() => setMode('permits')}
          >
            Individual permits
          </button>
        </div>

        <div className="topbar-right">
          <span className="live-badge">
            <span className="live-dot" />
            {sfCount === null
              ? 'Loading…'
              : mode === 'areas'
                ? `${activeNbhds} neighborhoods changing`
                : `${sfCount} live permits`}
          </span>
          <button className="research-btn" onClick={() => setResearchOpen(true)}>
            Documentation
          </button>
          <button className="contribute-btn" onClick={() => setContributing(true)}>
            + Review a neighborhood
          </button>
        </div>
      </header>

      {researchOpen && <Docs onClose={() => setResearchOpen(false)} />}

      {contributing && (
        <Contribute
          onClose={() => setContributing(false)}
          neighborhoods={nbhdIdsRef.current.map((n) => n.nhood).filter(Boolean).sort()}
        />
      )}

      {reportOpen && (
        <ReportCard
          report={report}
          loading={reportLoading}
          onClose={() => {
            setReportOpen(false)
            setReport(null)
            reportPinRef.current?.remove()
            reportPinRef.current = null
          }}
        />
      )}

      {/* Map */}
      <div ref={mapContainer} id="map" />

      {/* Preferences panel — a shorthand summary of what onboarding picked */}
      <aside className="prefs-panel">
        <div className="prefs-head">
          <p className="prefs-eyebrow">Looking for</p>
          {shortlist.length > 0 && (
            <button type="button" className="prefs-edit" onClick={() => setOnboardingOpen(true)}>
              Edit
            </button>
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
                  {matchTop.map((nhood) => (
                    <li key={nhood}>
                      <button
                        type="button"
                        className="prefs-result-item"
                        onMouseEnter={() => glowNeighborhood(nhood, true)}
                        onMouseLeave={() => glowNeighborhood(nhood, false)}
                        onFocus={() => glowNeighborhood(nhood, true)}
                        onBlur={() => glowNeighborhood(nhood, false)}
                        onClick={() => zoomToNeighborhood(nhood)}
                      >
                        <span className="prefs-result-rank" />
                        <span className="prefs-result-name">{nhood}</span>
                        <span className="prefs-result-go" aria-hidden="true">→</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </aside>

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
            <p className="prefs-eyebrow">Looking for</p>
            <h2 className="ob-title">What matters most to you?</h2>
            <p className="ob-sub">
              Pick up to {MAX_PICKS}. We’ll rank every San Francisco neighborhood by how well it fits.
            </p>

            <div className="ob-tiers">
              {PREFERENCE_TIERS.map((tier) => (
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
                          {f.label}
                          {!f.available && <span className="soon">soon</span>}
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
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
        {mode === 'permits' ? (
          <>
            <div className="legend-item">
              <span className="legend-dot" style={{ background: KIND_COLOR.construction }} />
              Permit · Construction
            </div>
            {/* closure/opening rows return when /api/changes?category=business
                markers are actually rendered — legend only advertises what's drawn */}
            <div className="legend-item legend-size">
              <span className="legend-dot sz-s" style={{ background: '#999' }} />
              <span className="legend-dot sz-l" style={{ background: '#999' }} />
              dot size = $ value
            </div>
            <div className="legend-hint">Zoom in for routine permits · click any marker</div>
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
            <div className="legend-item">
              Shading = fit to your {priorities.size} filter{priorities.size > 1 ? 's' : ''}
            </div>
            <div className="legend-hint">Darker = more of what you’re looking for</div>
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
            <div className="legend-item">Neighborhood trajectory over recent years · the strongest movers pulse</div>
            <div className="legend-hint">Hover a neighborhood for its trajectory</div>
          </>
        )}
      </footer>

      {/* Detail drawer — leads with the before→after delta */}
      {selected && (
        <div className="drawer" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
          <div className="drawer-card">
            <div className="drawer-accent" style={{ background: KIND_COLOR[selected.kind] }} />
            <button className="drawer-close" onClick={() => setSelected(null)}>×</button>

            <div className="drawer-toprow">
              <p className="drawer-kind">
                {selected.changeType ? CHANGE_META[selected.changeType].label : KIND_LABEL[selected.kind]}
              </p>
              {selected.stage && (
                <span className={`stage-badge ${STAGE_META[selected.stage].cls}`}>
                  {STAGE_META[selected.stage].label}
                  <em>· {STAGE_META[selected.stage].hint}</em>
                </span>
              )}
            </div>

            <h2 className="drawer-city">{selected.neighborhood ?? selected.city}</h2>

            {/* The delta — the whole point */}
            {selected.changeLabel && (
              <div className="delta-hero">
                <span className="delta-glyph">
                  {selected.changeType ? CHANGE_META[selected.changeType].glyph || '·' : '·'}
                </span>
                <span className="delta-text">{selected.changeLabel}</span>
              </div>
            )}
            {selected.changeType && (
              <p className="delta-blurb">{CHANGE_META[selected.changeType].blurb}</p>
            )}

            {/* Receipts: the raw before→after fields */}
            <div className="delta-chips">
              {selected.existingUse && selected.proposedUse && selected.existingUse !== selected.proposedUse && (
                <span className="chip">
                  use <b>{selected.existingUse}</b> → <b>{selected.proposedUse}</b>
                </span>
              )}
              {selected.existingUnits !== undefined && selected.proposedUnits !== undefined &&
                selected.existingUnits !== selected.proposedUnits && (
                <span className="chip">
                  units <b>{selected.existingUnits}</b> → <b>{selected.proposedUnits}</b>
                </span>
              )}
              {selected.existingStories !== undefined && selected.proposedStories !== undefined &&
                selected.existingStories !== selected.proposedStories && (
                <span className="chip">
                  stories <b>{selected.existingStories}</b> → <b>{selected.proposedStories}</b>
                </span>
              )}
              {selected.cost ? <span className="chip">est. <b>${selected.cost.toLocaleString()}</b></span> : null}
            </div>

            <p className="drawer-detail">{selected.detail}</p>
            <p className="drawer-source">⟶ {selected.source}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
