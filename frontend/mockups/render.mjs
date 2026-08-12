// Renders each mockup HTML file to a PNG, clipped to its .window element,
// at 2x device scale (see the asset brief). Output goes to
// frontend/public/scatter/, filenames matching Landing.tsx's SCATTER_ITEMS.
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, '..', 'public', 'scatter')
fs.mkdirSync(outDir, { recursive: true })

const FILES = [
  'zoning-map',
  'council-agenda',
  'email-thread',
  'permit-spreadsheet',
  'voicemail-call',
  'submittal-checklist',
]

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 2 })

for (const name of FILES) {
  const src = path.join(__dirname, `${name}.html`)
  await page.goto(`file://${src}`)
  const el = await page.$('.window')
  const box = await el.boundingBox()
  await page.setViewportSize({ width: Math.ceil(box.width), height: Math.ceil(box.height) })
  const dest = path.join(outDir, `${name}.png`)
  await el.screenshot({ path: dest, omitBackground: true })
  console.log(`${name}.png  ${Math.round(box.width * 2)}x${Math.round(box.height * 2)}`)
}

await browser.close()
