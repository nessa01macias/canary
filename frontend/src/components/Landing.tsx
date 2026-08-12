import { useEffect, useRef, useState } from 'react'
import '../styles/landing.css'
import '../styles/docs.css'
import '../styles/docs-paper.css'
import { Docs } from './Docs'
import { DotWorldMap } from './DotWorldMap'

// The front door — the only public surface. Two-panel narrative (Ramp's
// "Systems that never spoke" → "Now sing together"): the scattered public
// record resolves into one cited API call. Sections 2+3 are ONE scroll-pinned
// stage (see ScatterStage below) — the same six cards fade from full color to
// ghosted as you scroll, with the status card and second headline
// crossfading in, instead of two disconnected static screens.
//
// Nothing on this page grants map access — the map is unreleased. "See how
// it works" opens the Docs popup (read-only). "Book a demo call" opens a
// Calendly booking popup — a direct call slot beats a contact form nobody
// replies to promptly.
const CALENDLY_URL = 'https://calendly.com/kattch/canary-chat?hide_gdpr_banner=1'

// The scattered "before" artifacts — one parcel (1200 Weston St), five
// authorities, six sources. Each carries its own real asset (dropped into
// public/scatter/ per the mockup brief) with a graceful text fallback until
// that file exists. Sizes are deliberately NOT uniform — see the brief:
// six identical tiles read as a product grid, not as chaos.
const SCATTER_ITEMS = [
  {
    n: 1, kind: 'PDF', w: 425, h: 325, short: 'Zoning Map',
    title: 'Zoning_Map_R3.pdf', sub: 'planning dept. archive',
    img: '/scatter/zoning-map.png',
  },
  {
    n: 2, kind: 'WEB', w: 394, h: 350, short: 'Council Agenda',
    title: 'City Council Agenda — Item 14', sub: 'posted to a subdomain, no index',
    img: '/scatter/council-agenda.png',
  },
  {
    n: 3, kind: 'MAIL', w: 463, h: 238, short: 'Email Thread',
    title: 'Re: setback variance question', sub: '3 replies, no resolution',
    img: '/scatter/email-thread.png',
  },
  {
    n: 4, kind: 'XLS', w: 494, h: 294, stacked: true, short: 'Permit Log',
    title: 'permit_history_FINAL_v3.xlsx', sub: 'emailed by the clerk’s office',
    img: '/scatter/permit-spreadsheet.png',
  },
  {
    n: 5, kind: 'CALL', w: 206, h: 366, short: 'Voicemail',
    title: '"call the clerk’s office back"', sub: 'voicemail, 2 days ago',
    img: '/scatter/voicemail-call.png',
  },
  {
    n: 6, kind: 'PDF', w: 349, h: 450, short: 'Submittal Checklist',
    title: 'Submittal_Checklist_v3.pdf', sub: 'different format per jurisdiction',
    img: '/scatter/submittal-checklist.png',
  },
] as const

// What the Canary card says once the same six sources resolve — the payoff
// of the stage's "after" state. Content matches the asset brief's fictional
// parcel exactly.
// Leads with RESULTS, not process — a pursuit lead scans for what changes
// the bid decision, not a source count. The chip row below (SCATTER_ITEMS)
// proves "6 sources" visually instead of stating it as a line of text.
const RESOLVED_STATUS = [
  'Resolving 1200 Weston St',
  'Zoning: R-3 → MU-2 pending, Item 14 deferred',
  'Latest stormwater manual: Rev. 2021 + 2 amendments',
]

const STACK_LOGOS = [
  { key: 'claude', name: 'Claude', file: '/logos/claude.svg' },
  { key: 'chatgpt', name: 'ChatGPT', file: '/logos/chatgpt.svg' },
  { key: 'gemini', name: 'Gemini', file: '/logos/gemini.svg' },
  { key: 'copilot', name: 'Microsoft Copilot', file: '/logos/copilot.svg' },
  { key: 'arcgis', name: 'ArcGIS', file: '/logos/arcgis.svg' },
  { key: 'procore', name: 'Procore', file: '/logos/procore.svg' },
]

