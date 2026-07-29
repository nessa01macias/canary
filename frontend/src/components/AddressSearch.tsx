import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

// THE address autocomplete — one component for every surface that asks for an
// address (navbar search, the commute add-a-place field, whatever comes next),
// so behavior can never diverge: real-time prefix matching (autocomplete=true),
// SF-bounded, keyboard nav, verified-pick semantics (free-typed text is never a
// pick — only selecting a real suggestion is).
// Geocoding via MapTiler (same client-safe key as the tiles).

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY
const SF_BBOX = '-122.55,37.70,-122.35,37.83'

export type PickedAddress = { id: string; label: string; center: [number, number] }
type GeoFeature = { id?: string; place_name?: string; text?: string; center?: [number, number] }

// Merge two suggestion lists, `primary` first, dropping cross-source duplicates
// (same first-segment name at ~100 m). Capped at `limit`.
function mergeCandidates(
  primary: PickedAddress[],
  secondary: PickedAddress[],
  limit: number,
): PickedAddress[] {
  const out: PickedAddress[] = []
  const seen = new Set<string>()
  for (const p of primary.concat(secondary)) {
    if (!p.center) continue
    const key = `${p.label.split(',')[0].trim().toLowerCase()}|${p.center[1].toFixed(3)},${p.center[0].toFixed(3)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= limit) break
  }
  return out
}

type Props = {
  onPick: (picked: PickedAddress) => void
  /** Fired when the user edits the text after a pick — the field is no longer verified. */
  onClear?: () => void
  /** OMNIBOX mode: Enter without picking a suggestion sends the text as a
      natural-language question (the map answers). Address picks still win. */
  onAsk?: (question: string) => void
  placeholder?: string
  /** 'navbar' = compact pill; 'form' = full-width field (CommutePanel). */
  variant?: 'navbar' | 'form'
  /** Show a ✓ once a suggestion is picked (form flows that need verified input). */
  showVerified?: boolean
  /** MapTiler geocoding `types`. Default 'address'. Pass 'poi,address' to let a
      business/place name resolve directly (e.g. "Salesforce Tower") — the caller
      opts in so the navbar/contribute flows keep their address-only behavior. */
  types?: string
  /** Max geocoding results. Default 5. Raise it to surface every location of a
      multi-location business. */
  limit?: number
  /** Fired whenever the live suggestion list changes (incl. [] on clear), so a
      parent can preview candidates — e.g. a dot per location on the map. */
  onSuggestions?: (suggestions: PickedAddress[]) => void
  /** An extra async suggestion source merged AHEAD of MapTiler (deduped) — e.g. a
      backend POI search for small businesses MapTiler's geocoder misses. */
  extraSource?: (query: string, signal: AbortSignal) => Promise<PickedAddress[]>
}

export function AddressSearch({
  onPick,
  onClear,
  onAsk,
  placeholder = 'Search any SF address — what’s changing there?',
  variant = 'navbar',
  showVerified = false,
  types = 'address',
  limit = 5,
  onSuggestions,
  extraSource,
}: Props) {
  const [q, setQ] = useState('')
  const [suggestions, setSuggestions] = useState<PickedAddress[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [picked, setPicked] = useState<PickedAddress | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const skipNextFetch = useRef(false)
  const onSuggestionsRef = useRef(onSuggestions)
  onSuggestionsRef.current = onSuggestions
  const extraSourceRef = useRef(extraSource)
  extraSourceRef.current = extraSource

  // Surface the live candidate set to the parent (for map preview dots).
  useEffect(() => {
    onSuggestionsRef.current?.(suggestions)
  }, [suggestions])

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false
      return
    }
    const query = q.trim()
    if (query.length < 3) {
      setSuggestions([])
      setOpen(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setOpen(true)
    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const ctl = new AbortController()
      abortRef.current = ctl

      // MapTiler geocoding (addresses + POIs). No key → skip; the extra source
      // can still answer.
      const fromMapTiler: Promise<PickedAddress[]> = MAPTILER_KEY
        ? fetch(
            `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json` +
              `?key=${MAPTILER_KEY}&autocomplete=true&limit=${limit}&country=us&types=${types}&bbox=${SF_BBOX}`,
            { signal: ctl.signal },
          )
            .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((data: { features?: GeoFeature[] }) =>
              (data.features ?? [])
                .filter((f): f is GeoFeature & { center: [number, number] } => !!f.center)
                .map((f, i) => ({ id: f.id ?? `mt${i}`, label: f.place_name ?? f.text ?? '', center: f.center })),
            )
            .catch(() => [])
        : Promise.resolve([])

      // Optional extra source (e.g. Overture small-business search), merged first.
      const fromExtra: Promise<PickedAddress[]> = extraSourceRef.current
        ? extraSourceRef.current(query, ctl.signal).catch(() => [])
        : Promise.resolve([])

      Promise.all([fromExtra, fromMapTiler]).then(([extra, mt]) => {
        if (ctl.signal.aborted) return // a newer keystroke owns the field now
        setSuggestions(mergeCandidates(extra, mt, limit))
        setActiveIdx(-1)
        setLoading(false)
        setOpen(true)
      })
    }, 220)
    return () => clearTimeout(timer)
  }, [q, types, limit])

  useEffect(() => () => abortRef.current?.abort(), [])

  const pick = (s: PickedAddress) => {
    skipNextFetch.current = true
    setQ(s.label)
    setPicked(s)
    setSuggestions([])
    setOpen(false)
    setActiveIdx(-1)
    onPick(s)
  }

  // Typing anything by hand un-verifies the field: a real pick must follow.
  const onChange = (v: string) => {
    setQ(v)
    if (picked) {
      setPicked(null)
      onClear?.()
    }
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'Enter') {
      if (open && activeIdx >= 0 && suggestions[activeIdx]) {
        e.preventDefault()
        pick(suggestions[activeIdx])
      } else if (onAsk && q.trim().length >= 2) {
        // No suggestion chosen → this is a QUESTION for the map, not an address.
        e.preventDefault()
        const question = q.trim()
        // Kill the geocode machinery completely: abort any in-flight fetch (its
        // .then would reopen the list OVER the answer card), drop suggestions,
        // and clear the box — the question lives on, echoed in the card's thread.
        abortRef.current?.abort()
        setQ('')
        setSuggestions([])
        setLoading(false)
        setOpen(false)
        setActiveIdx(-1)
        onAsk(question)
      }
      return
    }
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    }
  }

  const verified = showVerified && picked !== null

  return (
    <div className={`addr-search${variant === 'form' ? ' addr-search--form' : ''}${verified ? ' is-verified' : ''}`}>
      <span className="addr-search-icon" aria-hidden="true">⌖</span>
      <input
        className="addr-search-input"
        type="text"
        placeholder={placeholder}
        value={q}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label="Search an address"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => (suggestions.length > 0 || loading) && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {verified && <span className="addr-search-check" aria-hidden="true">✓</span>}
      {open && (loading || suggestions.length > 0) && (
        <ul className="addr-search-list" role="listbox">
          {loading && <li className="addr-search-note">Searching addresses…</li>}
          {!loading &&
            suggestions.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === activeIdx}
                  className={`addr-search-item${i === activeIdx ? ' is-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => pick(s)}
                >
                  {s.label}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
