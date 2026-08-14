import { useCallback, useEffect, useRef } from 'react'
import { DOT_GLOBE_HEIGHT, DOT_GLOBE_POINTS, DOT_GLOBE_WIDTH } from './dotGlobeData'

// Vector (SVG) reproduction of public/background_image.png — see
// dotGlobeData.ts for how the points were derived. Renders as scalable
// circles instead of a raster image, so it stays crisp at any size and can
// be recolored/themed via CSS.
//
// Each point is two stacked circles: a static ink base (the halftone image
// itself, unchanged) and an orange "glow" overlay on top, invisible by
// default. Hovering finds the nearest dot to the cursor and lights it plus
// a flare-shaped neighborhood around it — done via direct DOM refs, not
// React state, so hovering never re-renders the ~1250 points making up the
// graphic.

// The source halftone is (almost) a perfect square grid — column/row
// spacing jitters between 15.0 and 15.5 units from rounding in the
// original sampling script, so naive "nearest multiple of ~15.3" offset
// math is unreliable. Instead, index every point by which of the sorted
// unique x/y values it actually sits on — exact regardless of that jitter
// — then look up neighbors by integer (col, row) offset. The data is
// sparse (halftone: no dot where the source image was white), so a lookup
// simply comes back empty where there's nothing to light.
const sortedUnique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b)
const xIndex = new Map(sortedUnique(DOT_GLOBE_POINTS.map((p) => p[0])).map((x, i) => [x, i]))
const yIndex = new Map(sortedUnique(DOT_GLOBE_POINTS.map((p) => p[1])).map((y, i) => [y, i]))
const COL_ROW: [number, number][] = DOT_GLOBE_POINTS.map(([x, y]) => [xIndex.get(x)!, yIndex.get(y)!])
const GRID_LOOKUP = new Map(COL_ROW.map(([col, row], i) => [`${col},${row}`, i]))

// Radius already encodes local darkness (halftone convention: bigger dot =
// darker source pixel), but every dot was rendered fully opaque regardless
// — so the sparse, small-radius dots at the edges of a shape (or in a
// naturally faint band within it) still read as crisp black points, not a
// fade. Scaling opacity by radius turns those low-density regions into an
// actual soft fade toward white instead of a hard seam of tiny black dots.
// Exponent >1 pushes the smallest dots even fainter than a linear mapping
// would, without flattening the mid-range too much.
const MAX_RADIUS = Math.max(...DOT_GLOBE_POINTS.map((p) => p[2]))
const baseOpacity = (r: number) => (r / MAX_RADIUS) ** 1.3

// A slow ±25% size "breathing" pulse (see @keyframes landing-dot-pulse in
// landing.css, which animates the SVG `r` attribute directly — not a CSS
// transform: scale, which would have no natural ceiling and risked
// overlapping neighbors) makes the graphic read as alive rather than
// static. Growth is capped at MAX_RADIUS — the same value that keeps every
// dot touching-but-not-overlapping at rest (see the "touching not
// overlapping" sizing) — so a dot already at or near that ceiling can only
// shrink and return, never grow past it into its neighbors. Random per-dot
// delay/duration, computed once here (not per render — the points are
// static module data): a negative delay drops each dot into a random point
// in its OWN cycle immediately, instead of every dot starting in lockstep
// and only drifting apart after its delay elapses — varied duration keeps
// them from ever settling back into sync.
const PULSE_STYLE = DOT_GLOBE_POINTS.map(([, , r]) => ({
  '--pulse-r-min': (r * 0.75).toFixed(3),
  '--pulse-r-max': Math.min(r * 1.25, MAX_RADIUS).toFixed(3),
  animationDelay: `${(-Math.random() * 6).toFixed(2)}s`,
  animationDuration: `${(3 + Math.random() * 3).toFixed(2)}s`,
} as React.CSSProperties))

// Flare shape, relative to the hovered dot at (0,0). Ring 1 is the solid
// core (full 8-neighbor square, diagonals included); every ring past that
// is a single spike per axis — just the four cardinal points at that
// distance, no diagonals and no "knight's move" positions — which is what
// reads as a clean diamond/star point instead of a jagged square edge.
const CARDINAL_RING = (dist: number): [number, number][] => [
  [-dist, 0], [dist, 0], [0, -dist], [0, dist],
]
// The ambient mini-flare's own (much smaller) shape — just the four
// touching neighbors, reusing CARDINAL_RING(1) rather than a bespoke offset
// list since it's the exact same "no diagonals" cross shape.
const FLARE_ARM_OFFSETS = CARDINAL_RING(1)

