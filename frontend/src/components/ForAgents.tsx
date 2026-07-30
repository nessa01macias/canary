import { useState } from 'react'

// The B2B door: Canary for AI apps & agents. The consumer map is the demo;
// this page is the pitch. Endpoints are real (backend/app/api/routes.py) but
// access is gated: the CTA collects interest only.
// TODO(melany): set the real early-access address before any public deploy.
const EARLY_ACCESS_EMAIL = 'hello@canary-placeholder.example'

type Props = { onClose: () => void; onOpenResearch: () => void }

type Endpoint = {
  key: string
  need: string          // the left-column "what do you need?" label
  needSub: string       // the path/name under it
  method: 'GET' | 'POST' | 'MCP'
  path: string
  tagline: string
  desc: string
  returns: string
  bestFor: string
  file: string          // fake filename on the code block's title bar
  code: string
  note?: string
}

// Paths, params, and numbers are real: routes from app/api/routes.py, the
// Japantown row from the trajectory table (RESEARCH.md Table receipt).
const ENDPOINTS: Endpoint[] = [
  {
    key: 'report',
    need: 'Everything near an address',
    needSub: '/api/report',
    method: 'GET',
    path: '/api/report',
    tagline: 'One call: what is this place becoming?',
    desc:
      'The per-dimension trajectory of the surrounding area plus everything ' +
      'approved for construction within the ring: units, costs, permit numbers. ' +
      'Every row carries its source and two dates (the record’s own as-of and ' +
      'our fetch). This is the exact object the benchmark’s grounded condition ' +
      'fed the models.',
    returns: 'Trajectory + approved construction, cited and dated',
    bestFor: 'Property-level questions: should I move here, what is being built next door',
    file: 'request.sh',
    code:
      'curl "https://canarylayer.com/api/report?lat=37.7599&lon=-122.4213&window_months=24" \\\n' +
      '  -H "Authorization: Bearer $CANARY_TOKEN"',
  },
  {
    key: 'trajectory',
    need: 'How an area is changing',
    needSub: '/api/trajectory',
    method: 'GET',
    path: '/api/trajectory',
    tagline: 'The derivative, per dimension, never a composite score',
    desc:
      'One metric’s movement for one area: trailing twelve months against the ' +
      'twelve before, percent change, and a citywide z-score. Victim-reported ' +
      'crime and enforcement activity are separate metrics by design, and the ' +
      'definition rides along with the number, because numbers without semantics ' +
      'fail. That last claim is measured, not asserted; it is in the research note.',
    returns: 'last12 / prior12 / % change / z, with definition and as-of date',
    bestFor: 'Rankings and comparisons: which area is rising, is crime actually falling',
    file: 'request.sh',
    code:
      'curl "https://canarylayer.com/api/trajectory?area_id=Japantown&area_level=neighborhood&metric=biz_openings" \\\n' +
      '  -H "Authorization: Bearer $CANARY_TOKEN"\n' +
      '\n' +
      '# →\n' +
      '{\n' +
      '  "area_id": "Japantown",\n' +
      '  "metric": "biz_openings",\n' +
      '  "last12": 69,\n' +
      '  "prior12": 50,\n' +
      '  "pct_change": 0.38,\n' +
      '  "definition": "new registered business locations; closures are a separate metric",\n' +
      '  "source": "DataSF registered business locations",\n' +
      '  "source_as_of": "2026-07-24"\n' +
      '}',
  },
  {
    key: 'ask',
    need: 'A cited answer to a question',
    needSub: '/api/ask',
    method: 'POST',
    path: '/api/ask',
    tagline: 'Natural language in, cited blocks out',
    desc:
      'Ask in plain language. A planner picks the right metrics from the ' +
      'catalog, the server hydrates every number from the record, and the ' +
      'answer arrives as structured blocks your app can render, each number ' +
      'traceable to its source.',
    returns: 'Structured answer blocks with citations',
    bestFor: 'Apps and agents that reason in language',
    file: 'request.sh',
    code:
      'curl -X POST https://canarylayer.com/api/ask \\\n' +
      '  -H "Content-Type: application/json" \\\n' +
      '  -H "Authorization: Bearer $CANARY_TOKEN" \\\n' +
      '  -d \'{\n' +
      '    "question": "Which SF neighborhood is rising fastest for new businesses?",\n' +
      '    "mission": "opening_business"\n' +
      '  }\'',
  },
  {
    key: 'mcp',
    need: 'Native to my agent',
    needSub: 'canary-mcp',
    method: 'MCP',
    path: 'canary-mcp',
    tagline: 'The same tools, speaking MCP',
    desc:
      'No glue code: report, trajectory, and the metric catalog surface as MCP ' +
      'tools your agent runtime discovers by itself. Field documentation rides ' +
      'along, so the agent reads meanings, not just numbers.',
    returns: 'report, trajectory, and catalog as discoverable tools',
    bestFor: 'Claude and other MCP-native agent runtimes',
    file: 'mcp.json',
    code:
      '{\n' +
      '  "mcpServers": {\n' +
      '    "canary": {\n' +
      '      "url": "https://canarylayer.com/api/mcp",\n' +
      '      "headers": { "Authorization": "Bearer $CANARY_TOKEN" }\n' +
      '    }\n' +
      '  }\n' +
      '}',
    note: 'The MCP server ships to early-access partners first.',
  },
]

