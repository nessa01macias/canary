import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

// THE address autocomplete — one component for every surface that asks for an
// address (navbar search, the give-to-get ContributeModal, whatever comes next),
// so behavior can never diverge: real-time prefix matching (autocomplete=true),
// SF-bounded, keyboard nav, verified-pick semantics (free-typed text is never a
// pick — only selecting a real suggestion is).
// Geocoding via MapTiler (same client-safe key as the tiles).

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY
const SF_BBOX = '-122.55,37.70,-122.35,37.83'

export type PickedAddress = { id: string; label: string; center: [number, number] }
type GeoFeature = { id?: string; place_name?: string; text?: string; center?: [number, number] }

type Props = {
  onPick: (picked: PickedAddress) => void
  /** Fired when the user edits the text after a pick — the field is no longer verified. */
  onClear?: () => void
  placeholder?: string
  /** 'navbar' = compact pill; 'form' = full-width field (ContributeModal). */
  variant?: 'navbar' | 'form'
  /** Show a ✓ once a suggestion is picked (form flows that need verified input). */
  showVerified?: boolean
}

export function AddressSearch({
  onPick,
  onClear,
  placeholder = 'Search any SF address — what’s changing there?',
  variant = 'navbar',
  showVerified = false,
}: Props) {
  const [q, setQ] = useState('')
  const [suggestions, setSuggestions] = useState<PickedAddress[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [picked, setPicked] = useState<PickedAddress | null>(null)
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
      setLoading(false)
      return
    }
    setLoading(true)
    setOpen(true)
    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const ctl = new AbortController()
      abortRef.current = ctl
      fetch(
        `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json` +
          `?key=${MAPTILER_KEY}&autocomplete=true&limit=5&country=us&types=address&bbox=${SF_BBOX}`,
        { signal: ctl.signal },
      )
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((data: { features?: GeoFeature[] }) => {
          const items = (data.features ?? [])
            .filter((f): f is GeoFeature & { center: [number, number] } => !!f.center)
            .map((f, i) => ({
              id: f.id ?? String(i),
              label: f.place_name ?? f.text ?? '',
              center: f.center,
            }))
          setSuggestions(items)
          setActiveIdx(-1)
          setLoading(false)
          setOpen(true)
        })
        .catch(() => {
          if (ctl.signal.aborted) return // a newer keystroke is already fetching
          setSuggestions([])
          setLoading(false)
        })
    }, 220)
    return () => clearTimeout(timer)
  }, [q])

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
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      pick(suggestions[activeIdx])
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