const RINGS: { className: string; offsets: [number, number][] }[] = [
  {
    className: 'is-hover-ring1',
    offsets: [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1], [0, 1],
      [1, -1], [1, 0], [1, 1],
    ],
  },
  { className: 'is-hover-ring2', offsets: CARDINAL_RING(2) },
  { className: 'is-hover-ring3', offsets: CARDINAL_RING(3) },
  { className: 'is-hover-ring4', offsets: CARDINAL_RING(4) },
  { className: 'is-hover-ring5', offsets: CARDINAL_RING(5) },
  { className: 'is-hover-ring6', offsets: CARDINAL_RING(6) },
  { className: 'is-hover-ring7', offsets: CARDINAL_RING(7) },
]

type HoverState = { center: number | null; rings: number[][] }
const EMPTY_HOVER: HoverState = { center: null, rings: RINGS.map(() => []) }

// One entry per currently-active mini-flare, keyed by EVERY member index
// (center and all arms each map to the same descriptor) so any of the
// hover-move, mini-flare-fire, or ripple-sweep code paths can look up "which
// flare group does this dot belong to" from whichever single index they
// happen to be looking at. extinguish(immediate) is how a ripple consumes a
// flare early — see useMiniFlares for what "immediate" changes.
type FlareGroupDescriptor = {
  indices: number[]
  timerId: number | null
  // The inline-style fade-out scheduled by extinguish(false) — one per
  // member of the group, since each schedules its own (landing.css's shared
  // transition is too snappy to read as decay, see extinguish below).
  // Tracked so useMiniFlares' unmount cleanup can cancel them too, not just
  // the hold timer.
  fadeTimerIds: number[]
  extinguish: (immediate: boolean) => void
}

// Shared by the hover-move and mini-flare-fire code paths — either one can
// be the side that "arrives second" at a given dot, so both need the same
// answer to "is this dot currently part of the hover shape".
const isIndexHovered = (hover: HoverState, i: number) => (
  hover.center === i || hover.rings.some((ring) => ring.includes(i))
)

// A mini-flare's own fade-OUT (see useMiniFlares) and the ripple wave's own
// fade-OUT (see useRippleWave) are both driven by an inline opacity/
// transition override, not a class — and inline style always beats any CSS
// class, hover's included. Without this, hovering a dot mid-fade left that
// override in place: the hover classes got added correctly, but the glow
// stayed forced toward opacity 0 by the stale inline style, so the dot went
// dark (just the plain ink circle showing) instead of lighting up.
const clearInlineFade = (glow: SVGCircleElement | null | undefined) => {
  if (!glow) return
  glow.style.opacity = ''
  glow.style.transition = ''
}