function onImgError(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = 'none'
  e.currentTarget.nextElementSibling?.classList.remove('is-hidden')
}

function StackLogo({ name, file }: { name: string; file: string }) {
  return (
    <span className="landing-logo">
      <img src={file} alt={name} onError={onImgError} />
      <span className="landing-logo-fallback is-hidden">{name}</span>
    </span>
  )
}

// One scatter card: the real asset if it exists, else a text fallback card in
// the exact same footprint — the layout never shifts when images land.
// cardStyle/frameStyle carry the scroll-driven animation (opacity, grayscale,
// shadow) computed by ScatterStage; omit both for a static full-color card.
function ScatterCard({
  item, cardStyle, frameStyle,
}: {
  item: (typeof SCATTER_ITEMS)[number]
  cardStyle?: React.CSSProperties
  frameStyle?: React.CSSProperties
}) {
  return (
    <div
      className={`landing-scatter-card landing-scatter-card--${item.n}${'stacked' in item && item.stacked ? ' is-stacked' : ''}`}
      style={{ width: item.w, height: item.h, ...cardStyle }}
    >
      {/* Straddles the frame's top edge like a tab — sitting INSIDE the frame
          collided with each mockup's own header text (PDF over "SHEET 14 OF
          62", MAIL over the subject line, etc). */}
      <span className="landing-scatter-chip">{item.kind}</span>
      <div className="landing-scatter-frame" style={frameStyle}>
        <img src={item.img} alt={item.title} onError={onImgError} />
        <div className="landing-scatter-fallback is-hidden">
          <span className="landing-scatter-title">{item.title}</span>
          <span className="landing-scatter-sub">{item.sub}</span>
        </div>
      </div>
    </div>
  )
}

// ── Scroll-scrubbed transition (sections 2 → 3) ─────────────────────────────
// Ramp's actual effect: scrolling through the section transforms the SAME
// cards (fades to ghosts) while a second headline and the resolved-status
// card cross-fade in. Implemented as a pinned stage: the wrapper is taller
// than its content by EXTRA_SCROLL px; while position:sticky holds the stage
// at the top of the viewport, that extra scroll distance drives `progress`
// 0→1, which every animated style below derives from.
const EXTRA_SCROLL = 2600

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// Reveals RESOLVED_STATUS character-by-character, fast, once `active` flips
// true — then keeps typing to completion even if `active` later flips back
// (e.g. scrolling away mid-scrub shouldn't reset it, just let it finish
// silently in the background).
function useTypewriter(lines: readonly string[], active: boolean, msPerChar = 9) {
  const [count, setCount] = useState(0)
  const startedRef = useRef(false)
  useEffect(() => {
    if (!active || startedRef.current) return
    startedRef.current = true
    const total = lines.reduce((n, l) => n + l.length, 0)
    let i = 0
    const id = setInterval(() => {
      i += 1
      setCount(i)
      if (i >= total) clearInterval(id)
    }, msPerChar)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
  return count
}

function typedLines(lines: readonly string[], count: number) {
  let remaining = count
  return lines.map((line) => {
    const shown = Math.max(0, Math.min(line.length, remaining))
    remaining -= line.length
    return line.slice(0, shown)
  })
}

// Fires `inView` once the element first crosses 40% visible — the fallback
// (non-scrubbed) status card has no scroll-progress value to key the
// typewriter off, so it needs its own trigger.
function useInView<T extends HTMLElement>(threshold = 0.4) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); obs.disconnect() }
    }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { ref, inView }
}

function useScrollProgress(enabled: boolean) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const wrap = wrapRef.current
    const stage = stageRef.current
    if (!wrap || !stage) return

    wrap.style.height = `${stage.offsetHeight + EXTRA_SCROLL}px`

    let raf = 0
    const measure = () => {
      const rect = wrap.getBoundingClientRect()
      setProgress(Math.min(1, Math.max(0, -rect.top / EXTRA_SCROLL)))
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [enabled])

  return { wrapRef, stageRef, progress }
}

