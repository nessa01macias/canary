// The orchestrator. App owns the STATE (scope, preferences, mission, gate,
// commute origin) and WIRES the pieces together; the machinery lives in named
// modules so each concern can be read — and worked on — alone:
//   map/basemap        the stage: constructor, controls, vendor-style taming
//   map/choropleth     neighborhood data prep + layer stack + hover
//   map/paint          color ramps + fill paint expressions
//   map/vizModes       the trajectory-representation compare toggle
//   map/changeMarkers  permit/business marker DOM
//   map/use*           drawing hooks (scope camera, commute, hex, pulse)
//   TopBar / PrefsPanel / LegendStrip / RecenterFab   chrome components
//   PlaceCard / PreferencePicker / CommutePanel / …   the product surfaces

import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection } from 'geojson'
import type { ChangePoint } from './lib/samplePoints'
import { fetchSfPermits } from './lib/sfPermits'
import { fetchNeighborhoods } from './lib/neighborhoods'
import { fetchSfBusinessChanges } from './lib/bizChanges'
import { fetchResidentLayer, type ResidentAgg } from './lib/residentLayer'
import { fetchHeadlines, type Headline } from './lib/claims'
import { fetchReport, type AddressReport } from './lib/report'
import { Contribute } from './components/Contribute'
import { Docs } from './components/Docs'
import { ForAgents } from './components/ForAgents'
import { MobileSheet, useIsMobile } from './components/MobileSheet'
import { AddressSearch, type PickedAddress } from './components/AddressSearch'
import { PlaceCard, askPlaceholderFor } from './components/PlaceCard'
import { TopBar } from './components/TopBar'
import { PrefsPanel } from './components/PrefsPanel'
import { LegendStrip } from './components/LegendStrip'
import { RecenterFab } from './components/RecenterFab'
import { PreferencePicker } from './components/PreferencePicker'
import { CommutePanel } from './components/CommutePanel'
import { useAsk, type Mission } from './lib/useAsk'
import { useCommute, type Origin } from './lib/commute'
import { GROUNDED_TAGS, computeCityFacts, whyChips, type NbhdCardData, type NbhdSignals } from './lib/interpreter'
import { scopeKey, scopeToAskContext, type Scope } from './lib/scope'
import { HEX_METRIC_LABEL, hexMetricFor } from './lib/hexLayer'
import { logGateCompleted } from './lib/gateEvents'
import { MAX_PICKS, MISSIONS } from './lib/missions'
import { SF_CENTER, SF_ZOOM, STREET_ZOOM } from './map/constants'
import { matchColor, matchOpacity } from './map/paint'
import { applyVizMode, buildVizMarkers, clearVizExtras, type VizMode } from './map/vizModes'
import { permitHotspots } from './map/geometry'
import { createBaseMap, declutterBasemap, wireStationZoomScope } from './map/basemap'
import { applyMarkerVisibility, createChangeMarkerElement } from './map/changeMarkers'
import { addNbhdLayers, prepareNbhdData, wireNbhdHover, type NbhdMeta } from './map/choropleth'
import { usePulse } from './map/usePulse'
import { useCandidateDots, useCommuteRoutesLayer } from './map/useCommuteLayer'
import { useHexTexture } from './map/useHexTexture'
import { addScopeCircleLayers, useScopeCamera } from './map/useScopeCamera'
import './App.css'

