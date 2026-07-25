import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { sessionId } from './lib/contributions'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY

// The resident layer is the COMPLEMENT of the open-data registry: we only ask
// what the engine can't compute. Three moat questions (per CONTEXT.md ranking):
//   1. Exit interview — reasons for leaving = trajectory in human form, the
//      leading indicator no one has or can license.
//   2. Landlord / building / block layer — the uncomputable #5 forum fear; kept
//      at block/building level, never named individuals (defamation + fair-housing).
//   3. Calibration — DIRECTIONAL, experienced-fact change over a fixed period
//      (area, metric, period, direction). Row-for-row comparable with the computed
//      trajectory table, and it's the citable neighbourhood-grain change data the
//      answer engines grope for (they cite stale static scores today). It also
//      resolves divergence — e.g. enforcement ↑ while victimisation ↓ — where the
//      resident's first-hand answer is the tiebreaker between conflicting signals.
// Structured facts only — never quality labels, safety verdicts, or demographics.
type Question =
  | { id: string; type: 'multi'; prompt: string; options: string[] }
  | { id: string; type: 'direction'; prompt: string; note?: string; metrics: string[] }

const DIRECTIONS = ['More', 'Same', 'Less'] as const

const CONTRIB_QUESTIONS: Question[] = [
  {
    id: 'leaving',
    type: 'multi',
    prompt: 'Moving out? What’s pushing you to leave?',
    options: [
      'Rent / cost', 'Need more space', 'Job or commute', 'Too noisy',
      'Safety', 'Neighbors', 'Landlord', 'Construction', 'Area changed',
    ],
  },
  {
    id: 'building',
    type: 'multi',
    prompt: 'What should the next resident on your block know?',
    options: [
      'Repairs are slow', 'Landlord responsive', 'Packages get stolen',
      'Street parking tough', 'Loud at night', 'Thin walls', 'Building quirks', 'HOA strict',
    ],
  },
  {
    id: 'trend',
    type: 'direction',
    prompt: 'Compared with a year ago, on your block:',
    note: 'Your first-hand read — the tiebreaker when our data disagrees with itself.',
    metrics: [
      'Break-ins or package theft you had',
      'Noise at night',
      'Empty storefronts',
      'Street disrepair',
      'Construction nearby',
    ],
  },
]

type Suggestion = { id: string; label: string; center?: [number, number] }
type GeoFeature = { id?: string; place_name?: string; text?: string; center?: [number, number] }
type GeoResponse = { features?: GeoFeature[] }

// San Francisco bounding box, so autocomplete only surfaces local addresses.
const SF_BBOX = '-122.55,37.70,-122.35,37.83'

