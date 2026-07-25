import type { AddressReport, ReportTrajectory } from './report'

// The magic-moment card: everything changing around a clicked point, cited.
// Facts + attributed directions only — no scores, no quality labels.

const METRIC_LABEL: Record<string, string> = {
  units_approved_net: 'Housing units approved',
  permits_issued: 'Permits issued',
  biz_openings: 'Business openings',
  biz_closings: 'Business closings',
  crime_incidents: 'Crime incidents',
  threeoneone_noise: 'Noise complaints (311)',
  evictions_filed: 'Evictions filed',
}

const DIRECTION_META: Record<ReportTrajectory['direction'], { glyph: string; cls: string }> = {
  rising: { glyph: '▲', cls: 'up' },
  declining: { glyph: '▼', cls: 'down' },
  stable: { glyph: '—', cls: 'flat' },
}

const CATEGORY_DOT: Record<string, string> = {
  construction: '#FF6624',
  business: '#3f8f5c',
  safety: '#c1443c',
  housing: '#8a4fd3',
  other: '#999',
}

// Tiny inline sparkline — the 24-month series as one polyline.
function Sparkline({ series }: { series: { value: number }[] }) {
  if (series.length < 2) return null
  const w = 72
  const h = 20
  const vals = series.map((p) => p.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const pts = vals
    .map((v, i) => `${(i / (vals.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`)
    .join(' ')
  return (
    <svg className="rc-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function fmtDate(d: string | null): string {
  return d ? d.slice(0, 10) : ''
}

function fmtMoney(v: number | null): string {
  if (!v) return ''
  return v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}k`
}

type Props = {
  report: AddressReport | null
  loading: boolean
  onClose: () => void
}

export function ReportCard({ report, loading, onClose }: Props) {
  return (
    <aside className="report-card">
      <button className="drawer-close" onClick={onClose}>×</button>

      {loading || !report ? (
        <div className="rc-loading">
          <div className="rc-loading-pulse" />
          Reading the public record…
        </div>
      ) : (
        <>
          <p className="drawer-kind">What's changing here</p>
          <h3 className="rc-title">
            {report.query.display_name ?? 'This spot'}
            <span className="rc-sub"> · within ~500 m · last 24 months</span>
          </h3>

          {/* Trajectories */}
          <div className="rc-section">
            {report.trajectories.map((t) => {
              const dir = DIRECTION_META[t.direction]
              return (
                <div key={t.metric} className="rc-metric">
                  <span className={`rc-dir ${dir.cls}`}>{dir.glyph}</span>
                  <span className="rc-metric-name">{METRIC_LABEL[t.metric] ?? t.metric}</span>
                  <Sparkline series={t.series} />
                  <span className="rc-metric-val">
                    {t.latest_value != null ? Math.round(t.latest_value) : '–'}
                    <span className="rc-metric-unit">/mo</span>
                  </span>
                </div>
              )
            })}
            {report.trajectories.length === 0 && (
              <p className="rc-empty">No metric history for this area yet.</p>
            )}
          </div>

          {/* Reference attributes (flood/fire/school… appear as the pipeline stages them) */}
          {Object.keys(report.attributes).length > 0 && (
            <div className="rc-section rc-attrs">
              {Object.entries(report.attributes).map(([k, v]) => (
                <span key={k} className="rc-attr">
                  {k.replace(/_/g, ' ')}: <b>{String(v)}</b>
                </span>
              ))}
            </div>
          )}

          {/* Recent changes, cited */}
          <div className="rc-section">
            <p className="rc-section-title">Most recent on record</p>
            {report.changes.slice(0, 8).map((c) => (
              <div key={c.id} className="rc-change">
                <span className="rc-change-dot" style={{ background: CATEGORY_DOT[c.category] }} />
                <div className="rc-change-body">
                  <div className="rc-change-head">
                    {c.headline}
                    {c.value ? <span className="rc-change-cost"> {fmtMoney(c.value)}</span> : null}
                  </div>
                  <div className="rc-change-meta">
                    {fmtDate(c.event_time)} · {c.citation.source}
                    {c.citation.record_key ? ` · #${c.citation.record_key}` : ''}
                  </div>
                </div>
              </div>
            ))}
            {report.changes.length === 0 && (
              <p className="rc-empty">Nothing filed here in the window.</p>
            )}
          </div>

          <p className="rc-footer">
            {report.changes.length} records · sources: {report.sources.map((s) => s.source).join(', ')}
            {report.pipeline_version ? ` · pipeline ${report.pipeline_version}` : ''}
          </p>
        </>
      )}
    </aside>
  )
}
