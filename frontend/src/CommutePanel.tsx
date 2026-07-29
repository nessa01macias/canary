// The commute preview bar — set 1–3 places you actually go. Every travel mode's
// time is drawn right on that place's route line on the map (no mode to pick);
// this bar is just where you manage the places. Colored dots + route lines + the
// on-line time labels are drawn by App.tsx; picking and candidate-preview are
// lifted to App too, so clicking a grey candidate dot and clicking a dropdown row
// run the exact same path. This is the control surface.

import { AddressSearch, type PickedAddress } from './AddressSearch'
import { routeColor, searchOverturePlaces, type CommuteState } from './commute'

type Props = {
  commute: CommuteState
  /** True once a spot/neighborhood is scoped — the origin routes run from. */
  originReady: boolean
  /** Promote a picked place (a dropdown row) to a destination. App owns this so
      the same handler serves clicks on the map's candidate dots. */
  onAddPick: (p: PickedAddress) => void
  /** Report the live suggestion set up so App can draw a grey dot per location. */
  onSuggestions: (s: PickedAddress[]) => void
  /** Bumped by App to remount (clear) the add-field after a pick. */
  addFieldKey: number
}

export function CommutePanel({ commute, originReady, onAddPick, onSuggestions, addFieldKey }: Props) {
  const { destinations, removeDestination, loading, full } = commute

  return (
    <section className="commute" aria-label="Commute preview">
      <div className="commute-head">
        <h2 className="commute-title">Commute preview</h2>
        <p className="commute-sub">
          {originReady ? 'Times ride on each route' : 'Click a spot to see times'}
        </p>
      </div>

      {destinations.length > 0 && (
        <ul className="commute-list">
          {destinations.map((d, i) => (
            <li key={d.id} className="commute-row">
              <span className="commute-dot" style={{ background: routeColor(i) }} aria-hidden="true" />
              <span className="commute-place" title={d.label}>{d.label}</span>
              {originReady && loading && <span className="commute-loading" aria-hidden="true" />}
              <button
                type="button"
                className="commute-remove"
                aria-label={`Remove ${d.label}`}
                onClick={() => removeDestination(d.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="commute-hint">3 places set</p>
      ) : (
        <div className="commute-add">
          <AddressSearch
            key={addFieldKey}
            variant="form"
            types="poi,address"
            limit={8}
            placeholder="Add a place: business name or address"
            onPick={onAddPick}
            onSuggestions={onSuggestions}
            extraSource={searchOverturePlaces}
          />
        </div>
      )}
    </section>
  )
}
