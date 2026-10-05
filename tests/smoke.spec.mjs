import { test, expect } from '@playwright/test'
import { ensureFixtures } from './fixtures.mjs'

let paths
test.beforeAll(async () => { paths = await ensureFixtures() })

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 720 },
  mobile: { width: 390, height: 844 }
}

test.describe('empty state', () => {
  for (const [label, viewport] of Object.entries(VIEWPORTS)) {
    test(`${label}: renders with no console errors`, async ({ page }) => {
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

      await page.setViewportSize(viewport)
      await page.goto('/')

      // Guards the class collision that once made `.noresult { display: none }`
      // match <body class="noresult"> and blank the entire page.
      await expect(page.locator('.toolbar')).toBeVisible()
      await expect(page.locator('#drop-zone')).toBeVisible()

      // The drop card must be reachable without scrolling at every width
      const box = await page.locator('#drop-zone').boundingBox()
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)

      expect(errors).toEqual([])
    })

    // A hidden notice used to leave .work and .rail auto-placed into its
    // auto-sized row, so the app filled only its content height and left the
    // bottom of the viewport blank. Nothing asserted full height before.
    test(`${label}: the layout fills the viewport height`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')

      // Layout-agnostic: the rail is beside .work on desktop and below it on
      // mobile, so assert on whatever sits lowest rather than a fixed element.
      const layout = await page.evaluate(() => {
        const visible = [...document.body.children].filter((el) => getComputedStyle(el).display !== 'none')
        const lowest = Math.max(...visible.map((el) => el.getBoundingClientRect().bottom))
        const rows = getComputedStyle(document.body).gridTemplateRows.split(' ').map(parseFloat)
        return {
          lowest: Math.round(lowest),
          unusedTrack: Math.round(rows.reduce((a, b) => a + b, 0) - lowest),
          railBottom: Math.round(document.querySelector('.rail').getBoundingClientRect().bottom)
        }
      })
      expect(layout.lowest, 'the page must reach the bottom of the viewport').toBe(viewport.height)
      expect(layout.unusedTrack, 'no grid row may sit unused below the content').toBe(0)
      expect(layout.railBottom, 'the sponsor rail must reach the bottom').toBe(viewport.height)
    })

    test(`${label}: still fills the viewport with a file open and a notice showing`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await page.setInputFiles('#input-file', paths['malformed.csv'])
      await expect(page.locator('#notice')).toBeVisible()

      const rail = await page.locator('.rail').boundingBox()
      expect(Math.round(rail.y + rail.height), 'the rail must still reach the bottom').toBe(viewport.height)

      // The grid keeps real height even with the notice taking a row
      const grid = await page.locator('#handsontable-container').boundingBox()
      expect(grid.height).toBeGreaterThan(100)

      // and the notice must sit between the toolbar and the work area
      const gap = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect()
        return {
          afterToolbar: Math.round(r('#notice').top - r('.toolbar').bottom),
          beforeWork: Math.round(r('.work').top - r('#notice').bottom)
        }
      })
      expect(gap).toEqual({ afterToolbar: 0, beforeWork: 0 })
    })

    test(`${label}: no horizontal overflow outside the sponsor rail`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      // The rail scrolls horizontally by design; nothing else may.
      const offenders = await page.evaluate(() => {
        const w = document.documentElement.clientWidth
        return [...document.querySelectorAll('body *')]
          .filter((el) => !el.closest('.rail') && el.getBoundingClientRect().right > w + 1)
          .map((el) => el.tagName + '.' + String(el.className).slice(0, 30))
      })
      expect(offenders).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    })
  }
})

