// Bottom legend strip — swaps with the view: street-zoom marker key, the
// preference-fit ramp, or the trajectory ramp + the viz-mode compare toggle.
// Pure presentation; every fact it states comes in as a prop.

import { KIND_COLOR } from '../lib/samplePoints'
import { mapCaption } from '../lib/interpreter'
import { MATCH_STOPS, TRAJECTORY_STOPS } from '../map/paint'
import { VIZ_MODES, type VizMode } from '../map/vizModes'

type Props = {
  zoomedIn: boolean
  /** True when preference chips are ranking the map (the fit overlay owns it). */
  matchActive: boolean
  prioritiesCount: number
  /** Label of the hex texture's metric while a neighborhood is scoped, else null. */
  hexMetricLabel: string | null
  vizMode: VizMode
  onVizMode: (mode: VizMode) => void
}

export function LegendStrip({
  zoomedIn, matchActive, prioritiesCount, hexMetricLabel, vizMode, onVizMode,
}: Props) {
  return (
    <footer className="legend-strip">
      {zoomedIn ? (
        <>
          <div className="legend-item">
            <span className="legend-dot" style={{ background: KIND_COLOR.construction }} />
            Permit · Construction
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ background: KIND_COLOR.opening }} />
            Business Opening
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ background: KIND_COLOR.closure }} />
            Business Closure
          </div>
          <div className="legend-item legend-size">
            <span className="legend-dot sz-s" style={{ background: '#999' }} />
            <span className="legend-dot sz-l" style={{ background: '#999' }} />
            dot size = $ value
          </div>
          <div className="legend-hint">{mapCaption(true, prioritiesCount)}</div>
        </>
      ) : matchActive ? (
        <>
          <div className="legend-item legend-ramp">
            <span>weaker fit</span>
            <span
              className="ramp-bar"
              style={{
                background: `linear-gradient(90deg, ${MATCH_STOPS.map(
                  ([s, c]) => `${c} ${s * 100}%`,
                ).join(', ')})`,
              }}
            />
            <span>stronger fit</span>
          </div>
          <div className="legend-hint">{mapCaption(false, prioritiesCount, hexMetricLabel)}</div>
        </>
      ) : (
        <>
          <div className="legend-item legend-ramp">
            <span>getting worse</span>
            <span
              className="ramp-bar"
              style={{
                background: `linear-gradient(90deg, ${TRAJECTORY_STOPS.map(
                  ([s, c]) => `${c} ${((s + 1) / 2) * 100}%`,
                ).join(', ')})`,
              }}
            />
            <span>getting better</span>
          </div>
          <div className="viz-toggle" role="group" aria-label="Trajectory style">
            <span className="viz-toggle-label">style</span>
            {VIZ_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                className={`viz-toggle-btn${vizMode === m.key ? ' is-on' : ''}`}
                aria-pressed={vizMode === m.key}
                onClick={() => onVizMode(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="legend-hint">{mapCaption(false, 0, hexMetricLabel)}</div>
        </>
      )}
    </footer>
  )
}