function ScatterStage() {
  // Skip the pin/scrub on narrow screens (the scatter itself degrades to a
  // static stacked list there — nothing to scrub) and for prefers-reduced-
  // motion. Both fall back to the plain two-screen version below. Read once
  // at mount: a live tab resizing across the breakpoint mid-session is an
  // acceptable edge case for a landing page.
  const [animEnabled] = useState(() =>
    typeof window !== 'undefined'
    && window.matchMedia('(min-width: 900px)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const { wrapRef, stageRef, progress } = useScrollProgress(animEnabled)

  // 0 = full-color scatter / headline A; 1 = ghosted + resolved status / headline B.
  // Staged so the pin holds briefly at rest on each end (readable, not a blur
  // mid-scroll) with the actual morph happening in the 0.15–0.85 middle.
  // Everything settles by ~0.7 now (was ~0.95) — the remaining 0.7–1.0 stretch
  // is a genuine hold with nothing animating, so there's real scroll distance
  // to read the fully-typed card before the pin releases, instead of it
  // finishing and the section moving on in the same breath.
  // Everything settles by ~0.55 now — the remaining 0.55–1.0 (45% of a much
  // bigger EXTRA_SCROLL) is a long, genuinely static hold before release.
  const cardT = smooth(0.12, 0.5, progress)
  const headOutT = smooth(0, 0.2, progress)
  const headInT = smooth(0.35, 0.5, progress)
  const statusT = smooth(0.3, 0.55, progress)

  // Fallback (non-scrubbed) status card triggers off scroll-into-view instead
  // of scroll progress. Hooks always run (rules of hooks) — animEnabled is
  // fixed for a mounted instance, so only one of these two ever actually fires.
  const { ref: fallbackStatusRef, inView: fallbackInView } = useInView<HTMLDivElement>()
  const typeActive = animEnabled ? statusT > 0.5 : fallbackInView
  const typedCount = useTypewriter(RESOLVED_STATUS, typeActive)
  const totalChars = RESOLVED_STATUS.reduce((n, l) => n + l.length, 0)
  const lines = typedLines(RESOLVED_STATUS, typedCount)
  const typingLineIdx = typedCount < totalChars
    ? lines.reduce((acc, l, i) => (l ? i : acc), -1)
    : -1

  const typingDone = typedCount >= totalChars

  const statusRows = (
    <>
      {lines.map((line, i) => (
        <div key={RESOLVED_STATUS[i]} className="landing-fanin-status-row">
          {line}
          {i === typingLineIdx && <span className="landing-fanin-cursor" aria-hidden="true" />}
        </div>
      ))}
      {/* The receipt: six real source images, one click away — proves "found
          6 sources" instead of just claiming it. Appears once the typing
          settles so it reads as the payoff, not clutter typing over it. */}
      {typingDone && (
        <div className="landing-fanin-sources">
          {SCATTER_ITEMS.map((item) => (
            <a
              key={item.n}
              className="landing-fanin-source-chip"
              href={item.img}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="landing-fanin-source-kind">{item.kind}</span>
              <span className="landing-fanin-source-label">{item.short}</span>
            </a>
          ))}
        </div>
      )}
    </>
  )

  if (!animEnabled) {
    return (
      <>
        <section className="landing-section landing-section--wide">
          <h2>The manual research bottlenecking your pursuit.</h2>
          <p className="landing-section-sub">
            A single pursuit can span hundreds of municipal inquiries, from PDFs to phone calls.
          </p>
          <div className="landing-scatter">
            {SCATTER_ITEMS.map((item) => <ScatterCard key={item.n} item={item} />)}
          </div>
        </section>
        <section className="landing-section landing-section--after landing-section--wide">
          <h2>Unblocked. One API call.</h2>
          <div className="landing-fanin-ghost">
            <div className="landing-scatter landing-scatter--ghost" aria-hidden="true">
              {SCATTER_ITEMS.map((item) => <ScatterCard key={item.n} item={item} />)}
            </div>
            <div className="landing-fanin-status" ref={fallbackStatusRef}>
              {statusRows}
            </div>
          </div>
        </section>
      </>
    )
  }

  const cardStyle: React.CSSProperties = { opacity: lerp(1, 0.1, cardT) }
  const frameStyle: React.CSSProperties = {
    filter: `grayscale(${cardT})`,
    boxShadow: `0 8px 24px rgba(20, 17, 15, ${0.08 * (1 - cardT)})`,
  }

  return (
    <div className="landing-scatter-pinwrap" ref={wrapRef}>
      <div className="landing-scatter-stage" ref={stageRef}>
        <div className="landing-scatter-heading">
          <div className="landing-scatter-heading-face" style={{ opacity: 1 - headOutT }}>
            <h2>The manual research bottlenecking your pursuit.</h2>
            <p className="landing-section-sub">
              A single pursuit can span hundreds of municipal inquiries, from PDFs to phone calls.
            </p>
          </div>
          <div className="landing-scatter-heading-face is-b" style={{ opacity: headInT }}>
            <h2>Unblocked. One API call.</h2>
          </div>
        </div>

        <div className="landing-scatter">
          {SCATTER_ITEMS.map((item) => (
            <ScatterCard key={item.n} item={item} cardStyle={cardStyle} frameStyle={frameStyle} />
          ))}
          <div
            className="landing-fanin-status is-scrubbed"
            style={{
              opacity: statusT,
              transform: `translate(-50%, calc(-50% + ${lerp(14, 0, statusT)}px))`,
            }}
          >
            {statusRows}
          </div>
        </div>
      </div>
    </div>
  )
}

const CitedIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 8h10M7 12h10M7 16h6" />
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
  </svg>
)
const RecordIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
    <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
  </svg>
)
const TargetIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="0.8" fill="currentColor" />
  </svg>
)

