// The give-to-get contribution (the moat). The frontend does NO database work:
// it POSTs to our own backend (/api/contributions), which is the only thing that
// touches Supabase. No DB client, no keys in the browser. Same-origin /api/* is
// proxied to FastAPI (Vite proxy in dev, Caddy in prod).

import { apiFetch } from './api'

export type ContributionRatings = {
  safety?: number
  noise?: number
  trajectory?: number
  [key: string]: number | undefined
}

export type ContributionInput = {
  h3_9?: string | null
  lat?: number | null
  lon?: number | null
  place_label?: string | null
  moving_out?: boolean
  ratings: ContributionRatings
  comment?: string | null
}

// One stable anonymous session id per browser, so anonymous submissions can be
// deduped without a login (keeps the give-to-get low-friction).
export function sessionId(): string {
  const KEY = 'canary_session_id'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(KEY, id)
  }
  return id
}

export type SubmitResult = { ok: true } | { ok: false; error: string }

export async function submitContribution(input: ContributionInput): Promise<SubmitResult> {
  try {
    const resp = await apiFetch('/api/contributions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, session_id: sessionId() }),
    })
    if (!resp.ok) {
      const body = await resp.text()
      return { ok: false, error: `Server ${resp.status}: ${body}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
