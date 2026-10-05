// Renders favicon.svg to the PNG sizes the manifest declares.
//
// Run by hand when the mark changes:  bun tools/make-icons.mjs
//
// Deliberately not wired into CI: it would mean installing Playwright browsers
// on every run to regenerate four files that are already committed. It exists
// so the icons can be reproduced from the mark, not to automate anything.
import { chromium } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'icons')
const svg = await readFile(join(ROOT, 'favicon.svg'), 'utf8')

// Android crops maskable icons to a safe zone. The white table in the mark runs
// close to the edge, so the maskable variant is inset on its own blue field —
// the mark's rounded corners vanish blue-on-blue, which is the intended result.
const TARGETS = [
  { file: 'icon-192.png', size: 192, inset: 0 },
  { file: 'icon-512.png', size: 512, inset: 0 },
  { file: 'icon-512-maskable.png', size: 512, inset: 0.19 },
  { file: 'apple-touch-180.png', size: 180, inset: 0 }
]

const browser = await chromium.launch()
const page = await browser.newPage()
await mkdir(OUT, { recursive: true })

for (const t of TARGETS) {
  const pad = Math.round(t.size * t.inset)
  const inner = t.size - pad * 2
  await page.setViewportSize({ width: t.size, height: t.size })
  await page.setContent(`<!doctype html>
    <style>
      html, body { margin: 0; padding: 0 }
      body {
        width: ${t.size}px; height: ${t.size}px; background: #126BCF;
        display: flex; align-items: center; justify-content: center;
      }
      svg { width: ${inner}px; height: ${inner}px; display: block }
    </style>${svg}`)
  await page.screenshot({ path: join(OUT, t.file) })
  console.log(`${t.file}  ${t.size}px${pad ? `  inset ${pad}px` : ''}`)
}

await browser.close()