export function ForAgents({ onClose, onOpenResearch }: Props) {
  const [activeKey, setActiveKey] = useState(ENDPOINTS[0].key)
  const [copied, setCopied] = useState(false)
  const ep = ENDPOINTS.find((e) => e.key === activeKey) ?? ENDPOINTS[0]

  const copy = () => {
    navigator.clipboard.writeText(ep.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="agents-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="agents-page">
        <button className="drawer-close" onClick={onClose}>×</button>

        <p className="agents-eyebrow">FOR AI APPS &amp; AGENTS · EARLY ACCESS</p>
        <h1 className="agents-title">
          Your users ask <em>"should I move here?"</em><br />
          Your model answers from vibes.
        </h1>
        <p className="agents-sub">
          Where should I live? Is this block getting better or worse? What is going up
          next door? Your users ask; today's models improvise. We tested the five
          newest frontier models on 136 questions like these, every one checkable
          against San Francisco's public record and verified against the city's own
          APIs before any model ran. Best unassisted score: 47%. The wrong answers
          came out confident, specific, and fluent. Then we prepended one Canary
          response and accuracy jumped to 95-99%. The models were never the problem.
          The answers had simply never been computed. Canary computes them monthly,
          from public records, with a citation on every number.
        </p>

        <div className="agents-stats">
          <div className="agents-stat">
            <span className="agents-stat-num">66 / 75</span>
            <span className="agents-stat-label">"which neighborhood changed most?" answered wrong. Asked what's rising fastest, the models gave four different confident answers. All four wrong</span>
          </div>
          <div className="agents-stat">
            <span className="agents-stat-num">40% → 99%</span>
            <span className="agents-stat-label">Claude Fable 5, before and after a single Canary response. Grok and GPT-5.6 Sol hit 99% too. Same model, same questions, one payload apart</span>
          </div>
          <div className="agents-stat">
            <span className="agents-stat-num">89 / 135</span>
            <span className="agents-stat-label">Grok 4.5 answers that were confidently wrong. The new failure mode is not "I don't know". It is a fluent wrong answer your user believes</span>
          </div>
        </div>
        <button className="agents-research-link" onClick={onOpenResearch}>
          Read the research →
        </button>

        <h2 className="agents-h2">Plug into the record</h2>
        <p className="agents-provenance">
          Four ways in, one contract: every number arrives with its definition, its
          source, and two dates. In the benchmark, one such response took frontier
          models from 25-47% overall to 95-99%; the field documentation is
          load-bearing, not a nicety.
        </p>

        <div className="agents-api">
          <div className="agents-api-nav" role="tablist" aria-label="API endpoints">
            <p className="agents-api-navlabel">WHAT DOES YOUR AGENT NEED?</p>
            {ENDPOINTS.map((e) => (
              <button
                key={e.key}
                role="tab"
                aria-selected={e.key === activeKey}
                className={e.key === activeKey ? 'agents-api-option active' : 'agents-api-option'}
                onClick={() => { setActiveKey(e.key); setCopied(false) }}
              >
                <span className="agents-api-need">{e.need}</span>
                <span className="agents-api-needsub">{e.needSub}</span>
              </button>
            ))}
          </div>

          <div className="agents-api-card" key={ep.key}>
            <div className="agents-api-head">
              <span className="agents-api-method">{ep.method}</span>
              <code className="agents-api-path">{ep.path}</code>
            </div>
            <p className="agents-api-tagline">{ep.tagline}</p>
            <p className="agents-api-desc">{ep.desc}</p>
            <div className="agents-api-meta">
              <div>
                <span className="agents-api-metalabel">RETURNS</span>
                <p>{ep.returns}</p>
              </div>
              <div>
                <span className="agents-api-metalabel">BEST FOR</span>
                <p>{ep.bestFor}</p>
              </div>
            </div>
            <div className="agents-api-code">
              <div className="agents-api-codebar">
                <span>{ep.file}</span>
                <button onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
              </div>
              <pre><code>{ep.code}</code></pre>
            </div>
            {ep.note && <p className="agents-api-note">{ep.note}</p>}
          </div>
        </div>

        <p className="agents-api-foot">
          Discovery is machine-readable too: <code>/api/catalog</code> lists every
          metric with its definition, and <code>/api/freshness</code> publishes each
          source's as-of and fetch dates, so an agent can check "how fresh?" before
          trusting an answer.
        </p>

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
          <span className="agents-cta-note">Tokens are issued to early-access partners; SF is live, more metros follow.</span>
        </div>

        <p className="agents-footnote">
          The consumer map stays free. The API sells freshness and guarantees, never the commons.
        </p>
      </div>
    </div>
  )
}
