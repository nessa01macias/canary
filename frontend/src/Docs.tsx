import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
// The canonical documents live at the repo root (single source of truth — the same
// files the pipeline and benchmark produce). Vite inlines them at build; no copies
// to drift. CONTEXT.md (strategy) and DEPLOY.md (ops) are deliberately NOT shipped.
import aboutMd from '../../ABOUT.md?raw'
import researchMd from '../../RESEARCH.md?raw'
// SOURCES.md is the PUBLIC sources page. DATA_SOURCES.md is the internal working
// registry (ops notes, gaps, backlog) and must never ship to the site.
import sourcesMd from '../../SOURCES.md?raw'

// Each tab has ONE job — no two tabs repeat each other:
//   about      plain-language, for everyone (summarizes, links down)
//   research   the full AI study: method, results table, conclusions
//   sources    reference: where every number comes from
// (BENCHMARK.md is a repo-side results snapshot, superseded by research — not shipped.)
const DOCS: { key: string; label: string; body: string; paper?: boolean }[] = [
  { key: 'about', label: 'What is Canary?', body: aboutMd },
  // paper: true renders the research note with arXiv-style typography (serif,
  // centered title block, epigraph, booktabs tables, margin identifier).
  { key: 'research', label: 'Research', body: researchMd, paper: true },
  { key: 'sources', label: 'Data sources', body: sourcesMd },
]

type Props = { onClose: () => void; initialTab?: string }

export function Docs({ onClose, initialTab }: Props) {
  const [active, setActive] = useState(initialTab ?? DOCS[0].key)
  const doc = DOCS.find((d) => d.key === active) ?? DOCS[0]

  return (
    <div className="research-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="research-card">
        <button className="drawer-close" onClick={onClose}>×</button>

        <nav className="docs-tabs" role="tablist" aria-label="Documentation">
          {DOCS.map((d) => (
            <button
              key={d.key}
              role="tab"
              aria-selected={active === d.key}
              className={active === d.key ? 'active' : ''}
              onClick={() => setActive(d.key)}
            >
              {d.label}
            </button>
          ))}
        </nav>

        <div className={doc.paper ? 'research-body paper' : 'research-body'} key={doc.key}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Repo-relative links (BENCHMARK.md, backend/…) have nowhere to go on
              // the site — render them as plain text; keep real http(s) links live.
              a: ({ href, children }) =>
                href && /^https?:/.test(href) ? (
                  <a href={href} target="_blank" rel="noreferrer">{children}</a>
                ) : (
                  <span>{children}</span>
                ),
            }}
          >
            {doc.body}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
