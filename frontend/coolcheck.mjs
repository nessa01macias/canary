import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.addInitScript(() => sessionStorage.setItem('canary_data_prompt_dismissed', '1'))
await page.goto('http://localhost:5316/', { waitUntil: 'networkidle' })

// Same "ring2 touch" setup as before: hover a dot whose ring2 lands exactly
// on an ambient flare's center, so the hover's own center gets infected
// purely by spread (not itself an ambient dot) — then watch its fill as
// infection clears, at animation-frame resolution.
const setup = await page.evaluate(() => new Promise((resolve) => {
  const glows = [...document.querySelectorAll('.landing-dot-globe-glow')]
  const points = [...document.querySelectorAll('.landing-dot-globe-point')]
  const pts = points.map((c) => [parseFloat(c.getAttribute('cx')), parseFloat(c.getAttribute('cy'))])
  const xs = [...new Set(pts.map((p) => p[0]))].sort((a, b) => a - b)
  const ys = [...new Set(pts.map((p) => p[1]))].sort((a, b) => a - b)
  const xIndex = new Map(xs.map((x, i) => [x, i]))
  const yIndex = new Map(ys.map((y, i) => [y, i]))
  const colRow = pts.map(([x, y]) => [xIndex.get(x), yIndex.get(y)])
  const lookup = new Map(colRow.map(([c, r], i) => [`${c},${r}`, i]))
  const navH = document.querySelector('.landing-nav')?.getBoundingClientRect().bottom ?? 0
  const poll = () => {
    for (let i = 0; i < glows.length; i++) {
      if (!glows[i].classList.contains('is-mini-flare')) continue
      const [col, row] = colRow[i]
      const hoverCenterIdx = lookup.get(`${col - 2},${row}`)
      if (hoverCenterIdx === undefined) continue
      const r = points[hoverCenterIdx].getBoundingClientRect()
      const x = r.x + r.width / 2
      const y = r.y + r.height / 2
      if (x > 0 && x < window.innerWidth && y > navH + 20 && y < window.innerHeight) {
        resolve({ hoverCenterIdx, x, y })
        return
      }
    }
    requestAnimationFrame(poll)
  }
  poll()
}))
console.log('setup:', setup)

await page.mouse.move(setup.x, setup.y, { steps: 3 })
await page.waitForTimeout(150)
const confirmInfected = await page.evaluate(
  (i) => document.querySelectorAll('.landing-dot-globe-glow')[i].getAttribute('class'),
  setup.hoverCenterIdx,
)
console.log('confirmed infected before watching:', confirmInfected)

// Poll until is-infected is removed from this dot, then trace fill for the
// next ~500ms.
const trace = await page.evaluate((idx) => new Promise((resolve) => {
  const g = document.querySelectorAll('.landing-dot-globe-glow')[idx]
  let clearedAt = null
  const frames = []
  const poll = () => {
    const infected = g.classList.contains('is-infected')
    if (clearedAt === null && !infected) clearedAt = performance.now()
    if (clearedAt !== null) {
      frames.push([Math.round(performance.now() - clearedAt), getComputedStyle(g).fill])
      if (performance.now() - clearedAt > 500) { resolve(frames); return }
    }
    if (performance.now() > (clearedAt ?? 0) + 9000 && clearedAt === null) { resolve({ timedOut: true }); return }
    requestAnimationFrame(poll)
  }
  poll()
}), setup.hoverCenterIdx)
for (let i = 0; i < trace.length; i += 3) console.log(trace[i])

await browser.close()
