import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
// The canonical document lives at the repo root (single source of truth — the same
// file the benchmark produced). Vite inlines it at build; no copy to drift.
import researchMd from '../../RESEARCH.md?raw'

type Props = { onClose: () => void }

export function Research({ onClose }: Props) {
  return (
    <div className="research-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="research-card">
        <button className="drawer-close" onClick={onClose}>×</button>
        <div className="research-body">
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
            {researchMd}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
