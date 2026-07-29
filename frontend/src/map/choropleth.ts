// The neighborhood choropleth — three named steps, called in order once the
// GeoJSON arrives (trajectory stats are already baked into each feature's
// properties by the backend /api/sf/neighborhoods; we only render + rank here):
//   prepareNbhdData  — pure data prep: ids, bounds, signals, traj write-back,
//                      everything the PlaceCard / fit effect / pulse need
//   addNbhdLayers    — the GL layer stack (fill, wash, hex, borders, glow)
//   wireNbhdHover    — the hover outline + two-line verdict popup

import * as maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { NbhdCardData, NbhdSignals } from '../interpreter'
import { verdict } from '../interpreter'
import { KNOWN_FOR } from '../knownFor'
import { EMPTY_FC } from '../scope'
import { STREET_ZOOM } from './constants'
import { exteriorRings, featureBounds, maskFeature } from './geometry'
import { trajectoryColor, trajectoryOpacity, zoomFade } from './paint'

export type NbhdMeta = { id: number; bounds: [[number, number], [number, number]] }

// Everything the rest of the app reads about neighborhoods after build time —
// captured once here so ANY code path (ask flyto, breadcrumb, best-fit click)
// can open a neighborhood card without a map click event.
export type NbhdData = {
  // Stable feature id ↔ neighborhood name (feature-state needs a reliable key).
  ids: Array<{ id: number; nhood: string }>
  // name → feature id + bounding box (best-fit glow + fit-to-neighborhood).
  meta: Map<string, NbhdMeta>
  // name → REAL rank-normalized signals (backend-baked), for the fit effect.
  signals: Map<string, NbhdSignals>
  // name → everything the PlaceCard needs (signals + click-time stats).
  props: Map<string, NbhdCardData>
  // Per-polygon pulse phase for the "breathing" trajectory overlay.
  pulseMeta: Array<{ id: number; phase: number }>
}

export function prepareNbhdData(geo: FeatureCollection): NbhdData {
  // Assign stable numeric ids so feature-state (hover + preference fit) has a
  // reliable key, and remember the id ↔ neighborhood mapping for the effects.
  geo.features.forEach((f, i) => { f.id = i })
  const ids = geo.features.map((_f, i) => ({
    id: i,
    nhood: String((geo.features[i].properties as { nhood?: string })?.nhood ?? ''),
  }))
  const meta = new Map<string, NbhdMeta>(
    geo.features.map((f, i) => [
      String((f.properties as { nhood?: string })?.nhood ?? ''),
      { id: i, bounds: featureBounds(f) },
    ]),
  )
  // Capture each neighborhood's REAL signals (baked in by the backend) for
  // the preference-fit effect.
  const signals = new Map<string, NbhdSignals>(
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
  const pulseMeta = geo.features.map((_f, i) => ({
    id: i,
    phase: (i % 12) * ((Math.PI * 2) / 12),
  }))

  // Everything the PlaceCard needs, per neighborhood — captured AFTER the
  // traj write-back so the card's verdict matches the polygon's color, and
  // typed here so no `Number(queryRenderedFeatures)` coercion survives.
  const props = new Map<string, NbhdCardData>(
    geo.features.map((f) => {
      const pr = (f.properties ?? {}) as Record<string, unknown> & { nhood?: string }
      const name = String(pr.nhood ?? '')
      return [
        name,
        {
          ...(signals.get(name) as NbhdSignals),
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

  return { ids, meta, signals, props, pulseMeta }
}

export function addNbhdLayers(map: maplibregl.Map, geo: FeatureCollection) {
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
}

// The hover popup body — a two-line PREVIEW, a scent, not a meal: name, one
// "known for" identity line, and the trajectory verdict (+ fit % when ranking).
// The full story (evidence, residents, ask) lives in the PlaceCard on click;
// the residents tease and the give-to-get unlock live there too, where there's
// room to make the pitch instead of crowding the highest-traffic surface.
export function hoverPopupHtml(
  p: Record<string, number | string>,
  matchState: unknown,
  matchInfo: { active: boolean; count: number },
): string {
  const v = verdict(Number(p.traj) || 0)
  const fitLine =
    matchInfo.active && typeof matchState === 'number'
      ? ` · <span class="nb-pop-fit-inline">${Math.round(matchState * 100)}% fit${matchInfo.count > 1 ? ` on your ${matchInfo.count} picks` : ''}</span>`
      : ''
  const knownFor = KNOWN_FOR[String(p.nhood)]
  const knownLine = knownFor ? `<div class="nb-pop-known">${knownFor}</div>` : ''
  return `<div class="nb-pop nb-pop--preview">
       <div class="nb-pop-name">${p.nhood}</div>
       ${knownLine}
       <div class="nb-pop-verdict nb-pop-verdict--${v.tone}">${v.glyph} ${v.label}${fitLine}</div>
     </div>`
}

// Hover: outline highlight (via the `hover` feature-state the nbhd-line paint
// reads) + the verdict popup. Returns the popup so the caller can dispose it.
export function wireNbhdHover(
  map: maplibregl.Map,
  getMatchInfo: () => { active: boolean; count: number },
): maplibregl.Popup {
  let hoveredId: number | string | null = null
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'nb-popup', offset: 12 })

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
    const st = hoveredId !== null ? map.getFeatureState({ source: 'nbhd', id: hoveredId }) : {}
    popup
      .setLngLat(e.lngLat)
      .setHTML(hoverPopupHtml(f.properties as Record<string, number | string>, st.match, getMatchInfo()))
      .addTo(map)
  })
  map.on('mouseleave', 'nbhd-fill', () => {
    map.getCanvas().style.cursor = ''
    if (hoveredId !== null) map.setFeatureState({ source: 'nbhd', id: hoveredId }, { hover: false })
    hoveredId = null
    popup.remove()
  })

  return popup
}
