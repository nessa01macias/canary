import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { AskResult, Block, Mission } from './useAsk'
import type { ResidentAgg } from './residentLayer'
import type { AddressReport } from './report'
import { CHANGE_META, KIND_COLOR, KIND_LABEL, STAGE_META } from './samplePoints'
import { SpotReportBody, Sparkline } from './ReportCard'
import { directionLine, evidenceLines, verdict, type NbhdCardData } from './interpreter'
import { parentScope, type Scope } from './scope'
import { logGateShown } from './lib/gateEvents'

// THE PlaceCard — the one conversation about whatever you're pointing at.
// Replaces the news card, the report card, the point drawer, and the answer
// strip. Its SCOPE morphs along the ladder (city → neighborhood → spot →
// record); the camera+drawing effect in App keeps the map framing exactly what
// this card describes. Same anatomy at every rung, so a user learns it once:
// direction line → evidence (cited, with scope badges) → residents (gated) →
// ask input. Every card ends in a question box: conversation lives INSIDE the
// thing it's about, not in a chatbox somewhere else.

const METRIC_LABEL: Record<string, string> = {
  permits_issued: 'Permits issued',
  units_approved_net: 'Housing units approved',
  biz_openings: 'Business openings',
  biz_closings: 'Business closings',
  crime_incidents: 'Crime incidents',
  crime_victim_reported: 'Crime (victim-reported)',
  threeoneone_noise: 'Noise complaints (311)',
  threeoneone_cleaning: 'Street cleaning (311)',
  evictions_filed: 'Evictions filed',
}

const fmt5 = (v: number | null) => (v == null ? '–' : v.toFixed(1))

