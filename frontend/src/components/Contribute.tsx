import { useState } from 'react'
import { submitContribution } from '../lib/contributions'

// The give-to-get contribution form (the moat). Kat owns the final design; the
// durable pieces are the call to submitContribution() and the two structural
// choices here: the neighborhood comes from the REAL list (the same 41 areas the
// map serves — so the backend can attach geography and the k-anonymous aggregate
// can actually group reviews), and moving in/out is ASKED, not assumed.

const QUESTIONS: { key: string; label: string }[] = [
  { key: 'trajectory', label: 'Is it getting better or worse?' },
  { key: 'safety', label: 'How safe does it feel?' },
  { key: 'noise', label: 'How quiet is it?' },
]

type Props = {
  onClose: () => void
  neighborhoods: string[] // real area names from the map data (empty = not loaded yet)
  onSubmitted?: (area: string) => void // give-to-get: a successful review unlocks everything
}

export function Contribute({ onClose, neighborhoods, onSubmitted }: Props) {
  const [place, setPlace] = useState('')
  const [movingOut, setMovingOut] = useState<boolean | null>(null)
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const canSubmit =
    place.trim() && movingOut !== null && Object.keys(ratings).length > 0 && status !== 'saving'

  async function handleSubmit() {
    setStatus('saving')
    const res = await submitContribution({
      place_label: place.trim(),
      moving_out: movingOut ?? undefined,
      ratings,
      comment: comment.trim() || null,
    })
    if (res.ok) {
      setStatus('done')
      onSubmitted?.(place.trim())
    } else {
      setError(res.error)
      setStatus('error')
    }
  }

  return (
    <div className="contribute-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="contribute-card">
        <button className="drawer-close" onClick={onClose}>×</button>

        {status === 'done' ? (
          <div className="contribute-done">
            <h3>Thank you 🐦</h3>
            <p>Your review helps the next person who moves here. This is the layer no one else has.</p>
            <button className="contribute-submit" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <p className="drawer-kind">Review a neighborhood you know</p>
            <h3 className="drawer-headline">What's it really like to live there?</h3>

            <label className="contribute-label">Neighborhood</label>
            {neighborhoods.length > 0 ? (
              <select
                className="contribute-input"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
              >
                <option value="" disabled>Pick the area you're reviewing…</option>
                {neighborhoods.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            ) : (
              // Map data not loaded yet — free text beats blocking the reviewer.
              <input
                className="contribute-input"
                placeholder="e.g. Hayes Valley, SF"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
              />
            )}

            <label className="contribute-label">Your relationship to it</label>
            <div className="contribute-scale">
              <button
                className={`relation-btn ${movingOut === true ? 'on' : ''}`}
                onClick={() => setMovingOut(true)}
              >
                I'm leaving this area
              </button>
              <button
                className={`relation-btn ${movingOut === false ? 'on' : ''}`}
                onClick={() => setMovingOut(false)}
              >
                I live here now
              </button>
            </div>

            {QUESTIONS.map((q) => (
              <div key={q.key} className="contribute-q">
                <label className="contribute-label">{q.label}</label>
                <div className="contribute-scale">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button
                      key={v}
                      className={`scale-dot ${ratings[q.key] === v ? 'on' : ''}`}
                      onClick={() => setRatings((r) => ({ ...r, [q.key]: v }))}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <label className="contribute-label">Anything else? (optional)</label>
            <textarea
              className="contribute-input"
              rows={2}
              placeholder="The thing you wish someone had told you…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />

            {status === 'error' && <p className="contribute-error">{error}</p>}

            <button className="contribute-submit" disabled={!canSubmit} onClick={handleSubmit}>
              {status === 'saving' ? 'Saving…' : 'Submit review'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
