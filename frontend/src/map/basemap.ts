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

// The one true transfer stations SF reads as landmarks — the Market St subway
// halls where every Muni Metro line converges, plus the Caltrain terminal and
// the two well-connected Central Subway stops. These are the ONLY `station`s we
// keep at city scale (see wireStationZoomScope). Names are matched exactly
// against the vendor `name`, so surface platforms that share a street name
// ("Church Street & 18th Street" vs the "Church" hall) never sneak in.
const LANDMARK_STATIONS = [
  // Market St subway (Muni Metro) — the underground interchange halls
  'Embarcadero',
  'Montgomery Street',
  'Powell Street',
  'Civic Center',
  'Van Ness',
  'Church',
  'Castro',
  'Forest Hill',
  'West Portal',
  // Caltrain terminal / T-Third
  'San Francisco 4th & King Street',
  // Central Subway — new, and each connects to the Market St spine
  'Chinatown-Rose Pak',
  'Union Square/Market Street',
]

// The one ferry landmark that reads at city scale: the Ferry Building, an
// actual transfer hub (ferries + F-line + Muni Metro/BART at Embarcadero). The
// vendor's `Transport` layer tags a dozen ferry terminals the same way — Pier
// 41 Gate 1/2, Red & White Fleet, Oracle Park, Alcatraz, Treasure Island… —
// so, exactly like the rail stations, we curate rather than trust the tag.
const LANDMARK_FERRIES = ['San Francisco Ferry Building', 'Ferry Building']

// Transit stops: outdoor-v2's `Station` layer draws every named bus/tram/
// subway stop from ~z12, which buries SF in icons at the city-wide framing.
// We tighten it hard when zoomed out and let it relax back at the street.
// outdoor-v2 marks the Station label `text-optional`, so the icon still
// draws when its name is culled by label-collision — that's the bare,
// "unnamed"-looking icons. Tie the icon to its label: no visible name,
// no icon.
export function wireStationZoomScope(map: maplibregl.Map) {
  // Never a bare, label-less icon on either transit layer: if the name can't
  // place, drop the icon with it. (outdoor-v2 defaults both to text-optional.)
  if (map.getLayer('Station')) map.setLayoutProperty('Station', 'text-optional', false)
  if (map.getLayer('Transport')) map.setLayoutProperty('Transport', 'text-optional', false)

  // The `Transport` layer (ferries, plus non-transit parking/bike/car POIs)
  // ships street-only (z14+). Let it *reach* zoom-out so the landmark ferry can
  // show there — the filter below, not the zoom range, decides what actually
  // draws that far out.
  if (map.getLayer('Transport')) map.setLayerZoomRange('Transport', 11, 24)

  // The vendor's full `Transport` filter — every POI class it draws at street
  // zoom. We restore exactly this once past STREET_ZOOM so nothing vendor-side
  // is lost; zoom-out swaps in the landmark-ferry-only filter instead.
  const transportCloseIn: maplibregl.FilterSpecification = [
    'all',
    ['==', '$type', 'Point'],
    [
      'in',
      'class',
      'aerialway', 'bicycle', 'bicycle_parking', 'car', 'car_rental',
      'car_repair', 'cycle_barrier', 'ferry_terminal', 'harbor',
      'motorcycle_parking', 'parking', 'parking_garage', 'parking_paid',
    ],
  ]

  const setStationScope = (z: number) => {
    if (map.getLayer('Transport')) {
      // Below street zoom, the only Transport POI worth a label is the landmark
      // ferry hub — everything else (parking, bike racks, minor ferry gates)
      // waits until you're zoomed in.
      const ferryFarOut: maplibregl.FilterSpecification = [
        'all',
        ['==', 'class', 'ferry_terminal'],
        ['in', 'name', ...LANDMARK_FERRIES],
      ]
      map.setFilter('Transport', z >= STREET_ZOOM ? transportCloseIn : ferryFarOut)
    }
    if (!map.getLayer('Station')) return
    // Below street zoom, only the genuine transfer hubs. The vendor is no help
    // here: it tags EVERY light-rail platform (Marin Street, Evans, Judah & La
    // Playa…) with the same subclass `station` as the real Muni Metro halls,
    // and its `rank` is a local label-collision priority, not importance —
    // sparse outlying stops score rank 1 and win the label fight while the
    // downtown interchanges get culled. So we curate: keep ALL BART
    // (subclass `subway`) plus a hand-picked allowlist of the Muni Metro /
    // Caltrain landmarks. Everything else waits until you're zoomed in far
    // enough to actually route by it.
    const farOut: maplibregl.FilterSpecification = [
      'all',
      ['has', 'name'],
      [
        'any',
        ['==', 'subclass', 'subway'],
        ['in', 'name', ...LANDMARK_STATIONS],
      ],
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
