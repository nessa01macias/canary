// Preferences panel — the shorthand summary of your picks ("Looking for"),
// floating over the map. Both of its doors (Choose what matters / Edit) open
// THE picker; chips toggle the active set; the Best-fit list points back into
// the map (glow on hover, neighborhood scope on click).

type WhyChip = { chip: string; ok: boolean }

type Props = {
  /** The chips chosen in the picker (membership); `priorities` is the ACTIVE
      subset that drives the map — a chip toggled off stays here as an
      empty-state button rather than disappearing. */
  shortlist: string[]
  priorities: Set<string>
  matchTop: string[]
  onOpenPicker: () => void
  onToggleActive: (tag: string) => void
  onClearActive: () => void
  /** The WHY, per chip — trust needs the receipt, not just a rank. */
  whyFor: (nhood: string) => WhyChip[]
  onGlowNeighborhood: (nhood: string, on: boolean) => void
  onOpenNeighborhood: (nhood: string) => void
}

export function PrefsPanel({
  shortlist, priorities, matchTop,
  onOpenPicker, onToggleActive, onClearActive,
  whyFor, onGlowNeighborhood, onOpenNeighborhood,
}: Props) {
  const matchActive = priorities.size > 0

  return (
    <aside className="prefs-panel">
      <div className="prefs-head">
        <p className="prefs-eyebrow">Looking for</p>
        {shortlist.length > 0 && (
          <div className="prefs-head-actions">
            {priorities.size > 0 && (
              <button type="button" className="prefs-clear" onClick={onClearActive}>
                Clear
              </button>
            )}
            {/* Dashed, no-fill empty-state button that reopens the picker */}
            <button type="button" className="prefs-edit-ghost" onClick={onOpenPicker}>
              Edit
            </button>
          </div>
        )}
      </div>
      {shortlist.length === 0 ? (
        <>
          <p className="prefs-hint">Tell us what matters and we’ll rank every neighborhood by fit.</p>
          <button type="button" className="prefs-cta" onClick={onOpenPicker}>
            Choose what matters
          </button>
        </>
      ) : (
        <>
          <p className="prefs-hint">
            {priorities.size > 0
              ? `Ranking neighborhoods by your top ${priorities.size}.`
              : 'Tap a chip to rank neighborhoods by it.'}
          </p>
          <div className="prefs-tags">
            {shortlist.map((tag) => {
              const active = priorities.has(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  className={`prefs-tag${active ? ' is-selected' : ''}`}
                  aria-pressed={active}
                  title={active ? 'Turn off' : 'Turn on'}
                  onClick={() => onToggleActive(tag)}
                >
                  {tag}
                </button>
              )
            })}
          </div>
          {matchActive && matchTop.length > 0 && (
            <div className="prefs-result">
              <span className="prefs-result-label">Best fit</span>
              <ul className="prefs-result-list">
                {matchTop.map((nhood) => {
                  const why = whyFor(nhood)
                  return (
                    <li key={nhood}>
                      <button
                        type="button"
                        className="prefs-result-item"
                        onMouseEnter={() => onGlowNeighborhood(nhood, true)}
                        onMouseLeave={() => onGlowNeighborhood(nhood, false)}
                        onFocus={() => onGlowNeighborhood(nhood, true)}
                        onBlur={() => onGlowNeighborhood(nhood, false)}
                        onClick={() => onOpenNeighborhood(nhood)}
                      >
                        <span className="prefs-result-rank" />
                        <span className="prefs-result-body">
                          <span className="prefs-result-name">{nhood}</span>
                          {why.length > 0 && (
                            <span className="prefs-result-why">
                              {why.map((w) => `${w.chip.toLowerCase()} ${w.ok ? '✓' : '✗'}`).join(' · ')}
                            </span>
                          )}
                        </span>
                        <span className="prefs-result-go" aria-hidden="true">→</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </aside>
  )
}