function useHoverGlow(
  points: readonly (readonly [number, number, number])[],
  glowRefs: React.RefObject<(SVGCircleElement | null)[]>,
  hoverRef: React.RefObject<HoverState>,
  activeMiniFlares: React.RefObject<Set<number>>,
  activeFlareGroups: React.RefObject<Map<number, FlareGroupDescriptor>>,
  firedRipples: React.RefObject<Set<number>>,
  fireRipple: (originIdx: number) => void,
) {
  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number | null>(null)
  // Updated on every mousemove regardless of throttle state, so the rAF
  // callback below always reads the latest position by the time it actually
  // runs — closing over the event that scheduled the frame instead would
  // use a stale position for every mousemove event dropped by the `if
  // (rafRef.current != null) return` throttle during fast cursor movement.
  const latestPointRef = useRef({ x: 0, y: 0 })

  const clearHover = () => {
    const prev = hoverRef.current
    if (prev.center !== null) {
      glowRefs.current[prev.center]?.classList.remove('is-hover-center')
    }
    prev.rings.forEach((indices, ringIdx) => {
      indices.forEach((i) => glowRefs.current[i]?.classList.remove(RINGS[ringIdx].className))
    })
    hoverRef.current = EMPTY_HOVER
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    latestPointRef.current = { x: e.clientX, y: e.clientY }
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const svg = svgRef.current
      const ctm = svg?.getScreenCTM()
      if (!svg || !ctm) return
      const screenPoint = svg.createSVGPoint()
      screenPoint.x = latestPointRef.current.x
      screenPoint.y = latestPointRef.current.y
      const local = screenPoint.matrixTransform(ctm.inverse())

      let nearestIdx = -1
      let nearestDist = Infinity
      for (let i = 0; i < points.length; i++) {
        const dx = points[i][0] - local.x
        const dy = points[i][1] - local.y
        const d = dx * dx + dy * dy
        if (d < nearestDist) { nearestDist = d; nearestIdx = i }
      }
      if (nearestIdx === -1) return
      if (nearestIdx === hoverRef.current.center) return

      const [col, row] = COL_ROW[nearestIdx]
      const rings = RINGS.map(({ offsets }) => offsets
        .map(([dc, dr]) => GRID_LOOKUP.get(`${col + dc},${row + dr}`))
        .filter((i): i is number => i !== undefined))

      clearHover()
      const center = glowRefs.current[nearestIdx]
      clearInlineFade(center)
      center?.classList.add('is-hover-center')
      rings.forEach((indices, ringIdx) => {
        indices.forEach((i) => {
          const glow = glowRefs.current[i]
          clearInlineFade(glow)
          glow?.classList.add(RINGS[ringIdx].className)
        })
      })
      hoverRef.current = { center: nearestIdx, rings }

      // Landing on (or sweeping the flare shape across) a dot that's
      // currently an active ambient mini-flare triggers the ripple — once
      // per distinct mini-flare instance, not on every mousemove tick while
      // the shape keeps grazing the same still-active one (see firedRipples,
      // cleared when that instance's own lifecycle ends in useMiniFlares).
      const touched = [nearestIdx, ...rings.flat()].find(
        (i) => activeMiniFlares.current.has(i) && !firedRipples.current.has(i),
      )
      if (touched !== undefined) {
        firedRipples.current.add(touched)
        fireRipple(touched)
        // The mini-flare that triggered the ripple disappears immediately
        // rather than running out its own hold/fade — it's been "consumed".
        activeFlareGroups.current.get(touched)?.extinguish(true)
      }
    })
  }

  const handleMouseLeave = () => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    clearHover()
  }

  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }, [])

  return { svgRef, handleMouseMove, handleMouseLeave }
}

