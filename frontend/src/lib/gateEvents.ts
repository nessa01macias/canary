// Fake-door gate instrumentation. Two events, one number at the end:
// completed-sessions / shown-sessions per variant (>15-20% = flywheel real).
//
// Usage from the gate UI (wherever the design lands):
//   import { gateVariant, logGateShown, logGateCompleted } from './lib/gateEvents'
//   - render the variant returned by gateVariant()  ('report_unlock' | 'founding')
//   - call logGateShown(area) when the gate becomes visible (deduped per session+area)
//   - call logGateCompleted(area) after a successful contribution submit

import { apiFetch } from './api'

export type GateVariant = 'report_unlock' | 'founding'

function sessionId(): string {
  let id = localStorage.getItem('canary_session')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('canary_session', id)
  }
  return id
}

// Sticky 50/50 assignment: a returning visitor always sees the same gate.
export function gateVariant(): GateVariant {
  let v = localStorage.getItem('canary_gate_variant') as GateVariant | null
  if (v !== 'report_unlock' && v !== 'founding') {
    v = Math.random() < 0.5 ? 'report_unlock' : 'founding'
    localStorage.setItem('canary_gate_variant', v)
  }
  return v
}

function send(event: 'gate_shown' | 'gate_completed', area?: string) {
  // Fire-and-forget: analytics must never break the product.
  void apiFetch('/api/gate-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, variant: gateVariant(), session_id: sessionId(), area }),
  }).catch(() => {})
}

// gate_shown fires once per (session, area) — re-renders and reopens don't inflate
// the denominator. gate_completed is naturally rare; no dedupe needed.
export function logGateShown(area?: string) {
  const key = `canary_gate_shown:${area ?? '_'}`
  if (sessionStorage.getItem(key)) return
  sessionStorage.setItem(key, '1')
  send('gate_shown', area)
}

export function logGateCompleted(area?: string) {
  send('gate_completed', area)
}
