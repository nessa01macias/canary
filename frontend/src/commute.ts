// Commute preview — "if I lived here, how far are the places I actually go?"
//
// The origin is whatever spot you're evaluating (the current scope); destinations
// are your 1–3 saved places (work/school/grocery). This module owns the client
// state (persisted destinations + selected mode), the fetch to /api/commute, and
// the little formatting helpers. Drawing happens in App.tsx where the map lives.

import { useEffect, useRef, useState } from 'react'
import type { LineString } from 'geojson'
import type { PickedAddress } from './AddressSearch'

export type CommuteMode = 'drive' | 'bike' | 'walk' | 'transit'

// A destination is just a place with a color — no imposed category (not everyone
// has a "work"). The place name the user picked is its label; the color (by slot)
// is its identity on the map and in the bar.
export type Destination = {
  id: string
  label: string
  lng: number
  lat: number
}

// One origin→destination result. ok=false carries a reason the UI can explain
// (transit_unavailable, routing_unconfigured, no_route, provider_4xx…).
export type CommuteLeg = {
  id: string
  ok: boolean
  duration_s?: number | null
  distance_m?: number | null
  geometry?: LineString | null
  error?: string | null
}
export type CommuteResult = { mode: CommuteMode; legs: CommuteLeg[] }

export const MAX_DESTINATIONS = 3

// Visible travel modes. Transit is intentionally omitted for now — dev owns it.
// The seam is fully in place: the backend still answers mode:"transit" gracefully
// (transit_unavailable), the `'transit'` type below stays, and the panel already
// renders a disabled "soon" chip for any enabled:false mode. To light it up once
// the OpenTripPlanner service (over the 511 GTFS) is running, add:
//   { id: 'transit', label: 'Transit', icon: '🚇', enabled: true }
export const MODES: { id: CommuteMode; label: string; icon: string; enabled: boolean }[] = [
  { id: 'drive', label: 'Drive', icon: '🚗', enabled: true },
  { id: 'bike', label: 'Bike', icon: '🚲', enabled: true },
  { id: 'walk', label: 'Walk', icon: '🚶', enabled: true },
]

// The modes we fetch + label at once (no more picking one). Order is the label
// order on the map line. Transit stays out until its routing service is live.
export const ENABLED_MODES: CommuteMode[] = MODES.filter((m) => m.enabled).map((m) => m.id)

// Per-destination line + dot color, by slot. Green/blue/amber reads distinctly on
// the basemap and ties each map dot to its row in the bar.
export const ROUTE_COLORS = ['#2E9E7E', '#2F6BE0', '#D2762B']
export const routeColor = (i: number) => ROUTE_COLORS[i % ROUTE_COLORS.length]

const STORE_KEY = 'canary.commute.destinations.v1'

export function loadDestinations(): Destination[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as Destination[]
    return Array.isArray(arr) ? arr.slice(0, MAX_DESTINATIONS) : []
  } catch {
    return []
  }
}

function saveDestinations(dests: Destination[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(dests))
  } catch {
    /* private mode / quota — non-fatal, state just won't persist */
  }
}

