import { useEffect, useRef, useState } from 'react'
import '../styles/landing.css'
import '../styles/docs.css'
import '../styles/docs-paper.css'
import { Docs } from './Docs'
import { DotGlobe } from './DotGlobe'
import { LandingDataPrompt } from './LandingDataPrompt'

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
// Card footprints and .landing-scatter-card--N's top/left offsets (landing.css)
// are both ×1.4 of the original design — along with .landing-scatter's own
// reference height/max-width and the fit-to-viewport formula's divisor below,
// all four move together so the whole cluster is uniformly 40% bigger and the
// existing responsive shrink-to-fit behavior (ScatterStage) still holds at
// the new size, on any screen.
const SCATTER_ITEMS = [
  {
    n: 1, kind: 'PDF', w: 595, h: 455, short: 'Zoning Map',
    title: 'Zoning_Map_R3.pdf', sub: 'planning dept. archive',
    img: '/scatter/zoning-map.png',
  },
  {
    n: 2, kind: 'WEB', w: 552, h: 490, short: 'Council Agenda',
    title: 'City Council Agenda — Item 14', sub: 'posted to a subdomain, no index',
    img: '/scatter/council-agenda.png',
  },
  {
    n: 3, kind: 'MAIL', w: 648, h: 333, short: 'Email Thread',
    title: 'Re: setback variance question', sub: '3 replies, no resolution',
    img: '/scatter/email-thread.png',
  },
  {
    n: 4, kind: 'XLS', w: 692, h: 412, stacked: true, short: 'Permit Log',
    title: 'permit_history_FINAL_v3.xlsx', sub: 'emailed by the clerk’s office',
    img: '/scatter/permit-spreadsheet.png',
  },
  {
    n: 5, kind: 'CALL', w: 288, h: 512, short: 'Voicemail',
    title: '"call the clerk’s office back"', sub: 'voicemail, 2 days ago',
    img: '/scatter/voicemail-call.png',
  },
  {
    n: 6, kind: 'PDF', w: 489, h: 630, short: 'Submittal Checklist',
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
// Lines starting with "—" render as an indented, muted sub-line nested
// under the fact right above them (see statusRows) instead of a full-weight
// row of their own.
const RESOLVED_STATUS = [
  'Resolving 1200 Weston St',
  'Zoning: R-3 → MU-2 rezoning pending',
  '— Council Item 14 deferred, next hearing TBD',
  'Nearby: 2 active approvals within 500m',
  '— transit corridor + mixed-use residential',
  'Submittal: 14 items — environmental assessment required',
]

const STACK_LOGOS = [
  { key: 'claude', name: 'Claude', file: '/logos/claude.svg' },
  { key: 'chatgpt', name: 'ChatGPT', file: '/logos/chatgpt.svg' },
  { key: 'gemini', name: 'Gemini', file: '/logos/gemini.svg' },
  { key: 'copilot', name: 'Microsoft Copilot', file: '/logos/copilot.svg' },
  { key: 'arcgis', name: 'ArcGIS', file: '/logos/arcgis.svg' },
  { key: 'procore', name: 'Procore', file: '/logos/procore.svg' },
]

// Photo + bold caption per sector, no supporting copy — the API is one
// thing, these are just the desks that end up asking it the same question.
const SECTORS = [
  { name: 'Data Center Siting', img: '/sectors/data-center.jpg' },
  { name: 'Renewable Energy Siting', img: '/sectors/renewable-energy.jpg' },
  { name: 'Developers & Homebuilders', img: '/sectors/homebuilders.jpg' },
  { name: 'Retail & Franchise Site Selection', img: '/sectors/retail-siting.jpg' },
  { name: 'Utilities, Telecom, EV-Charging & Fiber', img: '/sectors/utilities-ev.jpg' },
  { name: 'Investors, REITs & Quants', img: '/sectors/investors-reits.jpg' },
  { name: 'Insurers', img: '/sectors/insurers.jpg' },
  { name: 'Lenders & AVM Vendors', img: '/sectors/lenders-avm.jpg' },
  { name: 'Asset Managers & Portfolio Owners', img: '/sectors/asset-managers.jpg' },
  { name: 'AI Assistants & Real-Estate AI', img: '/sectors/ai-real-estate.jpg' },
  { name: 'Portals & MLSs', img: '/sectors/portals-mls.jpg' },
  { name: 'Relocation Firms & Corporate Mobility', img: '/sectors/relocation.jpg' },
  { name: 'Consultancies & Engineering Firms', img: '/sectors/consultancies-engineering.jpg' },
] as const

// Two rows (2 cards tall), split by even/odd index — a true running-bond
// brick pattern: every card WITHIN a row lines up with the others in that
// row, and the second row is offset half a card-width horizontally from
// the first (in CSS), so row-to-row joints stagger instead of columns
// stacking vertically.
const SECTOR_ROW_1 = SECTORS.filter((_, i) => i % 2 === 0)
const SECTOR_ROW_2 = SECTORS.filter((_, i) => i % 2 === 1)

function onImgError(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = 'none'
  // ScatterCard's fallback text starts hidden and depends on this to ever
  // show. StackLogo's sibling (the name label) doesn't carry 'is-hidden' at
  // all, so this is a harmless no-op there — safe to run unconditionally
  // for every onImgError caller instead of splitting the two behaviors.
  e.currentTarget.nextElementSibling?.classList.remove('is-hidden')
}

function SectorCard({ sector }: { sector: (typeof SECTORS)[number] }) {
  return (
    <div className="landing-sector-card">
      <div className="landing-sector-photo">
        <img src={sector.img} alt="" className="landing-sector-img" loading="lazy" />
        <div className="landing-sector-scrim" />
        <span className="landing-sector-name">{sector.name}</span>
      </div>
    </div>
  )
}

// Icon + name, always both — not an error-only fallback. Two of the six
// (Copilot, Procore) don't have a redistributable official mark yet, so
// their file is a plain glyph; the name label is what actually identifies
// them, not a broken-image rescue.
function StackLogo({ name, file }: { name: string; file: string }) {
  return (
    <span className="landing-logo">
      <img src={file} alt="" onError={onImgError} />
      <span className="landing-logo-name">{name}</span>
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
      <div className="landing-scatter-frame" style={frameStyle}>
        <img src={item.img} alt={item.title} onError={onImgError} loading="lazy" />
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
// Was 2000, then 1200 — still read as a long dead scroll before the next
// section. The reveal settles by progress 0.5, so the 0.5-1.0 half is pure
// hold; cut further so that hold (plus the overshoot exit-slide once the
// pin releases) stops feeling like a gap.
const EXTRA_SCROLL = 700

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

// Constant vertical gap from the graphic's own top edge to where the
// resolved-status card should sit (over the top couple of cards) — tuned
// once against the un-centered layout (340px from the stage's top, minus
// the ~268px the graphic itself started at) and kept as an offset FROM THE
// GRAPHIC rather than from the stage, so it keeps tracking the cards
// correctly now that .landing-scatter-stage centers its content vertically
// (see that rule) instead of always starting right after the top padding.
const STATUS_CARD_OFFSET = 72

function useScrollProgress(
  enabled: boolean,
  statusRef: React.RefObject<HTMLDivElement | null>,
  graphicRef: React.RefObject<HTMLDivElement | null>,
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  // `progress` clamps to 1 and STAYS there for the rest of the page — it
  // can't tell "the pin just released" from "scrolled a mile past it".
  //
  // `overshoot` is how many px past that release point we've scrolled (0
  // while still pinned, growing 1:1 once you scroll further) — used only to
  // kill pointer-events on the card once we're past the release point (see
  // the JSX below). It does NOT drive any transform: the card is
  // position:absolute inside the stage, so once the pin releases and the
  // stage resumes normal scrolling, the card — and the heading, and the
  // ghost card fan — already move off-screen at native 1:1 scroll speed for
  // free, same as everything else on the page. An earlier version of this
  // manually slid the card (then the heading, then the fan too) away an
  // EXTRA -overshootPx on top of that native scroll, under the mistaken
  // assumption the card needed help leaving (true back when it really was
  // position:fixed, per the stale reasoning that used to be here — but
  // fixed was replaced with absolute to fix a different bug, and nobody
  // removed the now-unnecessary slide). Since transform is paint-only and
  // never changes how far you actually have to scroll to reach the next
  // section, that extra slide just made the composition vanish well before
  // the scroll distance to .landing-stack-section had actually been
  // covered — a large blank gap, exactly the "still there" report after
  // the first couple of fix attempts here. Removing the manual slide
  // entirely (natural scroll only) fixes it at the root, and also means
  // the card and heading can never drift apart again — they were never on
  // two different clocks to begin with.
  const [overshoot, setOvershoot] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const wrap = wrapRef.current
    const stage = stageRef.current
    if (!wrap || !stage) return

    // A sticky element with `top: S` inside a container of height `C` can
    // only hold that stuck position for `C - stageHeight - S` px of scroll
    // before it releases early to avoid overflowing its container — so
    // without the `+ stickyOffset` term here, the stage actually un-stuck
    // ~80px (--nav-h) short of the EXTRA_SCROLL distance `measure()` below
    // assumes it's pinned for. For that last ~80px, `progress`/`overshoot`
    // still reported "fully pinned", while the stage (and everything
    // absolutely positioned inside it, header included) had already started
    // sliding for real — a sudden ~80px jump right as the card was supposed
    // to be holding steady, reading as the whole composition lurching
    // toward the viewport center instead of landing where it should.
    const stickyOffset = parseFloat(getComputedStyle(stage).top) || 0
    wrap.style.height = `${stage.offsetHeight + EXTRA_SCROLL + stickyOffset}px`

    let raf = 0
    const measure = () => {
      const rect = wrap.getBoundingClientRect()
      const p = Math.min(1, Math.max(0, -rect.top / EXTRA_SCROLL))
      const overshootPx = Math.max(0, -rect.top - EXTRA_SCROLL)
      setProgress(p)
      setOvershoot(overshootPx)
      if (statusRef.current) {
        // Small settle nudge only, no exit-slide — see the comment on
        // `overshoot` above for why the card doesn't need help leaving.
        const settleY = lerp(14, 0, smooth(0.3, 0.5, p))
        statusRef.current.style.transform = `translate(-50%, ${settleY}px)`
      }
      if (statusRef.current && graphicRef.current) {
        // offsetTop is relative to the nearest positioned ancestor, which is
        // the (position:sticky) stage — same frame STATUS_CARD_OFFSET was
        // tuned against, so this tracks the graphic's actual position
        // instead of assuming it always starts right after the top padding.
        const statusTop = graphicRef.current.offsetTop + STATUS_CARD_OFFSET
        statusRef.current.style.top = `${statusTop}px`
      }
      updateStatusFloor()
    }
    // The stage's own min-height (landing.css) fades toward 0 as the graphic
    // ghost-shrinks, so the stage naturally shrinks with it instead of
    // leaving a big dead gap before the next section. But the status card
    // doesn't shrink — it's absolute-positioned, real-size text — so once
    // the stage got small enough its own `overflow: hidden` started clipping
    // the card's lower rows. This floor (read by that min-height's max(),
    // see the CSS) keeps the stage at least tall enough to contain the full
    // card. Split out from `measure` (and re-run via ResizeObserver below,
    // not just on scroll) because the card's own height changes on its own
    // clock — the scroll-driven typewriter adds a line at a time, and the
    // source-chips block appears only once typing finishes — none of which
    // fire a scroll/resize event, so a scroll-only measurement would read
    // the card's PREVIOUS (shorter) height until the next time the user
    // happened to scroll again.
    const updateStatusFloor = () => {
      if (!statusRef.current || !graphicRef.current) return
      const statusTop = graphicRef.current.offsetTop + STATUS_CARD_OFFSET
      // Doubled (×2, not just the bare padding-bottom): a gap that exactly
      // matched the stage's own side padding read as flush/abrupt right
      // where the card's shadow was still fading out — this gives the
      // transition into the next section some real breathing room.
      const paddingBottom = (parseFloat(getComputedStyle(stage).paddingBottom) || 0) * 2
      const statusFloor = statusTop + statusRef.current.offsetHeight + paddingBottom
      stage.style.setProperty('--status-floor', `${statusFloor}px`)
    }
    const statusResizeObserver = new ResizeObserver(updateStatusFloor)
    if (statusRef.current) statusResizeObserver.observe(statusRef.current)
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
      statusResizeObserver.disconnect()
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  return { wrapRef, stageRef, progress, overshoot }
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
  const statusRef = useRef<HTMLDivElement>(null)
  const graphicRef = useRef<HTMLDivElement>(null)
  const { wrapRef, stageRef, progress, overshoot } = useScrollProgress(animEnabled, statusRef, graphicRef)

  // 0 = full-color scatter / headline A; 1 = ghosted + resolved status / headline B.
  // Cards ghost + headline swaps by 0.5. Status card fades in 0.3→0.5 and
  // holds at 1 for good — no fade-out, no slide-out, no exit animation of
  // any kind. Both were tried and reverted: fading/sliding it out early
  // (tied to `overshoot`) made it disappear before the scroll distance to
  // .landing-stack-section had actually been covered (a blank gap), and a
  // faded-but-still-bordered card read as a harsh ghost outline rather than
  // a graceful dissolve. It's position:absolute inside the stage, so once
  // the pin releases it just scrolls away at native 1:1 speed like
  // everything else on the page — no help needed, and no visual seam.
  const cardT = smooth(0.12, 0.5, progress)
  const headOutT = smooth(0, 0.2, progress)
  const headInT = smooth(0.35, 0.5, progress)
  const statusT = smooth(0.3, 0.5, progress)

  // Fallback (non-scrubbed) status card triggers off scroll-into-view instead
  // of scroll progress — there's no `progress` to key off there, so it's
  // stuck being time-based (setInterval). That's fine for the fallback (a
  // normal static section, nothing else scroll-linked to race against).
  const { ref: fallbackStatusRef, inView: fallbackInView } = useInView<HTMLDivElement>()
  const fallbackTypedCount = useTypewriter(RESOLVED_STATUS, fallbackInView)
  const totalChars = RESOLVED_STATUS.reduce((n, l) => n + l.length, 0)
  // Pinned version: typing is scroll-driven too (not setInterval), same
  // reason as the tent-shaped fade above — a time-based typer can lose the
  // race against a fast scroll and get cut off mid-word right as the card
  // fades (this happened: see the "ends here" mid-word screenshot). Finishes
  // by progress 0.6, before the fade-out starts at 0.68 — a short but real
  // ~0.08 of EXTRA_SCROLL (~160px) sitting fully typed before it fades.
  const pinnedTypedCount = Math.round(totalChars * smooth(0.4, 0.6, progress))
  const typedCount = animEnabled ? pinnedTypedCount : fallbackTypedCount
  const lines = typedLines(RESOLVED_STATUS, typedCount)
  const typingLineIdx = typedCount < totalChars
    ? lines.reduce((acc, l, i) => (l ? i : acc), -1)
    : -1

  const typingDone = typedCount >= totalChars

  const statusRows = (
    <>
      {lines.map((line, i) => (
        <div
          key={RESOLVED_STATUS[i]}
          className={`landing-fanin-status-row${RESOLVED_STATUS[i].startsWith('—') ? ' is-sub' : ''}`}
        >
          {line}
          {i === typingLineIdx && <span className="landing-fanin-cursor" aria-hidden="true" />}
        </div>
      ))}
      {/* The receipt: six real source images, one click away — proves "found
          6 sources" instead of just claiming it. Appears once the typing
          settles so it reads as the payoff, not clutter typing over it. */}
      {typingDone && (
        <div className="landing-fanin-sources-block">
          <div className="landing-fanin-sources-caption">View source documents</div>
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
          <div className="landing-scatter-wrap">
            <div className="landing-scatter">
              {SCATTER_ITEMS.map((item) => <ScatterCard key={item.n} item={item} />)}
            </div>
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
  // Extra shrink (beyond the plain fit-to-viewport --collage-scale) phases
  // in with the same cardT driving the color→ghost fade, so "The manual
  // research…" keeps its original size and only "Unblocked" ends up smaller
  // — one continuous element here, unlike the fallback's two separate
  // sections, so this has to be interpolated rather than toggled by class.
  const wrapStyle = { '--ghost-shrink': lerp(1, 0.55, cardT) } as React.CSSProperties
  // Same cardT phasing the ghost-shrink above — the stage's own min-height
  // (see that rule) floors it at a full viewport slot so the CENTERED,
  // full-color "manual research" state has real slack to distribute (the
  // ask this was built for). But by "Unblocked", ghost-shrink has already
  // shrunk the graphic down to ~55% — if the floor stayed at a full
  // viewport, centering would spread the (now much bigger, unfilled) gap
  // between the heading and the status card instead of shrinking away with
  // the content, which read as a huge dead gap before the next section
  // rather than a tighter "Unblocked" composition. Interpolating the floor
  // itself down to 0 in lockstep means the stage just falls back to its
  // natural (smaller) content height by the time the ghost state settles.
  const stageStyle = { '--center-t': 1 - cardT } as React.CSSProperties

  return (
    <div className="landing-scatter-pinwrap" ref={wrapRef}>
      <div className="landing-scatter-stage" ref={stageRef} style={stageStyle}>
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

        <div className="landing-scatter-wrap" style={wrapStyle} ref={graphicRef}>
          <div className="landing-scatter">
            {SCATTER_ITEMS.map((item) => (
              <ScatterCard key={item.n} item={item} cardStyle={cardStyle} frameStyle={frameStyle} />
            ))}
          </div>
        </div>

        {/* Sibling of .landing-scatter, NOT a child — .landing-scatter has a
            `transform: scale(...)` on it (the short-viewport fix), and per
            spec a transformed ancestor becomes the containing block for
            position:fixed descendants too. Nested inside, this card was
            centering relative to the (possibly scaled/offset) scatter box
            instead of the real viewport. */}
        <div
          ref={statusRef}
          className="landing-fanin-status is-scrubbed"
          style={{
            // Fades in via statusT and holds — no exit animation (see the
            // comment on statusT above for why).
            opacity: statusT,
            pointerEvents: statusT < 0.05 || overshoot > 0 ? 'none' : 'auto',
            // transform is NOT set here — useScrollProgress writes the
            // small settle nudge directly to this ref every scroll tick, in
            // lockstep with the native sticky release (see the comment on
            // statusRef above). A React-state-driven value here would be a
            // render cycle behind that, which is exactly what caused the
            // gap to feel inconsistent / the card to seem to move later
            // than the header.
          }}
        >
          {statusRows}
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

  // The before/after stat cards sit still on the page until scrolled into
  // view, then rise + fade in — same trigger pattern as the resolved-status
  // card above (useInView), just for a simple one-shot reveal instead of a
  // typewriter.
  const { ref: proofStatRef, inView: proofStatInView } = useInView<HTMLDivElement>()
  // The whole "Upgrade your existing tools" section rises + fades in as it
  // scrolls into view right after the pinned scatter stage releases — same
  // useInView pattern, just on the section itself rather than one block
  // inside it. Independent of proofStatRef's own (separately staggered)
  // reveal for the stat cards — both firing close together as the section
  // enters view reads as one cohesive entrance, not a conflict.
  // Low threshold, deliberately: this section is tall, so the default 0.4
  // (40% visible) didn't fire until it was already well into the viewport —
  // its box occupies page space before that point regardless, so opacity:0
  // content sitting in already-visible space read as an awkward blank gap
  // rather than a smooth entrance. Firing at 5% starts the fade the moment
  // it's barely on screen instead.
  const { ref: stackSectionRef, inView: stackSectionInView } = useInView<HTMLElement>(0.05)

  return (
    <div className="landing">
      <div className="landing-fold">
        <DotGlobe className="landing-hero-map" />
        <div className="landing-fold-fade" aria-hidden="true" />
        <nav className="landing-nav">
          <span className="landing-brand">canary</span>
          <div className="landing-nav-right">
            <button className="landing-btn landing-btn-primary landing-btn-sm" onClick={() => setContactOpen(true)}>
              Book a demo call
            </button>
          </div>
        </nav>
        <div className="landing-fold-body">
          <header className="landing-hero">
            <h1>Months of research.<br />One API call.</h1>
            <p className="landing-sub">
              Canary accurately makes the public record machine-readable.
            </p>
            <div className="landing-hero-actions">
              <button className="landing-btn landing-btn-primary" onClick={() => setContactOpen(true)}>Book a demo call</button>
              <button className="landing-btn landing-btn-ghost" onClick={() => setDocsOpen(true)}>See how it works</button>
              </div>
            </header>

          <section className="landing-section landing-testimonial-section">
            <div className="landing-testimonial-card">
              <p className="landing-testimonial-quote">
                &ldquo;AEC pursuit teams lose months piecing together hidden and fragmented
                information. With a tool like Canary, 2&ndash;3 months of research will be condensed into
                just days.&rdquo;
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

      <section
        ref={stackSectionRef}
        className={`landing-section landing-stack-section${stackSectionInView ? ' is-visible' : ''}`}
      >
        <h2>Upgrade your existing tools with Canary&rsquo;s intelligence.</h2>
        <div ref={proofStatRef} className={`landing-proof-stat${proofStatInView ? ' is-visible' : ''}`}>
          {/* Both cards open the same Docs window "See how it works" does —
              these numbers are a claim, and the whole page's pitch is
              "cited, always": clicking through to the actual methodology
              should be one tap away, not just asserted. */}
          <div
            className="landing-proof-card landing-proof-card--before"
            role="button"
            tabIndex={0}
            onClick={() => setDocsOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDocsOpen(true) } }}
          >
            <div className="landing-proof-card-flip">
              <div className="landing-proof-card-face landing-proof-card-face--front">
                <span className="landing-proof-card-label">Unassisted</span>
                <span className="landing-proof-before">25 &ndash; 47%</span>
                <span className="landing-proof-metric">LLM accuracy</span>
              </div>
              <div className="landing-proof-card-face landing-proof-card-face--back">
                <span className="landing-proof-card-cta">View Documentation</span>
              </div>
            </div>
          </div>
          <span className="landing-proof-arrow">&rarr;</span>
          <div
            className="landing-proof-card landing-proof-card--after"
            role="button"
            tabIndex={0}
            onClick={() => setDocsOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDocsOpen(true) } }}
          >
            <div className="landing-proof-card-flip">
              <div className="landing-proof-card-face landing-proof-card-face--front">
                <span className="landing-proof-card-label">With Canary</span>
                <span className="landing-proof-after">95 &ndash; 99%</span>
                <span className="landing-proof-metric landing-proof-metric--after">LLM accuracy</span>
              </div>
              <div className="landing-proof-card-face landing-proof-card-face--back">
                <span className="landing-proof-card-cta landing-proof-card-cta--after">View Documentation</span>
              </div>
            </div>
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

      <section className="landing-section landing-sectors-section">
        <h2>Sectors we power</h2>
      </section>

      <div className="landing-sectors-carousel">
        <div className="landing-sectors-track">
          <div className="landing-sectors-row">
            {SECTOR_ROW_1.map((s) => <SectorCard key={`a-${s.name}`} sector={s} />)}
            {/* Duplicate copy, back to back — animating this row exactly
                -50% loops seamlessly, since the second half is pixel-
                identical to the first (same trick as the old panning
                dot-map). Each row carries its own animation/copy so a
                7-card row and a 6-card row each loop at their own exact
                point, instead of one shared transform trying to fit both. */}
            {SECTOR_ROW_1.map((s) => <SectorCard key={`b-${s.name}`} sector={s} />)}
          </div>
          <div className="landing-sectors-row landing-sectors-row--offset">
            {SECTOR_ROW_2.map((s) => <SectorCard key={`a-${s.name}`} sector={s} />)}
            {SECTOR_ROW_2.map((s) => <SectorCard key={`b-${s.name}`} sector={s} />)}
          </div>
        </div>
      </div>

      <section className="landing-closing">
        <h2>Stop hunting down information. Start bidding.</h2>
        <button className="landing-btn landing-btn-primary" onClick={() => setContactOpen(true)}>Book a demo call</button>
      </section>

      <footer className="landing-footer">
        <span className="landing-brand">canary</span>
        <div className="landing-footer-links">
          <button onClick={() => setContactOpen(true)}>Book a demo call</button>
        </div>
      </footer>

      {contactOpen && <ContactModal onClose={() => setContactOpen(false)} />}
      {docsOpen && <Docs onClose={() => setDocsOpen(false)} />}
      {/* position:fixed, so placement in the tree doesn't matter — rendered
          once for the whole page rather than per-section. */}
      <LandingDataPrompt />
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

