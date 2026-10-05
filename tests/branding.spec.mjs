import { test, expect } from '@playwright/test'
import { ensureFixtures } from './fixtures.mjs'

let paths
test.beforeAll(async () => { paths = await ensureFixtures() })

test('the product is named as a viewer and editor throughout', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('h1')).toHaveText('CSV Viewer & Editor Online')
  await expect(page.locator('.mark span')).toHaveText('CSV Viewer & Editor')
  await expect(page.locator('meta[property="og:site_name"]'))
    .toHaveAttribute('content', 'CSV Viewer & Editor Online')

  const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText())
  expect(ld.name).toBe('CSV Viewer & Editor Online')
  expect(ld.description).toMatch(/edit/i)

  // The installed app is named like the wordmark, not like the page: "Online"
  // is a search term people type, and it reads as a contradiction under an
  // icon on an app that runs with no network. Asserted against the wordmark
  // rather than a literal so the two cannot drift apart.
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()
  expect(manifest.name).toBe(await page.locator('.mark span').innerText())
  expect(manifest.name).not.toMatch(/online/i)

  // Editing is described in the prose, not only implied by the UI
  const prose = await page.locator('.content').innerText()
  expect(prose).toMatch(/edit/i)
})

test('"CSV Viewer" stays the leading phrase in the title and h1', async ({ page }) => {
  // The site ranks for "CSV Viewer", so the term must stay contiguous and first
  await page.goto('/')
  expect(await page.title()).toMatch(/^CSV Viewer\b/)
  expect(await page.locator('h1').innerText()).toMatch(/^CSV Viewer\b/)
  await expect(page.locator('meta[property="og:title"]'))
    .toHaveAttribute('content', /^CSV Viewer\b/)
})

test('nothing still calls it a viewer only', async ({ page }) => {
  await page.goto('/')
  const text = await page.locator('body').innerText()
  expect(text).not.toContain('viewer, not a spreadsheet editor')
  expect(text).not.toContain('there is no export')
})

test.describe('the logo links home', () => {
  test('is a real link', async ({ page }) => {
    await page.goto('/')
    const mark = page.locator('a.mark')
    await expect(mark).toBeVisible()
    await expect(mark).toHaveAttribute('href', '/')
    await expect(mark).toHaveAttribute('aria-label', /CSV Viewer/)
  })

  test('clicking it returns to the empty state from an open file', async ({ page }) => {
    await page.goto('/')
    await page.setInputFiles('#input-file', paths['plain.csv'])
    await expect(page.locator('body')).toHaveClass(/loaded/)

    await page.click('a.mark')
    await expect(page.locator('#drop-zone')).toBeVisible()
    await expect(page.locator('body')).not.toHaveClass(/loaded/)
  })

  test('is keyboard reachable', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Tab')
    await expect(page.locator('a.mark')).toBeFocused()
  })
})
