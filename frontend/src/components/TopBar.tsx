import { useState } from 'react'

// The header, both form factors: the desktop top bar and the mobile floating
// bar (Google-Maps style; CSS shows exactly one of them). The mobile "⋯" menu
// is internal state — no one outside needs to know it's open.

type Props = {
  onOpenDocs: () => void
  onOpenAgents: () => void
  /** The review door. Quiet on purpose: ONE primary CTA on the resting screen
      ("Choose what matters"). The review ask converts inside the cards, where
      the gate gives it context — not as a competing orange button. */
  onContribute: () => void
}

export function TopBar({ onOpenDocs, onOpenAgents, onContribute }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const viaMenu = (fn: () => void) => () => { setMenuOpen(false); fn() }

  return (
    <>
      {/* Desktop top bar */}
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand">canary</span>
          <span className="brand-sep" />
          <span className="brand-sub">Real-world place intelligence for upwards mobility</span>
        </div>

        <div className="topbar-right">
          <button className="nav-quiet" onClick={onOpenDocs}>
            Docs
          </button>
          <button className="nav-quiet" onClick={onOpenAgents}>
            For AI apps
          </button>
          <button className="nav-quiet" onClick={onContribute}>
            Review a neighborhood
          </button>
        </div>
      </header>

      {/* Mobile header — floating over the map. Shown only on phones (CSS hides
          the desktop .topbar there and vice-versa). The secondary actions
          collapse behind the "⋯" menu so the map stays clear. */}
      <div className="mtopbar">
        <div className="mtopbar-row">
          <span className="mtopbar-brand">canary</span>
          <div className="mtopbar-actions">
            <button
              type="button"
              className={`mmenu-btn${menuOpen ? ' is-open' : ''}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              <span className="mmenu-dots">⋯</span>
            </button>
          </div>
        </div>

        {menuOpen && (
          <>
            <div className="mmenu-scrim" onClick={() => setMenuOpen(false)} />
            <div className="mmenu" role="menu">
              <button role="menuitem" className="mmenu-item" onClick={viaMenu(onOpenDocs)}>
                Documentation
              </button>
              <button role="menuitem" className="mmenu-item" onClick={viaMenu(onOpenAgents)}>
                For AI apps
              </button>
              <button role="menuitem" className="mmenu-item is-primary" onClick={viaMenu(onContribute)}>
                + Review a neighborhood
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
