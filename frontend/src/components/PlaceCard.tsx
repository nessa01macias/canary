import ReactMarkdown from 'react-markdown'
import type { AskTurn, Block, Mission } from '../lib/useAsk'
import type { ResidentAgg } from '../lib/residentLayer'
import { outletName, type Headline } from '../lib/claims'
import type { AddressReport } from '../lib/report'
import { CHANGE_META, KIND_COLOR, KIND_LABEL, STAGE_META } from '../lib/samplePoints'
import { SpotReportBody, Sparkline } from './ReportCard'
import { directionLine, evidenceLines, verdict, type CityFacts, type NbhdCardData } from '../lib/interpreter'
import { parentScope, type Scope } from '../lib/scope'
import { logGateShown } from '../lib/gateEvents'

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
          <span className="answer-did-item">
            ✦ ranked the map by {block.chips.join(' + ')} — now in <b>your picks</b> (left panel), tap any to toggle
          </span>
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
  // Renders on EVERY neighborhood card — the give-to-get funnel is
  // see-the-locked-thing → want it → contribute → unlock, and a gate that only
  // appears where people already contributed can never bootstrap the moat.
  if (!unlocked) logGateShown(area) // fake-door instrumentation (deduped per session+area)
  return (
    <div className="answer-residents pc-residents">
      <div className="answer-residents-head">Residents say{agg ? ` (${agg.n})` : ''}</div>
      {agg ? (
        <div className={`answer-residents-vals${unlocked ? '' : ' is-locked'}`}>
          safety <b>{fmt5(agg.safety)}</b> · quiet <b>{fmt5(agg.noise)}</b> · getting better{' '}
          <b>{fmt5(agg.trajectory)}</b> <span className="answer-residents-scale">/5</span>
        </div>
      ) : (
        <div className="answer-residents-vals answer-residents-empty">
          No resident reviews here yet.
        </div>
      )}
      {!unlocked ? (
        <button className="answer-unlock" onClick={onUnlock}>
          🔒 {agg
            ? 'Review a neighborhood you know to unlock what residents said'
            : `Be the first to review ${area} — one review unlocks resident insights across all of SF`}
        </button>
      ) : !agg ? (
        <button className="answer-unlock" onClick={onUnlock}>
          ＋ Add the first review for {area}
        </button>
      ) : null}
    </div>
  )
}

