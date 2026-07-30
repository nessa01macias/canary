import { useState } from 'react'

// The B2B door: Canary as the data + context layer for AI apps and agents.
// The consumer map is the demo; this page is the pitch. Endpoints are real
// (backend/app/api/routes.py) but access is gated: the CTA collects interest.
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
  file: string          // filename on the code block's title bar
  params: string        // one-line param summary for the agent markdown
  code: string
}

// Paths, params, and numbers are real: routes from app/api/routes.py, the
// Japantown row from the trajectory table (RESEARCH.md receipt).
const ENDPOINTS: Endpoint[] = [
  {
    key: 'report',
    need: 'Everything near an address',
    needSub: '/api/report',
    method: 'GET',
    path: '/api/report',
    tagline: 'One call: what is this place becoming?',
    desc:
      'The area’s per-dimension trajectory plus everything approved for ' +
      'construction in the ring: units, costs, permit numbers. This exact object ' +
      'is what took the benchmark models to 95-99%.',
    returns: 'Trajectory + approved construction, cited and dated',
    bestFor: 'Property-level questions: should I move here, what is being built next door',
    file: 'request.sh',
    params: 'lat, lon, ring_k (default 2), window_months (default 24)',
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
      'Trailing twelve months against the twelve before, percent change, and a ' +
      'citywide z-score, with the metric’s definition riding along. Victim-reported ' +
      'crime and police enforcement are separate metrics by design.',
    returns: 'last12 / prior12 / % change / z, with definition and as-of date',
    bestFor: 'Rankings and comparisons: which area is rising, is crime actually falling',
    file: 'request.sh',
    params: 'area_id, area_level (neighborhood | h3_9), metric, window_months',
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
      'Plain language in, structured blocks out. Every number is hydrated ' +
      'server-side from the record and traceable to its source.',
    returns: 'Structured answer blocks with citations',
    bestFor: 'Apps and agents that reason in language',
    file: 'request.sh',
    params: 'question (2-500 chars), mission?, history?, context?',
    code:
      'curl -X POST https://canarylayer.com/api/ask \\\n' +
      '  -H "Content-Type: application/json" \\\n' +
      '  -H "Authorization: Bearer $CANARY_TOKEN" \\\n' +
      '  -d \'{\n' +
      '    "question": "Which SF neighborhood is rising fastest for new businesses?",\n' +
      '    "mission": "opening_business"\n' +
      '  }\'',
  },
]

// What the corner icon copies: the endpoint contract as agent-ready markdown,
// pasteable straight into a system prompt, tool description, or llms.txt.
function agentMarkdown(ep: Endpoint): string {
  return [
    `## Canary API — ${ep.method} ${ep.path}`,
    ep.tagline + '.',
    '',
    `- What it does: ${ep.desc}`,
    `- Params: ${ep.params}`,
    `- Returns: ${ep.returns}. Every value carries its definition, source, and two dates (source_as_of + fetched_at).`,
    `- Best for: ${ep.bestFor}`,
    '',
    '```',
    ep.code,
    '```',
    '',
    'Discovery: GET /api/catalog lists every metric with its definition; GET /api/freshness publishes each source’s dates.',
  ].join('\n')
}

export function ForAgents({ onClose, onOpenResearch }: Props) {
  const [activeKey, setActiveKey] = useState(ENDPOINTS[0].key)
  const [copied, setCopied] = useState(false)
  const ep = ENDPOINTS.find((e) => e.key === activeKey) ?? ENDPOINTS[0]

  const copy = () => {
    navigator.clipboard.writeText(agentMarkdown(ep)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
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
          We benchmarked the five newest frontier models on 136 verified questions
          about SF neighborhoods. Alone: 25-47%, confidently wrong. Reading one
          Canary response: 95-99%. The answers were never published anywhere, so no
          model release fixes this. Someone has to compute them. We do, monthly,
          with a citation on every number.
        </p>

        <div className="agents-stats">
          <div className="agents-stat">
            <span className="agents-stat-num">66 / 75</span>
            <span className="agents-stat-label">"which neighborhood changed most?" answered wrong. On rising-fastest, four different confident answers. All wrong</span>
          </div>
          <div className="agents-stat">
            <span className="agents-stat-num">40% → 99%</span>
            <span className="agents-stat-label">Claude Fable 5, before and after one Canary response. Grok and Sol hit 99% too</span>
          </div>
          <div className="agents-stat">
            <span className="agents-stat-num">89 / 135</span>
            <span className="agents-stat-label">Grok 4.5 answers that were confidently wrong. Fluent misinformation, not "I don't know"</span>
          </div>
        </div>
        <button className="agents-research-link" onClick={onOpenResearch}>
          Read the research →
        </button>

        <h2 className="agents-h2">Plug into the record</h2>

        <div className="agents-api">
          <div className="agents-api-nav" role="tablist" aria-label="API endpoints">
            <p className="agents-api-navlabel">WHAT DO YOU NEED?</p>
            {ENDPOINTS.map((e) => (
              <button
                key={e.key}
                role="tab"
                aria-selected={e.key === activeKey}
                className={e.key === activeKey ? 'agents-api-option active' : 'agents-api-option'}
                onClick={() => { setActiveKey(e.key); setCopied(false) }}
              >
                <span className="agents-api-need">{e.need}</span>
              </button>
            ))}
          </div>

          <div className="agents-api-card" key={ep.key}>
            <button
              className={copied ? 'agents-api-copy copied' : 'agents-api-copy'}
              onClick={copy}
              title="Copy this endpoint as agent-ready markdown"
              aria-label="Copy endpoint contract as markdown for your agent"
            >
              {copied ? '✓ copied for your agent' : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
            <div className="agents-api-head">
              <span className="agents-api-method">{ep.method}</span>
              <code className="agents-api-path">{ep.path}</code>
            </div>
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
              <div className="agents-api-codebar"><span>{ep.file}</span></div>
              <pre><code>{ep.code}</code></pre>
            </div>
          </div>
        </div>

        <div className="agents-cta">
          <a className="agents-cta-btn" href={`mailto:${EARLY_ACCESS_EMAIL}?subject=Canary%20API%20early%20access`}>
            Request early access
          </a>
        </div>
      </div>
    </div>
  )
}
