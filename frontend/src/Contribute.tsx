import { useState } from 'react'
import { submitContribution } from './lib/contributions'

// SEED plumbing for the give-to-get moat. Intentionally minimal — Kat restyles
// the UI; the durable piece is the call to submitContribution() (src/lib). Proves
// the loop end-to-end: a resident rates a neighborhood → row lands in Supabase.

const QUESTIONS: { key: string; label: string }[] = [
  { key: 'trajectory', label: 'Is it getting better or worse?' },
  { key: 'safety', label: 'How safe does it feel?' },
  { key: 'noise', label: 'How quiet is it?' },
]

export function Contribute({ onClose }: { onClose: () => void }) {
  const [place, setPlace] = useState('')
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const canSubmit = place.trim() && Object.keys(ratings).length > 0 && status !== 'saving'

  async function handleSubmit() {
    setStatus('saving')
    const res = await submitContribution({
      place_label: place.trim(),
      moving_out: true,
      ratings,
      comment: comment.trim() || null,
    })
    if (res.ok) {
      setStatus('done')
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
            <input
              className="contribute-input"
              placeholder="e.g. Hayes Valley, SF"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
            />

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
