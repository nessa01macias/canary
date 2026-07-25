import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { samplePoints, type ChangePoint } from './samplePoints'
import { fetchSfPermits } from './sfPermits'
import { Contribute } from './Contribute'
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

function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [selected, setSelected] = useState<ChangePoint | null>(null)
  const [sfCount, setSfCount] = useState<number | null>(null)
  const [contributing, setContributing] = useState(false)

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAPTILER_KEY
        ? `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`
        : 'https://demotiles.maplibre.org/style.json',
      center: [-119.4, 37.2],
      zoom: 5.5,
      pitch: 50,
      bearing: -10,
      maxPitch: 85,
    })

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right')
    mapRef.current = map

    const markers: maplibregl.Marker[] = []

    const addPoint = (point: ChangePoint) => {
      const el = document.createElement('div')
      el.className = 'change-marker'
      el.style.setProperty('--color', KIND_COLOR[point.kind])
      el.title = point.headline
      el.addEventListener('click', () => setSelected(point))
      markers.push(
        new maplibregl.Marker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map)
      )
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

      samplePoints.forEach(addPoint)

      fetchSfPermits()
        .then((permits) => {
          permits.forEach(addPoint)
          setSfCount(permits.length)
        })
        .catch((err) => console.error('SF permits failed:', err))
    })

    return () => {
      markers.forEach((m) => m.remove())
      map.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <div id="app">
      {/* Top bar */}
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand">canary</span>
          <span className="brand-sep" />
          <span className="brand-sub">The change layer of California</span>
        </div>
        <div className="topbar-right">
          <span className="live-badge">
            <span className="live-dot" />
            {sfCount === null ? 'Loading…' : `${sfCount} live permits`}
          </span>
          <button className="contribute-btn" onClick={() => setContributing(true)}>
            + Review a neighborhood
          </button>
        </div>
      </header>

      {contributing && <Contribute onClose={() => setContributing(false)} />}

      {/* Map */}
      <div ref={mapContainer} id="map" />

      {/* Bottom legend strip */}
      <footer className="legend-strip">
        <div className="legend-item">
          <span className="legend-dot" style={{ background: KIND_COLOR.construction }} />
          Permit · Construction
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: KIND_COLOR.closure }} />
          Business Closure
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: KIND_COLOR.opening }} />
          Business Opening
        </div>
        <div className="legend-hint">Click any marker to explore</div>
      </footer>

      {/* Detail drawer */}
      {selected && (
        <div className="drawer" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
          <div className="drawer-card">
            <div className="drawer-accent" style={{ background: KIND_COLOR[selected.kind] }} />
            <button className="drawer-close" onClick={() => setSelected(null)}>×</button>
            <p className="drawer-kind">{KIND_LABEL[selected.kind]}</p>
            <h2 className="drawer-city">{selected.city}</h2>
            <h3 className="drawer-headline">{selected.headline}</h3>
            <p className="drawer-detail">{selected.detail}</p>
            <p className="drawer-source">⟶ {selected.source}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
