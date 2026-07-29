// The basemap: constructing the MapLibre map (SF framing, globe, controls) and
// taming the vendor style (outdoor-v2 ships trail/peak/station noise a
// neighborhood product doesn't want). Nothing here knows about Canary data —
// it's the stage, not the play.

import * as maplibregl from 'maplibre-gl'
import { SF_CENTER, SF_ZOOM, STREET_ZOOM } from './constants'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY

export function createBaseMap(container: HTMLDivElement, isMobileInit: boolean): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    style: MAPTILER_KEY
      ? `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`
      : 'https://demotiles.maplibre.org/style.json',
    // Open on the San Francisco peninsula. minZoom caps how far out the user
    // can pull back — the inner-Bay framing (SF + Marin, Oakland/Berkeley, down
    // to South SF) is the floor, so SF never shrinks to a lost dot on the wider
    // basemap. Calibrated against the intended framing; nudge to reframe.
    center: SF_CENTER,
    zoom: SF_ZOOM,
    minZoom: 11,
    pitch: isMobileInit ? 0 : 50,
    bearing: isMobileInit ? 0 : -10,
    maxPitch: 85,
  })

  // On phones the 3D tilt + free rotation are a liability: one-finger pan,
  // pinch-zoom and an accidental two-finger twist all fight each other. Open
  // flat and north-up, and lock rotation/pitch gestures.
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
        map.flyTo({ center: SF_CENTER, zoom: SF_ZOOM, pitch: 50, bearing: -10, duration: 2200 })
      div.appendChild(btn)
      return div
    },
    onRemove() {},
  }
  map.addControl(homeControl, 'bottom-right')

  return map
}

// No 3D terrain, deliberately: a raster-dem + setTerrain makes MapLibre re-anchor
// the camera to the elevation under the cursor every frame, and as DEM tiles
// refine that anchor drifts — the map steps up and down and you "can't zoom into
// a parcel". A flat basemap samples no elevation at all, so zoom/drag are dead
// smooth. Call the tuners below once the style has loaded (map.on('load')).

// Hide outdoor-v2's neon route overlays — magenta bike routes ("Bicycle
// local"/"longdistance") and the red/colored hiking trails — all of which
// live on the `trail` source-layer. Pure noise for a neighborhood product,
// and not something we draw. We match by source-layer rather than hardcode
// the ~17 vendor layer IDs, so a MapTiler style bump can't silently bring
// the lines back.
export function declutterBasemap(map: maplibregl.Map) {
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
export function wireStationZoomScope(map: maplibregl.Map) {
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
}