test('the grid is not downloaded until a file is opened', async ({ page, context }) => {
  // Guards the 1.67 MB deferral: this is 92% of what page weight used to be.
  const requested = []
  // context, not page: page.on('request') is blind to service-worker-initiated
  // fetches, so a precache regression would go unseen. Verified by putting
  // vendor/ into SHELL — the page-scoped listener still reported clean.
  context.on('request', (r) => requested.push(r.url()))
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  expect(requested.some((u) => /handsontable/.test(u)), 'handsontable must not load on page view').toBe(false)
  expect(requested.some((u) => /papaparse/.test(u)), 'papaparse must not load on page view').toBe(false)

  await page.setInputFiles('#input-file', paths['plain.csv'])
  await expect(page.locator('body')).toHaveClass(/loaded/)
  expect(requested.some((u) => /handsontable/.test(u))).toBe(true)
})

test('opening a file fills the toolbar and the grid', async ({ page }) => {
  await page.goto('/')
  await page.setInputFiles('#input-file', paths['plain.csv'])
  await expect(page.locator('body')).toHaveClass(/loaded/)

  await expect(page.locator('#file-name')).toHaveText('plain.csv')
  await expect(page.locator('#file-count')).toContainText('3 rows × 3 cols')
  await expect(page.locator('#handsontable-container .ht_master tbody tr')).toHaveCount(3)

  // The empty state and its prose must get out of the way
  await expect(page.locator('.hero')).toBeHidden()
  await expect(page.locator('.content')).toBeHidden()
})

test('re-selecting the same file still reloads it', async ({ page }) => {
  // A file input fires no change event when the same file is picked again, so
  // without clearing input.value the obvious retry silently does nothing.
  await page.goto('/')
  let changes = 0
  await page.exposeFunction('__onChange', () => { changes++ })
  await page.evaluate(() => document.getElementById('input-file').addEventListener('change', () => window.__onChange()))

  await page.setInputFiles('#input-file', paths['plain.csv'])
  await expect(page.locator('body')).toHaveClass(/loaded/)
  await page.setInputFiles('#input-file', paths['plain.csv'])
  await page.waitForTimeout(500)

  expect(changes, 'the second selection of the same file must still fire').toBe(2)
})

test('search filters, focuses with / and clears with Escape', async ({ page }) => {
  await page.goto('/')
  await page.setInputFiles('#input-file', paths['plain.csv'])
  await expect(page.locator('body')).toHaveClass(/loaded/)

  const rows = page.locator('#handsontable-container .ht_master tbody tr')
  await expect(rows).toHaveCount(3)

  await page.fill('#search-input', 'Zürich')
  await expect(rows).toHaveCount(1)
  await expect(page.locator('#file-count')).toContainText('1 of 3 rows')

  // No match: message shown, page still intact
  await page.fill('#search-input', 'nothing-matches-this')
  await expect(page.locator('#search-empty')).toBeVisible()
  await expect(page.locator('.toolbar')).toBeVisible()

  await page.fill('#search-input', '')
  await expect(rows).toHaveCount(3)

  // "/" focuses from elsewhere, Escape clears
  await page.locator('#handsontable-container .ht_master tbody td').first().click()
  await page.keyboard.press('/')
  await expect(page.locator('#search-input')).toBeFocused()
  await page.keyboard.type('Zürich')
  await expect(rows).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(rows).toHaveCount(3)
})

test('a failed grid fetch shows an error and recovers on retry', async ({ page }) => {
  let blocked = true
  // The grid is vendored now, so the failure to simulate is a local fetch
  // failing — a corrupt cache or a bad deploy — not a CDN outage.
  await page.route('**/vendor/handsontable*', (route) => (blocked ? route.abort() : route.continue()))

  await page.goto('/')
  await page.setInputFiles('#input-file', paths['plain.csv'])
  await expect(page.locator('#drop-status')).toContainText('Could not open')
  await expect(page.locator('#drop-zone'), 'the drop zone must stay usable').toBeVisible()

  blocked = false
  await page.setInputFiles('#input-file', paths['plain.csv'])
  await expect(page.locator('body')).toHaveClass(/loaded/)
  await expect(page.locator('#handsontable-container .ht_master tbody tr')).toHaveCount(3)
})