function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerElsRef = useRef<HTMLElement[]>([])
  const popupRef = useRef<maplibregl.Popup | null>(null)
  // Neighborhood lookups, captured once when the choropleth is built (see
  // prepareNbhdData for what each holds and why).
  const nbhdIdsRef = useRef<Array<{ id: number; nhood: string }>>([])
  const nbhdMetaRef = useRef<Map<string, NbhdMeta>>(new Map())
  const nbhdSignalsRef = useRef<Map<string, NbhdSignals>>(new Map())
  const nbhdPropsRef = useRef<Map<string, NbhdCardData>>(new Map())
  // marker id → its DOM element, for the record rung's .is-scope highlight.
  const markerByIdRef = useRef<Map<string, HTMLElement>>(new Map())
  // neighborhood name → k-anonymised resident-review aggregates (the moat's read
  // side, GET /api/resident-layer). Read lazily by the PlaceCard.
  const residentRef = useRef<Map<string, ResidentAgg>>(new Map())
  // neighborhood name → recent local-news headlines (the CLAIMS tier, GET
  // /api/claims). Read lazily by the PlaceCard so a card can cite where its
  // picture comes from; empty for areas outside the news pilot.
  const headlinesRef = useRef<Map<string, Headline[]>>(new Map())
  // Read by the (once-created) hover popup closure to append a fit line.
  const matchInfoRef = useRef<{ active: boolean; count: number }>({ active: false, count: 0 })
  // The "breathing" trajectory overlay (rAF writing the pulse feature-state).
  const pulse = usePulse(mapRef)
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
  const [researchOpen, setResearchOpen] = useState(false)
  const [docsTab, setDocsTab] = useState<string | undefined>(undefined)
  const [agentsOpen, setAgentsOpen] = useState(false)
  // One layer, zoom as the axis: past STREET_ZOOM the map is about individual
  // permits/businesses; below it, area trajectory.
  const [zoomedIn, setZoomedIn] = useState(false)
  // SF is the one lit-up city, so when it's panned/zoomed out of the viewport we
  // surface a bottom-center "back to SF" button (see the map init effect).
  const [sfOffscreen, setSfOffscreen] = useState(false)
  const zoomToCity = () => {
    const map = mapRef.current
    if (map && map.getZoom() >= STREET_ZOOM) map.easeTo({ zoom: 12.4, duration: 700 })
  }
  const [priorities, setPriorities] = useState<Set<string>>(new Set())
  // The shortlist = the chips shown in the panel (chosen in THE picker). `priorities`
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
  // The picker's receipt line, shown on the city rung after chips seed.
  const [cityIntro, setCityIntro] = useState<string | null>(null)

  // Picker: add/remove a field from the shortlist (activating it on add). The
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

  // Full reset from the picker's "Clear" button.
  const clearAll = () => {
    setShortlist([])
    setPriorities(new Set())
  }

  // Best-fit list → map. Hover glows the neighborhood's border; click flies the map
  // to fit it (via the neighborhood scope).
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

  // Camera + drawing for the scope (the circle, pin, glow, marker halo — and
  // the flight that frames them). Returns the programmatic-move flag so the
  // demotion rule below can tell OUR flights from the user's own zooming.
  const { programmaticMoveRef } = useScopeCamera({
    mapRef, mapReady, scope, isMobile, nbhdMetaRef, markerByIdRef,
  })

  // Manual-zoom demotion: crossing the threshold with a mismatched scope closes
  // the card — the drawn scope no longer frames anything legible at that zoom.
  useEffect(() => {
    if (programmaticMoveRef.current) return
    const s = scopeRef.current
    if (zoomedIn && s?.kind === 'neighborhood') openScope(null)
    if (!zoomedIn && (s?.kind === 'spot' || s?.kind === 'record')) openScope(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomedIn])

  // Commute preview — the origin is wherever you're looking (the scoped spot /
  // neighborhood centroid / record); destinations are your saved places. The
  // useCommute hook fetches routes; the layer hooks below draw them.
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
  useCommuteRoutesLayer(mapRef, mapReady, commute)
  useCandidateDots(mapRef, mapReady, candidates, pickPlace)

  // The first-run picker waits for the map (plus a beat) before asking anything.
  useEffect(() => {
    if (!mapReady || !firstRunPicker) return
    const t = setTimeout(() => setPickerReady(true), 1200)
    return () => clearTimeout(t)
  }, [mapReady, firstRunPicker])

  // Neighborhood rung → the hex texture, keyed to the leading active chip.
  const hexMetric = scope?.kind === 'neighborhood' ? hexMetricFor([...priorities]) : null
  useHexTexture(mapRef, mapReady, hexMetric)

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

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const isMobileInit =
      typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
    const map = createBaseMap(mapContainer.current, isMobileInit)
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
      const p = map.project(SF_CENTER)
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
      const el = createChangeMarkerElement(point, () => openScopeRef.current({ kind: 'record', point }))
      // Respect the current mode + zoom so markers don't flash before the effects.
      applyMarkerVisibility([el], map.getZoom())
      markerElsRef.current.push(el)
      markerByIdRef.current.set(point.id, el) // record-scope highlight lookup
      const marker = new maplibregl.Marker({ element: el }).setLngLat([point.lng, point.lat])
      if (markersOnMap) marker.addTo(map)
      markers.push(marker)
    }

    const buildChoropleth = (geo: FeatureCollection, permits: ChangePoint[]) => {
      const data = prepareNbhdData(geo)
      nbhdIdsRef.current = data.ids
      nbhdMetaRef.current = data.meta
      nbhdSignalsRef.current = data.signals
      nbhdPropsRef.current = data.props
      pulse.setMeta(data.pulseMeta)

      addNbhdLayers(map, geo)

      for (const mk of vizMarkersRef.current) mk.remove()
      vizMarkersRef.current = buildVizMarkers(map, geo, permitHotspots(geo, permits))

      popupRef.current = wireNbhdHover(map, () => matchInfoRef.current)
      // The pulse is started by the paint effect once sfCount flips (layer ready).
    }

    map.on('load', () => {
      declutterBasemap(map)
      wireStationZoomScope(map)
      addScopeCircleLayers(map)

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
      // never blocks the map. The PlaceCard reads the ref lazily.
      fetchResidentLayer()
        .then((byArea) => { residentRef.current = byArea })
        .catch(() => {}) // no reviews yet / endpoint down → card simply omits the values

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
      pulse.stop()
      popupRef.current?.remove()
      markers.forEach((m) => m.remove())
      markerElsRef.current = []
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The zoom continuum's bookkeeping. Marker visibility and the choropleth's
  // opacity fade ride the zoom natively (listener + paint expression); this
  // effect handles what they can't: layer reveal and the pulse standing down
  // at street zoom.
  useEffect(() => {
    const map = mapRef.current
    // The picker sits on a LIGHT scrim — the map stays visible (and re-ranks
    // live) behind it, so the overlay never goes dark.
    if (map?.getLayer('nbhd-fill')) {
      map.setLayoutProperty('nbhd-fill', 'visibility', 'visible')
    }
    if (!zoomedIn && priorities.size === 0) pulse.start()
    else pulse.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomedIn, sfCount, priorities])

  // Repaint the area overlay. Default (no preferences) = the trajectory view in
  // the active viz mode; with preferences picked = a static preference-fit
  // overlay. Depends on sfCount so it runs once the layer exists.
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
      // (area scale, no fit overlay).
      if (!zoomedIn) pulse.start()
      else pulse.stop()
      return
    }

    // Preferences picked → static fit overlay; stand the pulse and the mode
    // marks/wash down (the fit ramp is its own, separate encoding).
    pulse.stop()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorities, zoomedIn, sfCount, vizMode])

  const matchActive = priorities.size > 0

  return (
    <div id="app">
      <TopBar
        onOpenDocs={() => { setDocsTab(undefined); setResearchOpen(true) }}
        onOpenAgents={() => setAgentsOpen(true)}
        onContribute={() => setContributing(true)}
      />

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

      <RecenterFab
        show={sfOffscreen && scope === null}
        onRecenter={() =>
          mapRef.current?.flyTo({
            center: SF_CENTER,
            zoom: SF_ZOOM,
            pitch: isMobile ? 0 : 50,
            bearing: isMobile ? 0 : -10,
            duration: 2000,
          })
        }
      />

      {/* Preferences panel — the shorthand summary of your picks. Both of its
          doors (Choose what matters / Edit) open THE picker. */}
      <MobileSheet dismissible={false} hidden={scope !== null}>
        <PrefsPanel
          shortlist={shortlist}
          priorities={priorities}
          matchTop={matchTop}
          onOpenPicker={() => setPickerOpen(true)}
          onToggleActive={toggleActive}
          onClearActive={() => setPriorities(new Set())}
          whyFor={(nhood) => {
            const signals = nbhdSignalsRef.current.get(nhood)
            return signals ? whyChips(signals, [...priorities]) : []
          }}
          onGlowNeighborhood={glowNeighborhood}
          onOpenNeighborhood={(nhood) => openScope({ kind: 'neighborhood', nhood })}
        />
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

      <LegendStrip
        zoomedIn={zoomedIn}
        matchActive={matchActive}
        prioritiesCount={priorities.size}
        hexMetricLabel={hexMetric ? HEX_METRIC_LABEL[hexMetric] : null}
        vizMode={vizMode}
        onVizMode={setVizMode}
      />
    </div>
  )
}

export default App
