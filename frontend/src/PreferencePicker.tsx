import { useState } from 'react'
import { MAX_PICKS, MISSIONS, MISSION_QUESTIONS } from './missions'

// THE preference picker — the only preference surface in the app. One screen,
// zero steps: the mission is a TAB (tap = the spotlight refocuses live), the
// mission's question + 8 grounded chips are the spotlight, and Kat's full
// catalog folds underneath ("browse all signals"). First run, "Choose what
// matters", and "Edit" all open this same component — every door, one room.
// Picks edit the LIVE shortlist, so the map re-ranks behind the light scrim
// while you choose.

type PrefField = { label: string; available?: boolean }
type PrefTier = { title: string; fields: PrefField[] }

// The full field catalog, grouped by tier. `available` fields are live or
// compute-ready today; the rest are shown but disabled ("soon") until their
// data source lands (federal feeds, the Census key, deed records…).
const PREFERENCE_TIERS: PrefTier[] = [
  {
    title: 'Fundamentals',
    fields: [
      { label: 'Good schools', available: true },
      { label: 'Low crime', available: true },
      { label: 'Short commute', available: true },
      { label: 'Low property tax', available: true },
      { label: 'Walkable', available: true },
      { label: 'Home prices' }, // Prop 13 → needs deed records / FHFA
    ],
  },
  {
    title: 'Risk & rules',
    fields: [
      { label: 'Flood risk', available: true },
      { label: 'Fire risk', available: true },
      { label: 'Zoning', available: true },
      { label: 'Jurisdiction', available: true },
      { label: 'Parking', available: true },
      { label: 'Broadband & cell' }, // federal, pending
    ],
  },
  {
    title: 'Sensory',
    fields: [
      { label: 'Quiet', available: true },       // 311
      { label: 'Tree canopy', available: true }, // tree inventory
      { label: 'Clean air' },                    // on-demand raster / federal
      { label: 'No rail noise' },
      { label: 'Away from industry', available: true }, // EPA TRI facilities
    ],
  },
  {
    title: 'Getting around',
    fields: [
      { label: 'Transit access', available: true },
      { label: 'Groceries & retail', available: true }, // Overture
      { label: 'Fast emergency response', available: true },
      { label: 'School bus routes', available: true },
      { label: 'Urgent care nearby' }, // HIFLD, pending
    ],
  },
  {
    title: 'Who lives here',
    fields: [
      { label: 'Political lean', available: true },
      { label: 'Renters vs owners' }, // needs Census key
      { label: 'Age mix' },           // needs Census key
    ],
  },
  {
    title: 'Where it’s heading',
    fields: [
      { label: 'New construction', available: true },
      { label: 'Rezoning', available: true },
      { label: 'Transit expansion', available: true },
      { label: 'Business openings', available: true },
      { label: 'Vacancy trend', available: true },
      { label: 'Housing stability', available: true },
      { label: 'Road projects', available: true },
      { label: 'Liquor & cannabis', available: true },
    ],
  },
]

const TOTAL_SIGNALS = PREFERENCE_TIERS.reduce((n, t) => n + t.fields.length, 0)

type Props = {
  mission: string | null
  onMission: (id: string) => void
  picks: string[]              // the live shortlist (selection = membership)
  onToggle: (tag: string) => void
  onClear: () => void
  onDone: () => void
  onClose: () => void
  firstRun: boolean
}

export function PreferencePicker({
  mission, onMission, picks, onToggle, onClear, onDone, onClose, firstRun,
}: Props) {
  // The catalog starts folded when a lens is focused; open when browsing free.
  const [expanded, setExpanded] = useState(() => !mission || !MISSION_QUESTIONS[mission])
  const q = mission ? MISSION_QUESTIONS[mission] : undefined

  const selectTab = (id: string) => {
    onMission(id)
    setExpanded(!MISSION_QUESTIONS[id]) // focused lens folds the catalog; exploring opens it
  }

  const chip = (f: PrefField) => {
    const sel = picks.includes(f.label)
    const atCap = picks.length >= MAX_PICKS && !sel
    return (
      <button
        key={f.label}
        type="button"
        className={`prefs-tag${sel ? ' is-selected' : ''}${f.available ? '' : ' is-soon'}`}
        aria-pressed={sel}
        disabled={!f.available || (!sel && atCap)}
        onClick={() => onToggle(f.label)}
      >
        <span className="tag-label">{f.label}</span>
        {!f.available && <span className="soon">soon</span>}
      </button>
    )
  }

  return (
    <div
      className="picker-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="What matters to you"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="picker-card">
        <button className="ob-close" onClick={onClose} aria-label="Close">×</button>

        <header className="picker-head">
          <p className="prefs-eyebrow">{firstRun ? 'Welcome to Canary' : 'Your lens'}</p>
          <h2 className="ob-title">What matters to you?</h2>
          <p className="picker-sub">Every pick re-ranks all 41 neighborhoods, live.</p>
        </header>

        {/* The mission is a TAB, not a step — tap one and the list refocuses. */}
        <section className="picker-section">
          <p className="picker-label">I’m here…</p>
          <div className="picker-tabs" role="tablist" aria-label="I'm here…">
            {MISSIONS.map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={mission === m.id}
                className={`picker-tab${mission === m.id ? ' is-active' : ''}`}
                onClick={() => selectTab(m.id)}
              >
                <span aria-hidden="true">{m.icon}</span> {m.label}
              </button>
            ))}
          </div>
        </section>

        {q && (
          <section className="picker-section">
            <p className="picker-question">{q.question}</p>
            <div className="prefs-tags picker-spotlight">
              {q.chips.map((c) => chip({ label: c, available: true }))}
            </div>
          </section>
        )}

        <section className="picker-section picker-section--catalog">
          <button type="button" className="picker-browse" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show less ▴' : `Browse all ${TOTAL_SIGNALS} signals ▾`}
          </button>
          {expanded && (
            <div className="ob-tiers picker-catalog">
              {PREFERENCE_TIERS.map((tier) => (
                <section key={tier.title} className="ob-tier">
                  <p className="ob-tier-title">{tier.title}</p>
                  <div className="prefs-tags">{tier.fields.map(chip)}</div>
                </section>
              ))}
            </div>
          )}
        </section>

        <div className="ob-footer picker-footer">
          <span className="ob-count">{picks.length} of {MAX_PICKS} picked</span>
          <div className="ob-actions">
            {picks.length > 0 && (
              <button type="button" className="ob-clear" onClick={onClear}>Clear</button>
            )}
            <button
              type="button"
              className="ob-done"
              disabled={picks.length === 0}
              onClick={onDone}
            >
              Show my map
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