// Random, occasional sparks across the map, independent of the cursor —
// makes the graphic feel alive even before anyone hovers it. Each flare is a
// small cross: one center dot ('is-mini-flare') plus its four touching
// neighbors ('is-mini-flare-arm', fainter — see FLARE_ARM_OFFSETS), all the
// SAME glow circles used for hover, toggled by class the same direct-DOM-ref
// way as hover so it never re-renders the ~1250 points. If a flare lands on
// a dot the cursor's flare shape is already touching, that triggers the
// ripple wave (see useRippleWave) instead of a local color change — and the
// flare itself is extinguished immediately rather than running its own
// hold/fade, since the ripple has "consumed" it.
function useMiniFlares(
  pointCount: number,
  glowRefs: React.RefObject<(SVGCircleElement | null)[]>,
  hoverRef: React.RefObject<HoverState>,
  activeMiniFlares: React.RefObject<Set<number>>,
  activeFlareGroups: React.RefObject<Map<number, FlareGroupDescriptor>>,
  firedRipples: React.RefObject<Set<number>>,
  fireRipple: (originIdx: number) => void,
) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let timeoutId: number
    // Every descriptor with a still-pending hold or fade timer — so unmount
    // can cancel them all, not just the next scheduled `fire`. Without this,
    // a flare mid-hold or mid-fade when DotGlobe unmounts (e.g. navigating
    // off the landing page) keeps its timers running for up to ~6s after,
    // touching detached SVG nodes.
    const liveDescriptors = new Set<FlareGroupDescriptor>()

    const fire = () => {
      const centerIdx = Math.floor(Math.random() * pointCount)
      const [col, row] = COL_ROW[centerIdx]
      const armIdxs = FLARE_ARM_OFFSETS
        .map(([dc, dr]) => GRID_LOOKUP.get(`${col + dc},${row + dr}`))
        .filter((i): i is number => i !== undefined)
      const group: { i: number; cls: string }[] = [
        { i: centerIdx, cls: 'is-mini-flare' },
        ...armIdxs.map((i) => ({ i, cls: 'is-mini-flare-arm' })),
      ]

      // Shared cleanup for every way this flare's life can end: its own
      // hold/fade timing out naturally (immediate=false), or a ripple
      // consuming it early — either the one it triggered (see the touched
      // check below) or a DIFFERENT ripple sweeping over it later (see
      // useRippleWave's stepAll, which looks this descriptor up too and
      // calls extinguish(true) on it) — "the ripple resets the map" as it
      // passes through any mini-flares still active.
      const descriptor: FlareGroupDescriptor = {
        indices: group.map(({ i }) => i),
        timerId: null,
        fadeTimerIds: [],
        extinguish: (immediate) => {
          if (descriptor.timerId != null) { window.clearTimeout(descriptor.timerId); descriptor.timerId = null }
          group.forEach(({ i, cls }) => {
            activeMiniFlares.current.delete(i)
            firedRipples.current.delete(i)
            if (activeFlareGroups.current.get(i) === descriptor) activeFlareGroups.current.delete(i)
            const glow = glowRefs.current[i]
            if (immediate) {
              // Consumed by a ripple — gone now, no lingering fade (the
              // shared CSS opacity/fill transition still eases the class
              // change itself, see landing.css, just with no extra delay
              // tacked on).
              glow?.classList.remove(cls)
              return
            }
            if (isIndexHovered(hoverRef.current, i)) {
              // Still being hovered right as the ambient flare ends — snap
              // off like a normal hover exit instead of layering in a slow
              // fade under the cursor.
              glow?.classList.remove(cls)
              return
            }
            // Full brightness for a beat, then hand off to a slow eased-out
            // fade — an abrupt class removal reads as a blink, not a spark
            // dying down. The shared hover transition (landing.css) stays a
            // snappy 0.2s on purpose, so this fade is done via an inline
            // style override instead of a class, long enough to actually
            // read as decay.
            if (glow) {
              glow.style.transition = 'opacity 4.4s cubic-bezier(0.22, 1, 0.36, 1)'
              glow.style.opacity = '0'
            }
            const fadeTimerId = window.setTimeout(() => {
              glow?.classList.remove(cls)
              if (glow) { glow.style.opacity = ''; glow.style.transition = '' }
              descriptor.fadeTimerIds = descriptor.fadeTimerIds.filter((id) => id !== fadeTimerId)
              if (descriptor.fadeTimerIds.length === 0) liveDescriptors.delete(descriptor)
            }, 4400)
            descriptor.fadeTimerIds.push(fadeTimerId)
          })
          if (immediate) liveDescriptors.delete(descriptor)
        },
      }

      liveDescriptors.add(descriptor)
      group.forEach(({ i, cls }) => {
        activeMiniFlares.current.add(i)
        activeFlareGroups.current.set(i, descriptor)
        glowRefs.current[i]?.classList.add(cls)
      })

      // This ambient flare just appeared on top of a dot the cursor's flare
      // shape already covers — same one-shot-per-instance dedup as the
      // hover-move side of this check (see useHoverGlow).
      const touched = group.find(
        ({ i }) => isIndexHovered(hoverRef.current, i) && !firedRipples.current.has(i),
      )
      if (touched) {
        firedRipples.current.add(touched.i)
        fireRipple(touched.i)
        descriptor.extinguish(true)
      } else {
        const holdMs = 1800 + Math.random() * 1800
        descriptor.timerId = window.setTimeout(() => descriptor.extinguish(false), holdMs)
      }

      // Half as often as the previous 500-1700ms range.
      timeoutId = window.setTimeout(fire, 1000 + Math.random() * 2400)
    }
    timeoutId = window.setTimeout(fire, 1000 + Math.random() * 2400)

    return () => {
      window.clearTimeout(timeoutId)
      liveDescriptors.forEach((d) => {
        if (d.timerId != null) window.clearTimeout(d.timerId)
        d.fadeTimerIds.forEach((id) => window.clearTimeout(id))
      })
      liveDescriptors.clear()
    }
  }, [pointCount, glowRefs, hoverRef, activeMiniFlares, activeFlareGroups, firedRipples, fireRipple])
}

// The payoff for touching a mini-flare: a SOLID disc of amber expands
// outward from the touched dot and fills the whole map — a small fixed-
// width traveling band was tried first and read as a donut/ring, and
// releasing every dot at once the moment the fill finished read as an
// abrupt drop to black. This is the resolution of both: a SECOND wave (the
// release front) starts from the origin the instant the fill front reaches
// the map's edge, retracing the exact same path outward and releasing each
// dot as it goes — same two-front band mechanic as the "donut" version,
// just with the band width equal to that ripple's own farthest distance
// (maxRadius) instead of a small constant, so the gap between the two
// fronts spans the entire map. A donut-shaped hole opens at the center once
// the release front starts and grows outward until it's consumed the whole
// filled disc. Distances from the origin are computed once per trigger
// (trivial for ~1250 points) and pre-sorted, so the per-frame loop only
// ever touches the handful of dots actually entering or releasing that
// frame, not all ~1250 every frame.
const RIPPLE_SPEED = 400 // viewBox units/second each front travels at
const RIPPLE_FADE_MS = 600
// More than this many ripples running at once and a new trigger is just
// dropped — the encounter that would have fired it is already recorded in
// firedRipples (see useHoverGlow/useMiniFlares), so it never queues up to
// fire later either. A decorative effect has no business doing more than a
// handful of these at a time regardless of how fast someone waves the
// cursor across mini-flares.
const MAX_CONCURRENT_RIPPLES = 3

