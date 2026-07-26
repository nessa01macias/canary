import ReactMarkdown from 'react-markdown'
import type { AskResult, Block } from './useAsk'
import { Sparkline } from './ReportCard'

// The answer canvas — what replaced the chatbox. The omnibox takes a question;
// the model COMPOSES this interface from a blessed block registry and the server
// hydrated every number from DuckDB. Transient card under the navbar; the MAP is
// the real response (rank_map/flyto auto-execute in App). No thread, no bubbles.

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

const fmt = (v: number | null) => (v == null ? '–' : v.toFixed(1))

type Props = {
  busy: boolean
  result: AskResult | null
  question: string | null
  onFollowup: (q: string) => void
  onShowNeighborhood: (nhood: string) => void
  residentUnlocked: boolean
  onUnlockResidents: () => void
  onClose: () => void
}

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
            safety <b>{fmt(block.safety)}</b> · quiet <b>{fmt(block.quiet)}</b> · getting better{' '}
            <b>{fmt(block.getting_better)}</b> <span className="answer-residents-scale">/5</span>
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

export function AnswerStrip({
  busy,
  result,
  question,
  onFollowup,
  onShowNeighborhood,
  residentUnlocked,
  onUnlockResidents,
  onClose,
}: Props) {
  if (!busy && !result) return null

  return (
    <div className="answer-strip">
      {busy ? (
        <div className="answer-busy">
          <span className="rc-loading-pulse" />
          Reading the public record{question ? ` — “${question}”` : '…'}
        </div>
      ) : result ? (
        <>
          <button className="drawer-close answer-close" onClick={onClose}>×</button>

          {result.blocks.map((b, i) => (
            <BlockView
              key={i}
              block={b}
              onShowNeighborhood={onShowNeighborhood}
              residentUnlocked={residentUnlocked}
              onUnlockResidents={onUnlockResidents}
            />
          ))}

          {result.followups.length > 0 && (
            <div className="answer-followups">
              {result.followups.map((f) => (
                <button key={f} className="ask-followup" onClick={() => onFollowup(f)}>{f}</button>
              ))}
            </div>
          )}

          <div className="answer-grounding">
            Grounded in SF public records
            {result.grounded_on?.as_of ? ` · as of ${result.grounded_on.as_of}` : ''} · never invented
          </div>
        </>
      ) : null}
    </div>
  )
}