// "22 min" · "1 hr 5 min" · "<1 min"
export function formatDuration(s?: number | null): string {
  if (s == null || !isFinite(s)) return '—'
  const mins = Math.round(s / 60)
  if (mins < 1) return '<1 min'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} hr ${m} min` : `${h} hr`
}

// US units — this is an SF product.
export function formatDistance(m?: number | null): string {
  if (m == null || !isFinite(m)) return ''
  const mi = m / 1609.34
  return mi < 0.1 ? `${Math.round(m / 0.3048)} ft` : `${mi.toFixed(1)} mi`
}

export function errorLabel(error?: string | null): string {
  switch (error) {
    case 'transit_unavailable': return 'Transit routing coming soon'
    case 'routing_unconfigured': return 'Routing not configured'
    case 'no_route': return 'No route found'
    default: return 'Couldn’t load route'
  }
}

export type Origin = { lat: number; lng: number }

// Small-business search over the backend's Overture Places snapshot — fills the
// gap where MapTiler's geocoder misses independents (e.g. "Palmetto Superfoods").
// Returns PickedAddress[] so it merges straight into the address field; [] on any
// error or when no snapshot is ingested yet (→ MapTiler stays the only source).
export async function searchOverturePlaces(
  query: string,
  signal?: AbortSignal,
): Promise<PickedAddress[]> {
  try {
    const res = await fetch(`/api/places/search?q=${encodeURIComponent(query)}&limit=8`, { signal })
    if (!res.ok) return []
    const rows = (await res.json()) as { id: string; label: string; center: [number, number] }[]
    return rows.map((r) => ({ id: r.id, label: r.label, center: r.center }))
  } catch {
    return []
  }
}

export async function fetchCommute(
  origin: Origin,
  destinations: Destination[],
  mode: CommuteMode,
  signal?: AbortSignal,
): Promise<CommuteResult> {
  const res = await fetch('/api/commute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      origin: { lat: origin.lat, lon: origin.lng },
      destinations: destinations.map((d) => ({ id: d.id, lat: d.lat, lon: d.lng })),
      mode,
    }),
  })
  if (!res.ok) throw new Error(`commute ${res.status}`)
  return (await res.json()) as CommuteResult
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `d_${Date.now()}_${Math.floor(Math.random() * 1e6)}`

// Legs for one destination, keyed by mode — what the map draws as a single
// label on that destination's route line (🚗 · 🚲 · 🚶). A mode missing here
// (fetch failed) or !ok reads as "—" so the label always shows every mode.
export type LegsByMode = Partial<Record<CommuteMode, CommuteLeg>>

/**
 * Client state for the commute feature. Destinations persist; every enabled
 * mode is (re)fetched in parallel whenever the origin or destinations change —
 * there's no selected mode anymore, the map line labels all of them at once.
 * With no origin (nothing scoped) or no destinations, results are empty and the
 * map draws nothing.
 */
export function useCommute(origin: Origin | null) {
  const [destinations, setDestinations] = useState<Destination[]>(() => loadDestinations())
  const [resultsByMode, setResultsByMode] = useState<Partial<Record<CommuteMode, CommuteResult>>>({})
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => saveDestinations(destinations), [destinations])

  const oLat = origin?.lat
  const oLng = origin?.lng
  useEffect(() => {
    abortRef.current?.abort()
    if (oLat == null || oLng == null || destinations.length === 0) {
      setResultsByMode({})
      setLoading(false)
      return
    }
    const ctl = new AbortController()
    abortRef.current = ctl
    setLoading(true)
    // One request per mode (each covers all destinations). A single mode failing
    // just drops out of the map — the others still label.
    Promise.all(
      ENABLED_MODES.map((m) =>
        fetchCommute({ lat: oLat, lng: oLng }, destinations, m, ctl.signal)
          .then((r) => [m, r] as const)
          .catch(() => [m, null] as const),
      ),
    ).then((entries) => {
      if (ctl.signal.aborted) return
      const next: Partial<Record<CommuteMode, CommuteResult>> = {}
      for (const [m, r] of entries) if (r) next[m] = r
      setResultsByMode(next)
      setLoading(false)
    })
    return () => ctl.abort()
  }, [oLat, oLng, destinations])

  useEffect(() => () => abortRef.current?.abort(), [])

  const addDestination = (d: Omit<Destination, 'id'>) =>
    setDestinations((cur) => (cur.length >= MAX_DESTINATIONS ? cur : [...cur, { ...d, id: newId() }]))

  const removeDestination = (id: string) =>
    setDestinations((cur) => cur.filter((x) => x.id !== id))

  // Per-destination legs grouped by mode — the shape the map label consumes.
  const legsFor = (id: string): LegsByMode => {
    const out: LegsByMode = {}
    for (const m of ENABLED_MODES) {
      const leg = resultsByMode[m]?.legs.find((l) => l.id === id)
      if (leg) out[m] = leg
    }
    return out
  }

  return {
    destinations,
    addDestination,
    removeDestination,
    resultsByMode,
    legsFor,
    loading,
    full: destinations.length >= MAX_DESTINATIONS,
  }
}

export type CommuteState = ReturnType<typeof useCommute>
