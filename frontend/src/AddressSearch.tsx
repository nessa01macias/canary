import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

// The navbar's centerpiece: type any SF address → fly there → the report opens.
// This IS the consumer promise ("should I live HERE?") as a single control.
// Geocoding via MapTiler (same client-safe key as the tiles; SF-bounded).

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY
const SF_BBOX = '-122.55,37.70,-122.35,37.83'

type Suggestion = { id: string; label: string; center: [number, number] }
type GeoFeature = { id?: string; place_name?: string; text?: string; center?: [number, number] }

export function AddressSearch({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  const [q, setQ] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const abortRef = useRef<AbortController | null>(null)
  const skipNextFetch = useRef(false)

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false
      return
    }
    const query = q.trim()
    if (!MAPTILER_KEY || query.length < 3) {
      setSuggestions([])
      setOpen(false)
      return
    }
    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const ctl = new AbortController()
      abortRef.current = ctl
      fetch(
        `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json` +
          `?key=${MAPTILER_KEY}&bbox=${SF_BBOX}&limit=5&types=address,street,poi`,
        { signal: ctl.signal },
      )
        .then((r) => r.json())
        .then((data: { features?: GeoFeature[] }) => {
          const items = (data.features ?? [])
            .filter((f) => f.center)
            .map((f, i) => ({
              id: f.id ?? String(i),
              label: f.place_name ?? f.text ?? '',
              center: f.center as [number, number],
            }))
          setSuggestions(items)
          setOpen(items.length > 0)
          setActiveIdx(-1)
        })
        .catch(() => {})
    }, 220)
    return () => clearTimeout(timer)
  }, [q])

  const pick = (s: Suggestion) => {
    skipNextFetch.current = true
    setQ(s.label)
    setOpen(false)
    const [lng, lat] = s.center
    onPick(lat, lng)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      pick(suggestions[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="addr-search">
      <span className="addr-search-icon" aria-hidden="true">⌖</span>
      <input
        className="addr-search-input"
        placeholder="Search any SF address — what's changing there?"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-label="Search an address"
      />
      {open && (
        <ul className="addr-search-list" role="listbox">
          {suggestions.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === activeIdx}
                className={`addr-search-item${i === activeIdx ? ' is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
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