const VALUE_BLOCKS = [
  {
    icon: CitedIcon,
    title: 'Cited, always.',
    body: 'Every answer traces to the exact code section, version date, and source. Nothing to second-guess.',
  },
  {
    icon: RecordIcon,
    title: 'Public record, structured.',
    body: 'We aggregate what’s scattered across municipal sites and PDFs into one clean, queryable format.',
  },
  {
    icon: TargetIcon,
    title: 'Built for pursuits.',
    body: 'Scoped to the research pursuit teams actually do before a bid — not generic search.',
  },
]

export function Landing() {
  const [contactOpen, setContactOpen] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)

  // Unlike the app shell (a fixed-size view that never scrolls), this is a
  // long scrolling page — with nothing locking body scroll, wheel/trackpad
  // input over a popup that hits its own scroll limit chains straight up to
  // the page behind it, which is visible (and visibly moving) through the
  // scrim. Lock it for as long as any popup is open.
  const anyModalOpen = contactOpen || docsOpen
  useEffect(() => {
    if (!anyModalOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [anyModalOpen])

  return (
    <div className="landing">
      <nav className="landing-nav">
        <span className="landing-brand">canary</span>
        <div className="landing-nav-right">
          <button className="landing-btn landing-btn-primary landing-btn-sm" onClick={() => setContactOpen(true)}>
            Book a demo call
          </button>
        </div>
      </nav>

      <div className="landing-fold">
        <DotWorldMap className="landing-hero-map" />
        <div className="landing-fold-body">
          <header className="landing-hero">
            <h1>Months of research.<br />One API call.</h1>
            <p className="landing-sub">
              Planning acts, zoning, permits, approvals, submittal requirements
              &mdash; aggregated, cited, and ready for your AI.
            </p>
            <div className="landing-hero-actions">
              <button className="landing-btn landing-btn-primary" onClick={() => setContactOpen(true)}>Book a demo call</button>
              <button className="landing-btn landing-btn-ghost" onClick={() => setDocsOpen(true)}>See how it works</button>
              </div>
            </header>

          <section className="landing-section landing-testimonial-section">
            <div className="landing-testimonial-card">
              <p className="landing-testimonial-quote">
                &ldquo;AEC pursuit teams lose months just trying to piece together hidden and fragmented
                information. With a tool like Canary, months of research will be condensed into just
                days.&rdquo;
              </p>
              <div className="landing-testimonial-attribution">
                <img className="landing-testimonial-logo" src="/logos/aecom.svg" alt="AECOM" />
                <span className="landing-testimonial-title">Sr. Strategist, AECOM Canada</span>
                <span className="landing-testimonial-badge">Design Partner</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <ScatterStage />

      <section className="landing-section landing-stack-section">
        <h2>Upgrade your existing tools with Canary&rsquo;s intelligence.</h2>
        <div className="landing-proof-stat">
          <div className="landing-proof-card landing-proof-card--before">
            <span className="landing-proof-card-label">Unassisted</span>
            <span className="landing-proof-before">25&ndash;47%</span>
            <span className="landing-proof-metric">LLM accuracy</span>
          </div>
          <span className="landing-proof-arrow">&rarr;</span>
          <div className="landing-proof-card landing-proof-card--after">
            <span className="landing-proof-card-label">With Canary</span>
            <span className="landing-proof-after">95&ndash;99%</span>
            <span className="landing-proof-metric landing-proof-metric--after">LLM accuracy</span>
          </div>
        </div>
        <div className="landing-logo-row">
          {STACK_LOGOS.map((l) => <StackLogo key={l.key} name={l.name} file={l.file} />)}
          <span className="landing-logo-more">and more</span>
        </div>
        <p className="landing-section-sub landing-tools-sub">
          No need to learn a new tool.
          <br />
          Canary is an intelligence layer that fits into your existing toolset with zero friction.
        </p>
      </section>

      <section className="landing-section landing-values">
        {VALUE_BLOCKS.map((v) => (
          <div key={v.title} className="landing-value">
            <v.icon />
            <h3>{v.title}</h3>
            <p>{v.body}</p>
          </div>
        ))}
      </section>

      <section className="landing-closing">
        <h2>Stop researching. Start bidding.</h2>
        <button className="landing-btn landing-btn-primary" onClick={() => setContactOpen(true)}>Book a demo call</button>
      </section>

      <footer className="landing-footer">
        <span>canary</span>
        <div className="landing-footer-links">
          <button onClick={() => setContactOpen(true)}>Book a demo call</button>
        </div>
      </footer>

      {contactOpen && <ContactModal onClose={() => setContactOpen(false)} />}
      {docsOpen && <Docs onClose={() => setDocsOpen(false)} />}
    </div>
  )
}

// The Calendly booking popup behind "Book a demo call" — a direct call slot
// beats a contact form nobody replies to promptly. widget.js self-mounts into
// any .calendly-inline-widget it finds (including ones added after it loads),
// so we just make sure the script tag exists once and render the div.
const CALENDLY_SCRIPT_SRC = 'https://assets.calendly.com/assets/external/widget.js'

function loadCalendlyScript() {
  if (document.querySelector(`script[src="${CALENDLY_SCRIPT_SRC}"]`)) return
  const script = document.createElement('script')
  script.src = CALENDLY_SCRIPT_SRC
  script.async = true
  document.body.appendChild(script)
}

function ContactModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    loadCalendlyScript()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="contact-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Book a call"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="contact-card contact-card--calendly">
        <button className="contact-close" onClick={onClose} aria-label="Close">&times;</button>
        <h2>Book a demo with our team</h2>
        <div className="calendly-inline-widget" data-url={CALENDLY_URL} style={{ minWidth: 320 }} />
      </div>
    </div>
  )
}

