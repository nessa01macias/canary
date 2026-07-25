import ReactMarkdown from 'react-markdown'
import type { AskResult } from './useAsk'

// The answer strip — what replaced the chatbox. The omnibox takes a question,
// the MAP is the response (chips auto-applied, camera flown); this strip is the
// receipt: a one-paragraph grounded answer, what the map just did, citations,
// and two tappable refinements. Transient, dismissible, no thread, no bubbles.

type Props = {
  busy: boolean
  result: AskResult | null
  question: string | null
  onFollowup: (q: string) => void
  onShowNeighborhood: (nhood: string) => void
  onClose: () => void
}

export function AnswerStrip({ busy, result, question, onFollowup, onShowNeighborhood, onClose }: Props) {
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
          <div className="ask-md answer-md"><ReactMarkdown>{result.answer_md}</ReactMarkdown></div>

          {(result.applied_chips.length > 0 || result.neighborhoods.length > 0) && (
            <div className="answer-did">
              {result.applied_chips.length > 0 && (
                <span className="answer-did-item">✦ map ranked by {result.applied_chips.join(' + ')}</span>
              )}
              {result.neighborhoods.map((n) => (
                <button key={n} className="ask-action" onClick={() => onShowNeighborhood(n)}>
                  ⌖ {n}
                </button>
              ))}
            </div>
          )}

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
