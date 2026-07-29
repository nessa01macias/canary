// Area news — the CLAIMS tier (GET /api/claims), news-derived and epistemically
// distinct from the record metrics. Every claim carries a verbatim quote + the
// outlet + the article URL; this module folds them into a per-neighborhood list
// of clickable headlines so a card can show WHERE its picture comes from and let
// someone read the source in full. Never mixed into metrics (DATA_CONTRACT #10).

// One clickable headline = one source article. Multiple claims can be extracted
// from the same URL, so we dedupe to the article and keep the best lead sentence.
export type Headline = {
  url: string
  outlet: string   // publication, e.g. "sfstandard.com"
  title: string    // the lead factual sentence (our headline text)
  date: string | null // best available date (event → expected → fetched), YYYY-MM-DD
}

type ApiClaim = {
  area: string
  outlet: string
  url: string
  claim: string
  entity_name: string | null
  event_time: string | null
  fetched_at: string | null
  status: string
}

// The outlet field is a bare domain ("sfstandard.com"). Publications get their
// masthead name; anything unmapped falls back to the domain minus the TLD.
const OUTLET_NAME: Record<string, string> = {
  'sfchronicle.com': 'SF Chronicle',
  'sfgate.com': 'SFGATE',
  'sfstandard.com': 'The SF Standard',
  'missionlocal.org': 'Mission Local',
  'hoodline.com': 'Hoodline',
  'sfist.com': 'SFist',
  'socketsite.com': 'SocketSite',
  'sfyimby.com': 'SF YIMBY',
  'therealdeal.com': 'The Real Deal',
  'bizjournals.com': 'SF Business Times',
}

export function outletName(outlet: string): string {
  const key = outlet.replace(/^www\./, '')
  return OUTLET_NAME[key] ?? key.replace(/\.[a-z]+$/, '')
}

function claimDate(c: ApiClaim): string | null {
  // The article's own date: when the event happened, else when we captured it.
  // NOT expected_date — that's a future planned opening, not a publication date.
  const raw = c.event_time || c.fetched_at
  return raw ? raw.slice(0, 10) : null
}

// Among the claims pulled from ONE article, pick the sentence that reads most
// like the LEAD, not a buried sub-clause. The article's own <title> isn't stored
// (and for a broad outlet it's often the citywide framing, not the neighborhood
// fact) — so we choose the most self-contained sentence: names the entity, opens
// like a fresh statement, and reads whole. Continuation openers ("Two of…", "The
// project will include…", "It will…") are what make a row feel like a fragment.
const CONTINUATION = /^(two|three|both|each|it|they|this|that|these|those|he|she|the (?:project|building|development|plan|site|store|space|proposal|application))\b/i

function bestTitle(claims: ApiClaim[]): string {
  const score = (c: ApiClaim) => {
    const t = c.claim.trim()
    let s = Math.min(t.length, 130) * 0.5  // some heft, but length can't dominate
    if (c.entity_name && t.includes(c.entity_name)) s += 120 // names the thing
    if (/^[A-Z]/.test(t)) s += 30           // opens like a statement
    if (/[.!?]$/.test(t)) s += 15           // is a whole sentence
    if (CONTINUATION.test(t)) s -= 90       // reads as mid-article, demote hard
    return s
  }
  return [...claims].sort((a, b) => score(b) - score(a))[0].claim.trim()
}

export async function fetchHeadlines(): Promise<Map<string, Headline[]>> {
  const res = await fetch('/api/claims?limit=1000')
  if (!res.ok) throw new Error(`/api/claims failed: ${res.status}`)
  const data: { claims: ApiClaim[] } = await res.json()

  // area → url → the claims from that article
  const byArea = new Map<string, Map<string, ApiClaim[]>>()
  for (const c of data.claims) {
    if (!c.area || !c.url || c.status === 'refuted') continue
    const articles = byArea.get(c.area) ?? new Map<string, ApiClaim[]>()
    const rows = articles.get(c.url) ?? []
    rows.push(c)
    articles.set(c.url, rows)
    byArea.set(c.area, articles)
  }

  const out = new Map<string, Headline[]>()
  for (const [area, articles] of byArea) {
    const headlines: Headline[] = [...articles.values()].map((rows) => ({
      url: rows[0].url,
      outlet: rows[0].outlet,
      title: bestTitle(rows),
      date: claimDate(rows[0]),
    }))
    // Most recent first — the point is RECENT headlines someone can read into.
    headlines.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    out.set(area, headlines)
  }
  return out
}