export default function ContributeModal({
  tag,
  onClose,
  onSubmitted,
}: {
  tag: string
  onClose: () => void
  onSubmitted?: () => void
}) {
  const [address, setAddress] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  // The address the user actually PICKED from the geocoder — this is the proof it's
  // a real place. Free-typed text never sets it, so it can't be submitted (below).
  const [selected, setSelected] = useState<Suggestion | null>(null)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  // Per-question free-text "Other": whether its input is showing + the draft text.
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({})
  const [otherDrafts, setOtherDrafts] = useState<Record<string, string>>({})
  const [directions, setDirections] = useState<Record<string, Record<string, string>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const skipNextFetch = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  // Debounced address autocomplete against MapTiler's geocoder (real addresses).
  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false
      return
    }
    const q = address.trim()
    if (!MAPTILER_KEY || q.length < 3) {
      setSuggestions([])
      setOpen(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setOpen(true)
    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      const url =
        `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json` +
        `?key=${MAPTILER_KEY}&autocomplete=true&limit=5&country=us&types=address&bbox=${SF_BBOX}`
      fetch(url, { signal: ac.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
        .then((data: GeoResponse) => {
          const next = (data.features ?? []).map((f, i) => ({
            id: f.id ?? `${i}`,
            label: f.place_name ?? f.text ?? '',
            center: f.center,
          }))
          setSuggestions(next)
          setActiveIdx(-1)
          setLoading(false)
          setOpen(true)
        })
        .catch(() => {
          if (ac.signal.aborted) return // a newer keystroke is already fetching
          setSuggestions([])
          setLoading(false)
        })
    }, 250)
    return () => clearTimeout(timer)
  }, [address])

  useEffect(() => () => abortRef.current?.abort(), [])

  const pick = (s: Suggestion) => {
    skipNextFetch.current = true
    setAddress(s.label)
    setSelected(s) // marks the address VERIFIED — the only path that enables submit
    setSuggestions([])
    setOpen(false)
    setActiveIdx(-1)
  }

  // Typing anything by hand un-verifies the field: a real pick must follow.
  const onAddressChange = (v: string) => {
    setAddress(v)
    if (selected) setSelected(null)
  }

  const onAddressKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); pick(suggestions[activeIdx]) }
  }

  const toggleAnswer = (qid: string, opt: string) =>
    setAnswers((prev) => {
      const cur = new Set(prev[qid] ?? [])
      if (cur.has(opt)) cur.delete(opt)
      else cur.add(opt)
      return { ...prev, [qid]: [...cur] }
    })

  // Free-text "Other" tag: commit the current draft as a resident-authored tag for
  // this question. Kept open + cleared after Enter so several can be added in a row.
  const openOther = (qid: string) => setOtherOpen((prev) => ({ ...prev, [qid]: true }))
  const closeOther = (qid: string) => {
    setOtherOpen((prev) => ({ ...prev, [qid]: false }))
    setOtherDrafts((prev) => ({ ...prev, [qid]: '' }))
  }
  const addCustomTag = (qid: string) => {
    const raw = (otherDrafts[qid] ?? '').trim()
    if (!raw) return
    const q = CONTRIB_QUESTIONS.find((x) => x.id === qid)
    const options = q && q.type === 'multi' ? q.options : []
    // Fold onto a built-in option if it matches one, so we never create a near-dupe.
    const label = options.find((o) => o.toLowerCase() === raw.toLowerCase()) ?? raw
    setAnswers((prev) => {
      const cur = prev[qid] ?? []
      if (cur.some((t) => t.toLowerCase() === label.toLowerCase())) return prev
      return { ...prev, [qid]: [...cur, label] }
    })
    setOtherDrafts((prev) => ({ ...prev, [qid]: '' }))
  }

  // Directional answer: (area, metric, period, direction). Clicking the current
  // choice again clears it.
  const setDirection = (qid: string, metric: string, choice: string) =>
    setDirections((prev) => ({
      ...prev,
      [qid]: { ...(prev[qid] ?? {}), [metric]: prev[qid]?.[metric] === choice ? '' : choice },
    }))

  // Submit unlocks only once the address is a VERIFIED pick (not free-typed) AND
  // every question is answered (multi: ≥1 tag; direction: ≥1 metric rated) — a
  // complete, real contribution or nothing.
  const addressVerified = selected !== null && selected.label === address.trim()
  const canSubmit =
    addressVerified &&
    !saving &&
    CONTRIB_QUESTIONS.every((q) =>
      q.type === 'multi'
        ? (answers[q.id]?.length ?? 0) > 0
        : Object.values(directions[q.id] ?? {}).some(Boolean),
    )

  // Persist for real: the give-to-get only builds the moat if the answers land.
  // POSTs to our backend (never a DB from the browser); the backend attaches
  // h3_9 from the geocoded point and writes to Supabase under RLS.
  async function handleSubmit() {
    if (!selected) return
    setSaving(true)
    setSubmitError(null)
    try {
      const [lon, lat] = selected.center ?? [null, null]
      const resp = await fetch('/api/contributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          place_label: selected.label,
          lat,
          lon,
          moving_out: (answers['leaving']?.length ?? 0) > 0,
          ratings: {},
          answers: { tag, ...answers, directions },
          session_id: sessionId(),
        }),
      })
      if (!resp.ok) throw new Error(`Server ${resp.status}: ${await resp.text()}`)
      onSubmitted?.()
      setSubmitted(true)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="contrib-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Add local information about ${tag}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="contrib-card">
        <button className="ob-close" onClick={onClose} aria-label="Close">×</button>

        {submitted ? (
          <div className="contrib-done">
            <div className="contrib-check" aria-hidden="true">✓</div>
            <h2 className="ob-title">Thanks for adding to Canary.</h2>
            <p className="ob-sub">
              Your local knowledge helps everyone see where <b>{tag}</b> is really heading.
            </p>
            <button type="button" className="ob-done" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <p className="prefs-eyebrow">Add local intel · {tag}</p>
            <h2 className="ob-title">What do you know about your block?</h2>
            <p className="ob-sub">
              Residents map the change. Share a little about where you live to unlock <b>{tag}</b> for
              your neighborhood.
            </p>

            <div className="contrib-field">
              <span className="contrib-label">Your address</span>
              <div className={`addr-wrap${addressVerified ? ' is-verified' : ''}`}>
                <input
                  className="addr-input"
                  type="text"
                  placeholder="Start typing your address…"
                  value={address}
                  autoComplete="off"
                  spellCheck={false}
                  role="combobox"
                  aria-expanded={open}
                  aria-autocomplete="list"
                  onChange={(e) => onAddressChange(e.target.value)}
                  onKeyDown={onAddressKeyDown}
                  onFocus={() => (suggestions.length > 0 || loading) && setOpen(true)}
                  onBlur={() => setTimeout(() => setOpen(false), 120)}
                />
                {addressVerified && <span className="addr-check" aria-hidden="true">✓</span>}
                {open && (loading || suggestions.length > 0 || address.trim().length >= 3) && (
                  <ul className="addr-list" role="listbox">
                    {loading && <li className="addr-note">Searching addresses…</li>}
                    {!loading && suggestions.map((s, i) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className={`addr-item${i === activeIdx ? ' is-active' : ''}`}
                          role="option"
                          aria-selected={i === activeIdx}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setActiveIdx(i)}
                          onClick={() => pick(s)}
                        >
                          {s.label}
                        </button>
                      </li>
                    ))}
                    {!loading && suggestions.length === 0 && (
                      <li className="addr-note">
                        No match — include your street name (e.g. “915 Market St”).
                      </li>
                    )}
                  </ul>
                )}
              </div>
              {!addressVerified && address.trim().length > 0 && !open && (
                <p className="addr-hint">Pick your address from the list so we can verify it.</p>
              )}
            </div>

            {CONTRIB_QUESTIONS.map((q) =>
              q.type === 'multi' ? (
                <div key={q.id} className="contrib-field">
                  <span className="contrib-label">{q.prompt}</span>
                  <div className="prefs-tags">
                    {q.options.map((opt) => {
                      const on = (answers[q.id] ?? []).includes(opt)
                      return (
                        <button
                          key={opt}
                          type="button"
                          className={`prefs-tag${on ? ' is-selected' : ''}`}
                          aria-pressed={on}
                          onClick={() => toggleAnswer(q.id, opt)}
                        >
                          {opt}
                        </button>
                      )
                    })}
                    {/* Resident-authored tags (added via "Other") — click to remove. */}
                    {(answers[q.id] ?? [])
                      .filter((a) => !q.options.includes(a))
                      .map((custom) => (
                        <button
                          key={custom}
                          type="button"
                          className="prefs-tag is-selected"
                          aria-pressed={true}
                          title="Remove"
                          onClick={() => toggleAnswer(q.id, custom)}
                        >
                          {custom}
                        </button>
                      ))}
                    {/* Empty-state "Other": a dashed tag that expands into a text input. */}
                    {otherOpen[q.id] ? (
                      <input
                        className="prefs-tag prefs-tag-other-input"
                        type="text"
                        autoFocus
                        placeholder="Type, then Enter"
                        aria-label={`Add your own tag for: ${q.prompt}`}
                        value={otherDrafts[q.id] ?? ''}
                        onChange={(e) =>
                          setOtherDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); addCustomTag(q.id) }
                          else if (e.key === 'Escape') { e.preventDefault(); closeOther(q.id) }
                        }}
                        onBlur={() => { addCustomTag(q.id); closeOther(q.id) }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="prefs-tag prefs-tag-other"
                        onClick={() => openOther(q.id)}
                      >
                        Other
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div key={q.id} className="contrib-field">
                  <span className="contrib-label">{q.prompt}</span>
                  {q.note && <span className="contrib-note">{q.note}</span>}
                  <div className="dir-grid">
                    {q.metrics.map((m) => (
                      <div key={m} className="dir-row">
                        <span className="dir-metric">{m}</span>
                        <div className="dir-seg" role="group" aria-label={m}>
                          {DIRECTIONS.map((d) => {
                            const on = directions[q.id]?.[m] === d
                            return (
                              <button
                                key={d}
                                type="button"
                                className={`dir-opt${on ? ' is-on' : ''}`}
                                aria-pressed={on}
                                onClick={() => setDirection(q.id, m, d)}
                              >
                                {d}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ),
            )}

            <div className="ob-footer">
              <div className="ob-actions">
                <button type="button" className="ob-clear" onClick={onClose}>Cancel</button>
                <button
                  type="button"
                  className="ob-done"
                  disabled={!canSubmit}
                  onClick={handleSubmit}
                >
                  {saving ? 'Saving…' : 'Submit'}
                </button>
                {submitError && <p className="contribute-error">{submitError}</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