// In the news — the CLAIMS tier surfaced as its OWN card: 3–5 recent, clickable
// headlines so a reader can leave our report and go read the source. Publication
// + date leads each row (the byline the mockup's quotation mark used to hold);
// the headline itself is the link out. Announced/unverified by nature — the card
// says so once, quietly, rather than dressing claims up as record facts.
function fmtNewsDate(date: string | null): string {
  if (!date) return ''
  const d = new Date(`${date}T00:00:00`)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function NewsHeadlines({ headlines }: { headlines: Headline[] }) {
  if (!headlines.length) return null
  const top = headlines.slice(0, 5)
  return (
    <section className="pc-news" aria-label="In the news">
      <p className="pc-section-label">In the news</p>
      <div className="pc-news-list">
        {top.map((h) => (
          <a
            key={h.url}
            className="pc-news-item"
            href={h.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="pc-news-meta">
              <span className="pc-news-outlet">{outletName(h.outlet)}</span>
              {h.date && (
                <>
                  <span className="pc-news-dot">·</span>
                  <time className="pc-news-date" dateTime={h.date}>{fmtNewsDate(h.date)}</time>
                </>
              )}
            </span>
            <span className="pc-news-title">{h.title}</span>
            <span className="pc-news-arrow" aria-hidden="true">↗</span>
          </a>
        ))}
      </div>
      <p className="pc-news-foot">Announced in local press · read the source, then check the record above</p>
    </section>
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
  turns: AskTurn[]
  lastQuestion: string | null
  submit: (q: string) => void
}

function AskSection({
  ask,
  onShowNeighborhood,
  residentUnlocked,
  onUnlockResidents,
}: {
  ask: AskSectionState
  onShowNeighborhood: (n: string) => void
  residentUnlocked: boolean
  onUnlockResidents: () => void
}) {
  const last = ask.turns.length - 1
  if (ask.turns.length === 0 && !ask.busy) return null
  return (
    <div className="pc-ask">
      {/* No input here — THE box (docked directly above this card) is the one
          place to type; this section is the conversation it produces.
          Stacked turns: replying never deletes what came before. */}
      {ask.turns.map((t, i) => (
        <div key={i} className={`pc-turn${i === last ? ' is-latest' : ''}`}>
          <div className="pc-turn-q">{t.question}</div>
          {t.result.blocks.map((b, j) => (
            <BlockView
              key={j}
              block={b}
              onShowNeighborhood={onShowNeighborhood}
              residentUnlocked={residentUnlocked}
              onUnlockResidents={onUnlockResidents}
            />
          ))}
          {i === last && !ask.busy && t.result.followups.length > 0 && (
            <div className="answer-followups">
              {t.result.followups.map((f) => (
                <button key={f} className="ask-followup" onClick={() => ask.submit(f)}>{f}</button>
              ))}
            </div>
          )}
        </div>
      ))}

      {ask.busy && (
        <div className="pc-ask-busy">
          <span className="rc-loading-pulse" />
          Reading the public record{ask.lastQuestion ? ` — “${ask.lastQuestion}”` : '…'}
        </div>
      )}

      {ask.turns.length > 0 && (
        <div className="answer-grounding">
          Grounded in SF public records
          {ask.turns[last]?.result.grounded_on?.as_of
            ? ` · as of ${ask.turns[last].result.grounded_on!.as_of}`
            : ''} · never invented
        </div>
      )}
    </div>
  )
}

// The dock's placeholder tracks the card's scope — the box is the card's handle.
export function askPlaceholderFor(scope: Scope | null): string | undefined {
  if (!scope) return undefined
  return scope.kind === 'city' ? 'Ask about San Francisco…'
    : scope.kind === 'neighborhood' ? `Ask about ${scope.nhood}…`
    : scope.kind === 'spot' ? 'Ask about this spot…'
    : 'Ask about this record…'
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------
type Props = {
  scope: Scope
  onScope: (next: Scope | null) => void
  mission: Mission | null
  nbhd?: NbhdCardData | null            // resolved for neighborhood scope
  headlines?: Headline[]                // news claims for this area (neighborhood scope)
  residents?: ResidentAgg | null        // for neighborhood scope
  report?: AddressReport | null         // for spot scope
  reportLoading?: boolean
  cityIntro?: string | null             // the picker's receipt line (city scope)
  cityFacts?: CityFacts | null          // the city rung's dossier body
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
  headlines = [],
  residents,
  report,
  reportLoading,
  cityIntro,
  cityFacts,
  matchTop = [],
  residentUnlocked,
  onUnlockResidents,
  ask,
}: Props) {
  const showNeighborhood = (n: string) => onScope({ kind: 'neighborhood', nhood: n })

  return (
    <aside className={`place-card place-card--${scope.kind}`}>
      <button className="drawer-close pc-close" onClick={() => onScope(null)} aria-label="Close">×</button>
      <Breadcrumb scope={scope} onScope={onScope} />

      {/* ── Rung bodies ─────────────────────────────────────────────────── */}
      {scope.kind === 'city' && (
        <div className="pc-body">
          <h3 className="pc-title">San Francisco</h3>
          {cityIntro && <p className="pc-direction">{cityIntro}</p>}
          {/* Dossier first, always — the card is never a bare chat. */}
          {cityFacts && (
            <>
              <p className="pc-section-label">The city right now</p>
              {cityFacts.rising.length > 0 && (
                <div className="pc-cityrow">
                  <span className="pc-cityrow-label pc-cityrow-label--up">▲ rising fastest</span>
                  {cityFacts.rising.map((n) => (
                    <button key={n} className="ask-action" onClick={() => showNeighborhood(n)}>{n}</button>
                  ))}
                </div>
              )}
              {cityFacts.declining.length > 0 && (
                <div className="pc-cityrow">
                  <span className="pc-cityrow-label pc-cityrow-label--down">▼ under pressure</span>
                  {cityFacts.declining.map((n) => (
                    <button key={n} className="ask-action" onClick={() => showNeighborhood(n)}>{n}</button>
                  ))}
                </div>
              )}
              <p className="pc-citytotals">
                {cityFacts.permits} recent permits on record · +{cityFacts.netUnits} net housing units approved
              </p>
            </>
          )}
          {matchTop.length > 0 && (
            <>
              <p className="pc-section-label">Best fit for your picks</p>
              <div className="pc-cityfits">
                {matchTop.map((n) => (
                  <button key={n} className="ask-action" onClick={() => showNeighborhood(n)}>
                    ⌖ {n}
                  </button>
                ))}
              </div>
            </>
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
              {evidence.map((h, i) => {
                // One citation per run of same-source rows: show it on the LAST
                // row of the run so the two construction lines read as sharing
                // the source below them, not repeating it. Badge reflects the
                // row's real basis (snapshot count vs 12-vs-12 trend).
                const citeKey = `${h.source}·${h.date}·${h.basis}`
                const next = evidence[i + 1]
                const showCite = !next || `${next.source}·${next.date}·${next.basis}` !== citeKey
                return (
                  <div key={i} className={`headline-row headline-${h.tone}`}>
                    <span className="headline-tick" aria-hidden="true">
                      {h.tone === 'up' ? '▲' : h.tone === 'down' ? '▼' : '·'}
                    </span>
                    <div className="headline-body">
                      <div className="headline-title">{h.text}</div>
                      {showCite && (
                        <div className="headline-cite">
                          {h.source} · {h.date} ·{' '}
                          <span className="pc-badge">
                            this neighborhood · {h.basis === 'snapshot' ? 'snapshot' : '12 vs 12 mo'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <NewsHeadlines headlines={headlines} />

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
        ask={ask}
        onShowNeighborhood={showNeighborhood}
        residentUnlocked={residentUnlocked}
        onUnlockResidents={onUnlockResidents}
      />
    </aside>
  )
}