// A perfect circle reads as a radar ping, not a ripple. Wobbling the
// activation radius by a smooth function of ANGLE (not per-dot noise, which
// would look like static) breaks that up into something organic while
// staying one coherent ring. Multiplicative, not additive, so the distortion
// grows with distance from the origin the way a real expanding wave's edge
// gets rougher the further it travels, instead of being uniformly wobbly
// close in and far out alike. Phases randomize every fire() call, so no two
// ripples wobble the same way.
const NOISE_HARMONICS = [
  { freq: 3, amp: 0.09 },
  { freq: 5, amp: 0.06 },
  { freq: 8, amp: 0.035 },
]
const wobbleAt = (angle: number, phases: number[]) => NOISE_HARMONICS.reduce(
  (sum, { freq, amp }, i) => sum + amp * Math.sin(angle * freq + phases[i]),
  0,
)

type RippleInstance = {
  order: number[]
  radii: number[] // effective (noise-perturbed) distance, indexed same as order/points
  maxRadius: number // this ripple's own farthest point — doubles as the fill/release gap
  start: number
  enterPtr: number
  releasePtr: number
}

function useRippleWave(
  points: readonly (readonly [number, number, number])[],
  glowRefs: React.RefObject<(SVGCircleElement | null)[]>,
  hoverRef: React.RefObject<HoverState>,
  activeMiniFlares: React.RefObject<Set<number>>,
  activeFlareGroups: React.RefObject<Map<number, FlareGroupDescriptor>>,
) {
  const rafRef = useRef<number | null>(null)
  const activeRipples = useRef<RippleInstance[]>([])
  // How many CURRENTLY ACTIVE ripples claim a given dot as lit right now —
  // a dot only actually starts fading once this hits 0, so if two ripples'
  // filled discs overlap, a dot both of them cover doesn't fade out just
  // because the FIRST one's release front gets there while the second still
  // wants it lit.
  const dotOwners = useRef(new Int16Array(points.length))

  const releaseDot = (i: number) => {
    dotOwners.current[i]--
    if (dotOwners.current[i] > 0) return
    const glow = glowRefs.current[i]
    if (!glow) return
    // A dot the release front is passing might currently be under the
    // cursor or mid-way through its OWN ambient lifecycle — either way,
    // something else already governs its opacity, so just drop the
    // ripple's own class and don't fight that with an inline fade (see
    // clearInlineFade for why an inline opacity override always wins,
    // even wrongly).
    if (isIndexHovered(hoverRef.current, i) || activeMiniFlares.current.has(i)) {
      glow.classList.remove('is-ripple')
      return
    }
    glow.style.transition = `opacity ${RIPPLE_FADE_MS}ms ease-out`
    glow.style.opacity = '0'
    window.setTimeout(() => {
      glow.classList.remove('is-ripple')
      glow.style.opacity = ''
      glow.style.transition = ''
    }, RIPPLE_FADE_MS)
  }

  // One shared loop advances every active ripple each frame — one
  // requestAnimationFrame regardless of how many ripples are running, not
  // one per ripple. Ripples that finish this frame are dropped from the
  // array (never cancelled out from under each other, which was the bug:
  // triggering a second ripple used to kill the first one's still-running
  // loop, permanently stranding any dots it had already lit).
  const stepAll = () => {
    const now = performance.now()
    activeRipples.current = activeRipples.current.filter((r) => {
      const wavePos = ((now - r.start) / 1000) * RIPPLE_SPEED

      while (r.enterPtr < r.order.length && r.radii[r.enterPtr] <= wavePos) {
        const idx = r.order[r.enterPtr]
        dotOwners.current[idx]++
        glowRefs.current[idx]?.classList.add('is-ripple')
        // The wave resets the map as it passes — any OTHER ambient
        // mini-flare it sweeps over is extinguished right here, immediately,
        // same as the flare that originally triggered this ripple.
        if (activeMiniFlares.current.has(idx)) activeFlareGroups.current.get(idx)?.extinguish(true)
        r.enterPtr++
      }
      // The release front trails the fill front by exactly r.maxRadius —
      // it only starts moving once the fill front has traveled the full
      // width of the map, then retraces that same path from the origin.
      const releaseWavePos = wavePos - r.maxRadius
      while (r.releasePtr < r.order.length && r.radii[r.releasePtr] <= releaseWavePos) {
        releaseDot(r.order[r.releasePtr])
        r.releasePtr++
      }

      return r.releasePtr < r.order.length
    })
    rafRef.current = activeRipples.current.length > 0 ? requestAnimationFrame(stepAll) : null
  }

  // Stable across re-renders (points/glowRefs/hoverRef/the two flare refs
  // are all module-level constants or refs, so this dependency list never
  // actually changes value) — both useMiniFlares and useHoverGlow list this
  // as an effect dependency, and a fresh identity on every parent re-render
  // (e.g. an unrelated IntersectionObserver flip elsewhere on the landing
  // page) used to tear down and restart their effects mid-flight, leaking
  // glow classes/ref entries the old cleanup never rolled back — see git
  // history for the stuck-flare bug this fixes.
  const fire = useCallback((originIdx: number) => {
    if (activeRipples.current.length >= MAX_CONCURRENT_RIPPLES) return

    const [ox, oy] = points[originIdx]
    const phases = NOISE_HARMONICS.map(() => Math.random() * Math.PI * 2)
    // radii[i] corresponds to points[i] here (not yet reordered) — sorted
    // into `order` below, same as points/distances always were.
    const radii = points.map(([x, y]) => {
      const dx = x - ox
      const dy = y - oy
      return Math.hypot(dx, dy) * (1 + wobbleAt(Math.atan2(dy, dx), phases))
    })
    const order = radii.map((_, i) => i).sort((a, b) => radii[a] - radii[b])
    const sortedRadii = order.map((i) => radii[i])

    activeRipples.current.push({
      order,
      radii: sortedRadii,
      maxRadius: sortedRadii[sortedRadii.length - 1],
      start: performance.now(),
      enterPtr: 0,
      releasePtr: 0,
    })
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(stepAll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, glowRefs, hoverRef, activeMiniFlares, activeFlareGroups])

  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }, [])

  return fire
}

