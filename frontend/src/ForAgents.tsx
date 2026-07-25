// The B2B door: Canary for AI apps & agents. The consumer map is the demo;
// this page is the pitch. API is COMING SOON — the CTA collects interest only.
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
  "definition": "incidents reported by victims — crime as experienced;
                 enforcement activity is a separate metric",
  "source": "DataSF police incident reports",
  "source_as_of": "2026-07-24",
  "receipts": "per-record permalinks available at /api/changes"
}`

export function ForAgents({ onClose, onOpenResearch }: Props) {
  return (
    <div className="agents-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="agents-page">
        <button className="drawer-close" onClick={onClose}>×</button>

        <p className="agents-eyebrow">FOR AI APPS &amp; AGENTS · API COMING SOON</p>
        <h1 className="agents-title">
          Your model knows what a place <em>is</em>.<br />
          Canary knows what it's <em>becoming</em>.
        </h1>
        <p className="agents-sub">
          Maps APIs say "4.2 stars, open till 10." Fresh-web APIs know the chef left.
          Canary knows the <strong>whole block is changing</strong> — three towers approved
          next door, storefronts churning, victim-reported crime falling while enforcement
          doubles — computed monthly from public records, with a citation on every number.
        </p>

        {/* The proof strip: the benchmark, in three tiles */}
        <div className="agents-stats">
          <div className="agents-stat">
            <span className="agents-stat-num">0% → 85%</span>
            <span className="agents-stat-label">GPT-4o on 46 checkable neighborhood questions, bare vs with one Canary response</span>
          </div>
          <div className="agents-stat">
            <span className="agents-stat-num">39% → 91%</span>
            <span className="agents-stat-label">Perplexity (live web search) — search can't retrieve answers nobody ever published</span>
          </div>
          <div className="agents-stat">
            <span className="agents-stat-num">3 / 3</span>
            <span className="agents-stat-label">frontier models that named the same wrong neighborhood for "biggest rise in business openings"</span>
          </div>
        </div>
        <button className="agents-research-link" onClick={onOpenResearch}>
          Read the research →
        </button>

        <h2 className="agents-h2">What the API serves</h2>
        <ul className="agents-list">
          <li><strong>Area trajectory, per dimension</strong> — business openings/closings, construction investment, victim-reported crime vs enforcement activity, complaints — each as trailing-12-month change with the records behind it. Never a composite "good/bad" score.</li>
          <li><strong>The forward layer</strong> — what is <em>approved to be built</em> within a radius of any address: units, cost, permit numbers. The question no maps API answers.</li>
          <li><strong>Address report</strong> — one call: everything changing within 300m, cited and dated.</li>
          <li><strong>Machine-readable catalog</strong> — every metric ships with its definition and caveats. Grounded models misread a police crackdown as a crime wave until we attached semantics; your agent gets the meaning, not just the number.</li>
        </ul>

        <h2 className="agents-h2">One response, with receipts</h2>
        <pre className="agents-sample"><code>{SAMPLE_RESPONSE}</code></pre>
        <p className="agents-provenance">
          Every row carries its source and as-of date. Agents don't need more text —
          they need <strong>anchors</strong>: facts that exist in the public record, checkable
          by anyone, updated monthly, with history that compounds.
        </p>

        <div className="agents-cta">
          <a className="agents-cta-btn" href={`mailto:${EARLY_ACCESS_EMAIL}?subject=Canary%20API%20early%20access`}>
            Request early access
          </a>
          <span className="agents-cta-note">
            API in private preview · San Francisco first, engine is metro-agnostic
          </span>
        </div>

        <p className="agents-footnote">
          The consumer map stays free. Open data in, open answers out — the API sells
          freshness, forecasts, and guarantees, never the commons.
        </p>
      </div>
    </div>
  )
}
