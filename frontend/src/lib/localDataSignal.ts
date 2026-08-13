// Landing page's "what unscrapable local knowledge would be most valuable"
// prompt (see LandingDataPrompt.tsx) — a research signal for a possible
// future consumer product, not a support/contact channel. One submission per
// session; dedupe lives in the component (sessionStorage), not here.

import { apiFetch } from './api'
import { sessionId } from './gateEvents'

export function logLocalDataAnswer(answer: string): Promise<void> {
  // Fire-and-forget: this must never surface an error to the visitor or
  // block the UI — same contract as gateEvents' send().
  return apiFetch('/api/local-data-signals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer, session_id: sessionId() }),
  }).then(() => undefined).catch(() => undefined)
}