// ---------------------------------------------------------------------------
// Ask blocks (moved from AnswerStrip) — the model arranges, the server
// hydrated every number; this only renders.
// ---------------------------------------------------------------------------
function BlockView({
  block,
  onShowNeighborhood,
  residentUnlocked,
  onUnlockResidents,
}: {
  block: Block
  onShowNeighborhood: (n: string) => void
  residentUnlocked: boolean
  onUnlockResidents: () => void
}) {
  switch (block.type) {
    case 'answer':
      return <div className="ask-md answer-md"><ReactMarkdown>{block.md}</ReactMarkdown></div>

    case 'rank_map':
      return (
        <div className="answer-did">
          <span className="answer-did-item">✦ map ranked by {block.chips.join(' + ')}</span>
        </div>
      )

    case 'flyto':
      return (
        <div className="answer-did">
          <button className="ask-action" onClick={() => onShowNeighborhood(block.neighborhood)}>
            ⌖ {block.neighborhood}
          </button>
        </div>
      )

    case 'compare':
      return (
        <div className="answer-compare">
          {block.areas.map((area) => (
            <div key={area} className="answer-compare-col">
              <div className="answer-compare-area">{area}</div>
              {block.metrics.map((metric) => {
                const series = block.series[area]?.[metric] ?? []
                const latest = series.length ? series[series.length - 1].value : null
                return (
                  <div key={metric} className="answer-compare-metric">
                    <span className="answer-compare-label">{METRIC_LABEL[metric] ?? metric}</span>
                    <Sparkline series={series} />
                    <span className="answer-compare-val">{latest != null ? Math.round(latest) : '–'}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )

    case 'residents':
      return (
        <div className="answer-residents">
          <div className="answer-residents-head">Residents say · {block.area} ({block.n_reviews})</div>
          <div className={`answer-residents-vals${residentUnlocked ? '' : ' is-locked'}`}>
            safety <b>{fmt5(block.safety)}</b> · quiet <b>{fmt5(block.quiet)}</b> · getting better{' '}
            <b>{fmt5(block.getting_better)}</b> <span className="answer-residents-scale">/5</span>
          </div>
          {!residentUnlocked && (
            <button className="answer-unlock" onClick={onUnlockResidents}>
              🔒 Review a neighborhood you know to unlock what residents said
            </button>
          )}
        </div>
      )

    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Shared anatomy pieces
// ---------------------------------------------------------------------------
function ResidentsSay({
  area,
  agg,
  unlocked,
  onUnlock,
}: {
  area: string
  agg: ResidentAgg | null | undefined
  unlocked: boolean
  onUnlock: () => void
}) {
  if (!agg) return null
  if (!unlocked) logGateShown(area) // fake-door instrumentation (deduped per session+area)
  return (
    <div className="answer-residents pc-residents">
      <div className="answer-residents-head">Residents say ({agg.n})</div>
      <div className={`answer-residents-vals${unlocked ? '' : ' is-locked'}`}>
        safety <b>{fmt5(agg.safety)}</b> · quiet <b>{fmt5(agg.noise)}</b> · getting better{' '}
        <b>{fmt5(agg.trajectory)}</b> <span className="answer-residents-scale">/5</span>
      </div>
      {!unlocked && (
        <button className="answer-unlock" onClick={onUnlock}>
          🔒 Review a neighborhood you know to unlock what residents said
        </button>
      )}
    </div>
  )
}

// One-click ground truth: deep links OUT to Google (the keyless Maps URLs —
// linking out is free and ToS-clean; embedding Google tiles or Places data in
// our map would not be). The familiar gut-check lives one click away.
function GroundTruth({ lat, lon }: { lat: number; lon: number }) {
  const at = `${lat.toFixed(6)}%2C${lon.toFixed(6)}`
  return (
    <p className="pc-groundtruth">
      see it for yourself ·{' '}
      <a href={`https://www.google.com/maps/search/?api=1&query=${at}`} target="_blank" rel="noopener noreferrer">
        Google Maps ↗
      </a>{' '}
      <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${at}`} target="_blank" rel="noopener noreferrer">
        Street View ↗
      </a>
    </p>
  )
}

export type AskSectionState = {
  busy: boolean
  result: AskResult | null
  lastQuestion: string | null
  submit: (q: string) => void
}

function AskSection({
  placeholder,
  ask,
  onShowNeighborhood,
  residentUnlocked,
  onUnlockResidents,
}: {
  placeholder: string
  ask: AskSectionState
  onShowNeighborhood: (n: string) => void
  residentUnlocked: boolean
  onUnlockResidents: () => void
}) {
  const [q, setQ] = useState('')
  const send = () => {
    if (!q.trim() || ask.busy) return
    ask.submit(q.trim())
    setQ('')
  }
  return (
    <div className="pc-ask">
      <div className="pc-ask-inputrow">
        <input
          className="pc-ask-input"
          value={q}
          placeholder={placeholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
        />
        <button className="pc-ask-send" onClick={send} disabled={ask.busy || !q.trim()} aria-label="Ask">
          ↑
        </button>
      </div>

      {ask.busy && (
        <div className="pc-ask-busy">
          <span className="rc-loading-pulse" />
          Reading the public record{ask.lastQuestion ? ` — “${ask.lastQuestion}”` : '…'}
        </div>
      )}

      {!ask.busy && ask.result && (
        <div className="pc-ask-result">
          {ask.result.blocks.map((b, i) => (
            <BlockView
              key={i}
              block={b}
              onShowNeighborhood={onShowNeighborhood}
              residentUnlocked={residentUnlocked}
              onUnlockResidents={onUnlockResidents}
            />
          ))}
          {ask.result.followups.length > 0 && (
            <div className="answer-followups">
              {ask.result.followups.map((f) => (
                <button key={f} className="ask-followup" onClick={() => ask.submit(f)}>{f}</button>
              ))}
            </div>
          )}
          <div className="answer-grounding">
            Grounded in SF public records
            {ask.result.grounded_on?.as_of ? ` · as of ${ask.result.grounded_on.as_of}` : ''} · never invented
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------
type Props = {
  scope: Scope
  onScope: (next: Scope | null) => void
  mission: Mission | null
  nbhd?: NbhdCardData | null            // resolved for neighborhood scope
  residents?: ResidentAgg | null        // for neighborhood scope
  report?: AddressReport | null         // for spot scope
  reportLoading?: boolean
  cityIntro?: string | null             // the wizard's receipt line (city scope)
  matchTop?: string[]                   // best-fit names for the city rung
  residentUnlocked: boolean
  onUnlockResidents: () => void
  ask: AskSectionState
}

function Breadcrumb({ scope, onScope }: { scope: Scope; onScope: (s: Scope | null) => void }) {
  // Climbable trail: SF › Mission › this spot › record. Ancestors are buttons.
  const trail: { label: string; target: Scope | null }[] = []
  let cur: Scope | null = scope
  const label = (s: Scope) =>
    s.kind === 'city' ? 'San Francisco'
    : s.kind === 'neighborhood' ? s.nhood
    : s.kind === 'spot' ? 'this spot'
    : 'record'
  while (cur) {
    trail.unshift({ label: label(cur), target: cur })
    cur = parentScope(cur)
  }
  return (
    <nav className="pc-crumbs" aria-label="Scope">
      {trail.map((t, i) =>
        i < trail.length - 1 ? (
          <span key={i}>
            <button className="pc-crumb" onClick={() => onScope(t.target)}>{t.label}</button>
            <span className="pc-crumb-sep">›</span>
          </span>
        ) : (
          <span key={i} className="pc-crumb pc-crumb--here">{t.label}</span>
        ),
      )}
    </nav>
  )
}

export function PlaceCard({
  scope,
  onScope,
  mission,
  nbhd,
  residents,
  report,
  reportLoading,
  cityIntro,
  matchTop = [],
  residentUnlocked,
  onUnlockResidents,
  ask,
}: Props) {
  const showNeighborhood = (n: string) => onScope({ kind: 'neighborhood', nhood: n })
  const askPlaceholder =
    scope.kind === 'city' ? 'Ask about San Francisco…'
    : scope.kind === 'neighborhood' ? `Ask about ${scope.nhood}…`
    : scope.kind === 'spot' ? 'Ask about this spot…'
    : 'Ask about this record…'

  return (
    <aside className={`place-card place-card--${scope.kind}`}>
      <button className="drawer-close pc-close" onClick={() => onScope(null)} aria-label="Close">×</button>
      <Breadcrumb scope={scope} onScope={onScope} />

      {/* ── Rung bodies ─────────────────────────────────────────────────── */}
      {scope.kind === 'city' && (
        <div className="pc-body">
          <h3 className="pc-title">San Francisco</h3>
          {cityIntro && <p className="pc-direction">{cityIntro}</p>}
          {matchTop.length > 0 && (
            <div className="pc-cityfits">
              {matchTop.map((n) => (
                <button key={n} className="ask-action" onClick={() => showNeighborhood(n)}>
                  ⌖ {n}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {scope.kind === 'neighborhood' && nbhd && (() => {
        const v = verdict(nbhd.traj)
        const evidence = evidenceLines(nbhd, mission)
        return (
          <div className="pc-body">
            <span className={`news-verdict news-verdict-${v.tone}`}>{v.glyph} {v.label}</span>
            <h3 className="pc-title">{nbhd.nhood}</h3>
            <p className="pc-direction">{directionLine(nbhd, mission)}</p>

            <p className="pc-section-label">Why — from the public record</p>
            <div className="pc-evidence">
              {evidence.map((h, i) => (
                <div key={i} className={`headline-row headline-${h.tone}`}>
                  <span className="headline-tick" aria-hidden="true">
                    {h.tone === 'up' ? '▲' : h.tone === 'down' ? '▼' : '·'}
                  </span>
                  <div className="headline-body">
                    <div className="headline-title">{h.text}</div>
                    <div className="headline-cite">
                      {h.source} · {h.date} · <span className="pc-badge">this neighborhood · 12 vs 12 mo</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <ResidentsSay
              area={nbhd.nhood}
              agg={residents}
              unlocked={residentUnlocked}
              onUnlock={onUnlockResidents}
            />

            {scope.clickLngLat && (
              <button
                className="news-report-btn"
                onClick={() =>
                  onScope({ kind: 'spot', lat: scope.clickLngLat![1], lon: scope.clickLngLat![0] })
                }
              >
                What's changing at this spot →
              </button>
            )}
          </div>
        )
      })()}

      {scope.kind === 'spot' && (
        <div className="pc-body">
          <p className="drawer-kind">What's changing here</p>
          <h3 className="pc-title">
            {report?.query.display_name ?? 'This spot'}
            <span className="rc-sub"> · within ~500 m · last 24 months</span>
          </h3>
          <SpotReportBody report={report ?? null} loading={!!reportLoading} />
          <GroundTruth lat={scope.lat} lon={scope.lon} />
        </div>
      )}

      {scope.kind === 'record' && (() => {
        const p = scope.point
        return (
          <div className="pc-body pc-record">
            <div className="drawer-accent" style={{ background: KIND_COLOR[p.kind] }} />
            <div className="drawer-toprow">
              <p className="drawer-kind">
                {p.changeType ? CHANGE_META[p.changeType].label : KIND_LABEL[p.kind]}
              </p>
              {p.stage && (
                <span className={`stage-badge ${STAGE_META[p.stage].cls}`}>
                  {STAGE_META[p.stage].label}
                  <em>· {STAGE_META[p.stage].hint}</em>
                </span>
              )}
            </div>

            <h3 className="pc-title">{p.neighborhood ?? p.city}</h3>

            {p.changeLabel && (
              <div className="delta-hero">
                <span className="delta-glyph">
                  {p.changeType ? CHANGE_META[p.changeType].glyph || '·' : '·'}
                </span>
                <span className="delta-text">{p.changeLabel}</span>
              </div>
            )}
            {p.changeType && <p className="delta-blurb">{CHANGE_META[p.changeType].blurb}</p>}

            <div className="delta-chips">
              {p.existingUse && p.proposedUse && p.existingUse !== p.proposedUse && (
                <span className="chip">use <b>{p.existingUse}</b> → <b>{p.proposedUse}</b></span>
              )}
              {p.existingUnits !== undefined && p.proposedUnits !== undefined &&
                p.existingUnits !== p.proposedUnits && (
                <span className="chip">units <b>{p.existingUnits}</b> → <b>{p.proposedUnits}</b></span>
              )}
              {p.existingStories !== undefined && p.proposedStories !== undefined &&
                p.existingStories !== p.proposedStories && (
                <span className="chip">stories <b>{p.existingStories}</b> → <b>{p.proposedStories}</b></span>
              )}
              {p.cost ? <span className="chip">est. <b>${p.cost.toLocaleString()}</b></span> : null}
            </div>

            {p.detail && <p className="drawer-detail">{p.detail}</p>}
            <p className="drawer-source">→ {p.source}{p.neighborhood ? ` · ${p.neighborhood}` : ''}</p>
            <GroundTruth lat={p.lat} lon={p.lng} />

            <button
              className="news-report-btn"
              onClick={() => onScope({ kind: 'spot', lat: p.lat, lon: p.lng })}
            >
              What else is changing around this →
            </button>
          </div>
        )
      })()}

      {/* ── The ask — every rung ends in a question box ─────────────────── */}
      <AskSection
        placeholder={askPlaceholder}
        ask={ask}
        onShowNeighborhood={showNeighborhood}
        residentUnlocked={residentUnlocked}
        onUnlockResidents={onUnlockResidents}
      />
    </aside>
  )
}
