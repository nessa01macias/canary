// The B2B door: Canary for AI apps & agents. The consumer map is the demo;
// this page is the pitch. API is COMING SOON; the CTA collects interest only.
// TODO(melany): set the real early-access address before any public deploy.
const EARLY_ACCESS_EMAIL = 'hello@canary-placeholder.example'

type Props = { onClose: () => void; onOpenResearch: () => void }

// Real numbers from the benchmark (RESEARCH.md); real row from the trajectory table.
const SAMPLE_RESPONSE = `{
  "area_id": "Tenderloin",
  "metric": "crime_victim_reported",
  "last12": 4207,
  "prior12": 4574,
  "pct_change": -0.080,
  "definition": "incidents reported by victims; police enforcement is a separate metric",
  "source": "DataSF police incident reports",
  "source_as_of": "2026-07-24"
}`

export function ForAgents({ onClose, onOpenResearch }: Props) {
  return (
    <div className="agents-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="agents-page">
        <button className="drawer-close" onClick={onClose}>×</button>

        <p className="agents-eyebrow">FOR AI APPS &amp; AGENTS · API COMING SOON</p>
        <h1 className="agents-title">
          Your users ask <em>"should I move here?"</em><br />
          Your model answers from vibes.
        </h1>
        <p className="agents-sub">
          People bring their biggest place decisions to AI: where to live, buy, open a
          business. These are questions about a place's future, and we tested the five
          newest frontier models on 43 of them. Alone, they scored about 40%, failing
          not for lack of intelligence but because the answers were never published
          anywhere. Reading from one Canary response, three of the five scored a
          perfect 100%. Canary computes what no one has written down, monthly, from
          public records, with a citation on every number.
        </p>

        <div className="agents-stats">
          <div className="agents-stat">
            <span className="agents-stat-num">0 / 25</span>
            <span className="agents-stat-label">the five newest frontier models, asked which SF neighborhood is rising fastest. Zero correct answers</span>
          </div>
          <div className="agents-stat">
            <span className="agents-stat-num">43% → 100%</span>
            <span className="agents-stat-label">Claude Fable 5 on 43 checkable neighborhood questions, bare vs with one Canary response. Grok 4.5: same</span>
          </div>
          <div className="agents-stat">
            <span className="agents-stat-num">25 / 43</span>
            <span className="agents-stat-label">Grok 4.5 answers that were confidently wrong. Newer models don't refuse anymore; they guess fluently</span>
          </div>
        </div>
        <button className="agents-research-link" onClick={onOpenResearch}>
          Read the research →
        </button>

        <h2 className="agents-h2">The API</h2>
        <ul className="agents-list">
          <li><strong>Trajectory.</strong> How each area is changing: business churn, construction investment, victim-reported crime vs enforcement, complaints. Per dimension, never a composite score.</li>
          <li><strong>Forward layer.</strong> What is approved to be built near any address: units, cost, permit numbers.</li>
          <li><strong>Address report.</strong> One call: everything changing within 300m, cited and dated.</li>
          <li><strong>Catalog.</strong> Every metric ships with its definition, so your agent gets the meaning, not just the number.</li>
        </ul>

        <h2 className="agents-h2">Example response</h2>
        <pre className="agents-sample"><code>{SAMPLE_RESPONSE}</code></pre>

        <h2 className="agents-h2">Who this is for</h2>
        <p className="agents-provenance">
          AI products whose users decide about places: real estate and rental
          assistants, relocation tools, answer engines. And teams making those calls
          themselves: insurers, lenders, land and site selection.
        </p>

        <div className="agents-cta">
          <a className="agents-cta-btn" href={`mailto:${EARLY_ACCESS_EMAIL}?subject=Canary%20API%20early%20access`}>
            Request early access
          </a>
        </div>

        <p className="agents-footnote">
          The consumer map stays free. The API sells freshness and guarantees, never the commons.
        </p>
      </div>
    </div>
  )
}
