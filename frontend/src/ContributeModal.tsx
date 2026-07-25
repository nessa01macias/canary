import { useState } from 'react'
import { sessionId } from './lib/contributions'
import { AddressSearch, type PickedAddress } from './AddressSearch'


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


export default function ContributeModal({
  tag,
  onClose,
  onSubmitted,
}: {
  tag: string
  onClose: () => void
  onSubmitted?: () => void
}) {
  // The address the user actually PICKED from the geocoder (shared AddressSearch
  // component) — the proof it's a real place. Free-typed text never sets it.
  const [selected, setSelected] = useState<PickedAddress | null>(null)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  // Per-question free-text "Other": whether its input is showing + the draft text.
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({})
  const [otherDrafts, setOtherDrafts] = useState<Record<string, string>>({})
  const [directions, setDirections] = useState<Record<string, Record<string, string>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

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
  const addressVerified = selected !== null
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
      const [lon, lat] = selected.center
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
              <AddressSearch
                variant="form"
                showVerified
                placeholder="Start typing your address…"
                onPick={setSelected}
                onClear={() => setSelected(null)}
              />
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