export function DotGlobe({ className }: { className?: string }) {
  // Created here, not inside the hooks below — useHoverGlow, useMiniFlares,
  // and useRippleWave all read and write the SAME glow refs / hover state /
  // active-flare set, so they need to share one instance of each rather than
  // each hook owning (and the others guessing at) their own copy.
  const glowRefs = useRef<(SVGCircleElement | null)[]>([])
  const hoverRef = useRef<HoverState>(EMPTY_HOVER)
  const activeMiniFlares = useRef<Set<number>>(new Set())
  const activeFlareGroups = useRef<Map<number, FlareGroupDescriptor>>(new Map())
  const firedRipples = useRef<Set<number>>(new Set())

  const fireRipple = useRippleWave(DOT_GLOBE_POINTS, glowRefs, hoverRef, activeMiniFlares, activeFlareGroups)
  const { svgRef, handleMouseMove, handleMouseLeave } = useHoverGlow(
    DOT_GLOBE_POINTS, glowRefs, hoverRef, activeMiniFlares, activeFlareGroups, firedRipples, fireRipple,
  )
  useMiniFlares(
    DOT_GLOBE_POINTS.length, glowRefs, hoverRef, activeMiniFlares, activeFlareGroups, firedRipples, fireRipple,
  )

  return (
    <svg
      ref={svgRef}
      className={`landing-dot-globe${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${DOT_GLOBE_WIDTH} ${DOT_GLOBE_HEIGHT}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      aria-hidden="true"
    >
      <rect x={0} y={0} width={DOT_GLOBE_WIDTH} height={DOT_GLOBE_HEIGHT} fill="transparent" />
      {DOT_GLOBE_POINTS.map(([x, y, r], i) => (
        <g key={i}>
          <circle
            className="landing-dot-globe-point"
            cx={x}
            cy={y}
            r={r}
            style={{ opacity: baseOpacity(r), ...PULSE_STYLE[i] }}
          />
          <circle
            ref={(el) => { glowRefs.current[i] = el }}
            className="landing-dot-globe-glow"
            cx={x}
            cy={y}
            r={r}
            style={PULSE_STYLE[i]}
          />
        </g>
      ))}
    </svg>
  )
}
