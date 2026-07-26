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

// Tiny inline sparkline — a value series as one polyline. Reused by AnswerCanvas.
export function Sparkline({ series }: { series: { value: number }[] }) {
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

// Meters between two points (equirectangular — fine at neighborhood scale).
function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dx = (bLon - aLon) * 111320 * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180))
  const dy = (bLat - aLat) * 110574
  return Math.sqrt(dx * dx + dy * dy)
}

// The HERO: the single most consequential approved construction nearby —
// "what's approved to be built next to this address" is the #1 forum fear and
// the differentiator. Biggest by net units, then by dollars.
function findHero(report: AddressReport) {
  const candidates = report.changes.filter(
    (c) => c.category === 'construction' && ((c.units_delta ?? 0) > 0 || (c.value ?? 0) >= 500_000),
  )
  if (candidates.length === 0) return null
  const score = (c: (typeof candidates)[number]) => (c.units_delta ?? 0) * 1e9 + (c.value ?? 0)
  const best = candidates.reduce((a, b) => (score(b) > score(a) ? b : a))
  return {
    change: best,
    meters: Math.round(distanceM(report.query.lat, report.query.lon, best.lat, best.lon)),
  }
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

          {/* THE HERO — the biggest thing approved to be built near this point */}
          {(() => {
            const hero = findHero(report)
            if (!hero) return null
            const c = hero.change
            return (
              <div className="rc-hero">
                <div className="rc-hero-label">Approved to be built {hero.meters} m away</div>
                <div className="rc-hero-fact">
                  {(c.units_delta ?? 0) > 0
                    ? `+${Math.round(c.units_delta!)} housing units`
                    : c.headline}
                  {c.value ? <span className="rc-hero-cost"> · {fmtMoney(c.value)}</span> : null}
                </div>
                <div className="rc-hero-meta">
                  {c.detail?.split('—')[0]?.trim()} · {fmtDate(c.event_time)} ·{' '}
                  {c.citation.source} #{c.citation.record_key}
                </div>
              </div>
            )
          })()}

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

          {/* Reference attributes — the neighborhood's fixed facts (flood, EMS,
              schools, transit…), served with provenance by the backend. */}
          {Object.keys(report.attributes).length > 0 && (
            <div className="rc-section">
              <p className="rc-section-title">The fixed facts</p>
              <div className="rc-attrs">
                {Object.entries(report.attributes).map(([k, v]) => (
                  <span key={k} className="rc-attr">
                    {k.replace(/_/g, ' ')}: <b>{String(v)}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recent changes — construction & business as a list (the gold);
              safety/housing summarized as counts (the noise, still cited). */}
          {(() => {
            const listed = report.changes.filter(
              (c) => c.category === 'construction' || c.category === 'business',
            )
            const counted = report.changes.filter(
              (c) => c.category !== 'construction' && c.category !== 'business',
            )
            const counts = new Map<string, number>()
            for (const c of counted) {
              counts.set(c.event_type, (counts.get(c.event_type) ?? 0) + 1)
            }
            return (
              <div className="rc-section">
                <p className="rc-section-title">Most recent on record</p>
                {listed.slice(0, 6).map((c) => (
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
                {listed.length === 0 && (
                  <p className="rc-empty">No construction or business changes in the window.</p>
                )}
                {counts.size > 0 && (
                  <p className="rc-counts">
                    Also on record:{' '}
                    {[...counts.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, n]) => `${n} ${type.replace(/_/g, ' ')}${n > 1 ? 's' : ''}`)
                      .join(' · ')}
                  </p>
                )}
              </div>
            )
          })()}

          <p className="rc-footer">
            {report.changes.length} records · sources: {report.sources.map((s) => s.source).join(', ')}
            {report.pipeline_version ? ` · pipeline ${report.pipeline_version}` : ''}
          </p>
        </>
      )}
    </aside>
  )
}