test('sponsors are all present and keep their link attributes', async ({ page }) => {
  await page.goto('/')
  const paid = page.locator('.rail a[href^="http"]')
  const count = await paid.count()
  expect(count, 'at least one paid sponsor should be listed').toBeGreaterThan(0)

  for (const link of await paid.all()) {
    await expect(link).toBeVisible()
    expect(await link.getAttribute('rel'), 'target=_blank links need noopener').toContain('noopener')
  }
  // The "your ad here" CTA adds one tile on top of the sponsors
  await expect(page.locator('.rail .tile')).toHaveCount(count + 1)

  // Ads must survive a file being opened — that is the longest part of a visit
  await page.setInputFiles('#input-file', paths['plain.csv'])
  await expect(page.locator('body')).toHaveClass(/loaded/)
  await expect(page.locator('.rail .tile')).toHaveCount(count + 1)
})

test.describe('head and static files', () => {
  test('heading outline and prose are present', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('h1')).toHaveText('CSV Viewer & Editor Online')
    // "CSV Viewer" must stay the leading phrase — it is the term the site ranks for
    expect(await page.locator('h1').innerText()).toMatch(/^CSV Viewer\b/)
    expect(await page.title()).toMatch(/^CSV Viewer\b/)
    expect(await page.locator('h2').count()).toBeGreaterThanOrEqual(3)
    const words = (await page.locator('.content').innerText()).trim().split(/\s+/).length
    expect(words, 'the indexable prose block must not shrink away').toBeGreaterThan(250)
  })

  test('canonical, social tags and structured data are valid', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://csv-viewer-online.github.io/')
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')

    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText())
    expect(ld['@type']).toBe('WebApplication')
    expect(ld.name).toBeTruthy()
    expect(ld.url).toBeTruthy()

    // Exactly one verification tag: Google reads the first, so a stale
    // duplicate is a silent way to lose access.
    await expect(page.locator('meta[name="google-site-verification"]')).toHaveCount(1)
  })

  test('og:image exists and matches its declared dimensions', async ({ page, request }) => {
    await page.goto('/')
    const declared = {
      w: Number(await page.locator('meta[property="og:image:width"]').getAttribute('content')),
      h: Number(await page.locator('meta[property="og:image:height"]').getAttribute('content'))
    }
    const res = await request.get('/og.png')
    expect(res.status()).toBe(200)

    const real = await page.evaluate(async () => {
      const bmp = await createImageBitmap(await (await fetch('/og.png')).blob())
      return { w: bmp.width, h: bmp.height }
    })
    // A mismatch here is a common cause of social cards silently not rendering
    expect(real).toEqual(declared)
  })

  test('robots.txt and sitemap.xml are served and agree with the canonical', async ({ request }) => {
    const robots = await request.get('/robots.txt')
    expect(robots.status()).toBe(200)
    expect(await robots.text()).toContain('Sitemap: https://csv-viewer-online.github.io/sitemap.xml')

    const sitemap = await request.get('/sitemap.xml')
    expect(sitemap.status()).toBe(200)
    const xml = await sitemap.text()
    // The plural namespace is the valid one; the singular silently invalidates it
    expect(xml).toContain('http://www.sitemaps.org/schemas/sitemap/0.9')
    expect(xml).toContain('<loc>https://csv-viewer-online.github.io/</loc>')
  })

  test('favicon is served', async ({ request }) => {
    const res = await request.get('/favicon.svg')
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain('<svg')
  })
})

test('every spec file appears in the README table', async () => {
  // That table drifted to six rows out of eleven before anyone noticed, and the
  // test count beside it went stale three separate times. The count is gone;
  // this keeps the table honest without anyone having to remember.
  const { readdir, readFile } = await import('node:fs/promises')
  const here = new URL('.', import.meta.url)
  const specs = (await readdir(here)).filter((f) => f.endsWith('.spec.mjs')).sort()
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')

  const missing = specs.filter((f) => !readme.includes('`' + f + '`'))
  expect(missing, 'these specs have no row in the README Spec table').toEqual([])
})
