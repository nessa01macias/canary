// Social-proof news headlines for a neighborhood, aligned to its trajectory score
// so the cards back up the map's verdict (improving → development/investment;
// worsening → crime/vacancy). DESIGN CONVENTION: same as `crimeTrend` / `tagScore`
// in App.tsx — a deterministic PLACEHOLDER that's fully wired. Swap the body of
// `neighborhoodHeadlines` for a real news API (query = neighborhood + a recent date
// window, ranked by relevance to the trend) and the click popup works unchanged.

export type Headline = { title: string; source: string; date: string }

// Real Bay Area outlets → the citation reads as genuine social proof.
const SOURCES = [
  'San Francisco Chronicle',
  'Mission Local',
  'The San Francisco Standard',
  'SFGATE',
  'The San Francisco Examiner',
  'Hoodline SF',
  'SF Business Times',
  'KQED',
]

// {n} = neighborhood, {units} = a unit count, {pct} = a percentage.
const IMPROVING = [
  'New {units}-unit housing development breaks ground in {n}',
  '{n} building permits jump {pct}% as developers add density',
  'Mixed-use project clears review, bringing {units} homes to {n}',
  'Retailers return to {n} as long-vacant storefronts reopen',
  'City fast-tracks ADU construction across {n}',
  'Investors pour capital into {n} corridor redevelopment',
  '{n} transit upgrades spur fresh housing proposals',
  'Home values climb in {n} as new construction accelerates',
]

const WORSENING = [
  'Break-ins climb {pct}% year-over-year in {n}, police data shows',
  'Storefront vacancies mount along {n}’s main corridor',
  '{n} merchants cite safety fears as foot traffic drops',
  'Residents pack meeting over rising property crime in {n}',
  'Another longtime {n} business shutters amid slow recovery',
  '{n} retail vacancy hits a multi-year high',
  'Car break-ins spike near {n}’s commercial strip',
  '{n} neighbors organize after a string of burglaries',
]

const FLAT = [
  '{n} weighs a zoning overhaul at packed community hearing',
  'Permit activity holds steady in {n}, city records show',
  '{n} board debates the future of a vacant lot',
  'Mixed signals for {n} as development cools',
  '{n} small businesses navigate an uneven recovery',
]

// FNV-1a → a stable unit-free integer per string key.
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// Fixed anchor (not `now`) so a headline's date is stable no matter when it's
// opened. Dates fan out from ~2 weeks to ~20 months before this.
const ANCHOR = Date.UTC(2026, 5, 30)
const DAY = 86_400_000

function fmtDate(seed: number): number {
  return ANCHOR - (15 + (seed % 585)) * DAY // returns a timestamp; formatted after sort
}

// A neighborhood's headline feed. `traj` ∈ [-1, 1] picks the pool; the count and
// every field are hashed off the name so a given neighborhood always shows the
// same cards.
export function neighborhoodHeadlines(nhood: string, traj: number): Headline[] {
  const pool = traj > 0.12 ? IMPROVING : traj < -0.12 ? WORSENING : FLAT
  const count = 3 + (hash(`${nhood}#count`) % 3) // 3..5 cards

  const used = new Set<number>()
  const rows: Array<{ title: string; source: string; ts: number }> = []
  for (let i = 0; i < count; i++) {
    // Distinct template per card.
    let ti = hash(`${nhood}#t${i}`) % pool.length
    while (used.has(ti) && used.size < pool.length) ti = (ti + 1) % pool.length
    used.add(ti)

    const units = 6 + (hash(`${nhood}#u${i}`) % 135) // 6..140
    const pct = 11 + (hash(`${nhood}#p${i}`) % 42) // 11..52
    const title = pool[ti]
      .replaceAll('{n}', nhood)
      .replaceAll('{units}', String(units))
      .replaceAll('{pct}', String(pct))

    rows.push({
      title,
      source: SOURCES[hash(`${nhood}#s${i}`) % SOURCES.length],
      ts: fmtDate(hash(`${nhood}#d${i}`)),
    })
  }

  // Newest first, like a real feed.
  rows.sort((a, b) => b.ts - a.ts)
  return rows.map(({ title, source, ts }) => {
    const d = new Date(ts)
    return { title, source, date: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` }
  })
}
