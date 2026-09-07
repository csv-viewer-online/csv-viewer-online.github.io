import { test, expect } from '@playwright/test'
import { ensureFixtures } from './fixtures.mjs'

let paths
test.beforeAll(async () => { paths = await ensureFixtures() })

const dialog = (page) => page.locator('#sponsor-dialog')

test('the CTA is a button, not a mailto link', async ({ page }) => {
  await page.goto('/')
  const cta = page.locator('#sponsor-cta')
  await expect(cta).toBeVisible()
  expect(await cta.evaluate((el) => el.tagName)).toBe('BUTTON')
  await expect(cta).toHaveAttribute('aria-haspopup', 'dialog')

  // No mailto should fire from the rail itself any more
  const railMailtos = await page.locator('.rail a[href^="mailto:"]').count()
  expect(railMailtos).toBe(0)
})

test('clicking it opens a dialog with the stats and the address', async ({ page }) => {
  await page.goto('/')
  await expect(dialog(page)).toBeHidden()

  await page.click('#sponsor-cta')
  await expect(dialog(page)).toBeVisible()

  const text = await dialog(page).innerText()
  expect(text).toContain('~50,000')
  expect(text).toContain('#2')
  expect(text).toContain('$19')
  expect(text).toContain('CSV Viewer')

  await expect(page.locator('#sponsor-email')).toHaveText('csv-viewer-online@tianon.anonaddy.me')
  // A mailto is still offered inside the dialog, as a secondary route
  await expect(page.locator('.dialog-mail')).toHaveAttribute('href', /^mailto:csv-viewer-online@/)
})

test('it is a modal, so the page behind is inert', async ({ page }) => {
  await page.goto('/')
  await page.click('#sponsor-cta')
  expect(await dialog(page).evaluate((d) => d.matches(':modal'))).toBe(true)
})

test.describe('closing', () => {
  test('Escape closes it', async ({ page }) => {
    await page.goto('/')
    await page.click('#sponsor-cta')
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
  })

  test('the close button closes it', async ({ page }) => {
    await page.goto('/')
    await page.click('#sponsor-cta')
    await page.click('#sponsor-dialog-close')
    await expect(dialog(page)).toBeHidden()
  })

  test('clicking the backdrop closes it, clicking inside does not', async ({ page }) => {
    await page.goto('/')
    await page.click('#sponsor-cta')

    // Inside first: the dialog must survive a click on its own content
    await page.locator('#sponsor-dialog-title').click()
    await expect(dialog(page)).toBeVisible()

    // Then the backdrop, at a point outside the dialog's box
    const box = await dialog(page).boundingBox()
    await page.mouse.click(Math.max(4, box.x / 2), Math.max(4, box.y / 2))
    await expect(dialog(page)).toBeHidden()
  })

  test('focus returns to the CTA after closing', async ({ page }) => {
    await page.goto('/')
    await page.click('#sponsor-cta')
    await page.keyboard.press('Escape')
    await expect(page.locator('#sponsor-cta')).toBeFocused()
  })
})

test.describe('copying the address', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  test('the copy button puts the address on the clipboard', async ({ page }) => {
    await page.goto('/')
    await page.click('#sponsor-cta')
    await page.click('#copy-email')

    await expect(page.locator('#copy-email')).toHaveText('Copied')
    expect(await page.evaluate(() => navigator.clipboard.readText()))
      .toBe('csv-viewer-online@tianon.anonaddy.me')

    // and it goes back to its resting label
    await expect(page.locator('#copy-email')).toHaveText('Copy', { timeout: 4000 })
  })
})

test('it still works with a file open', async ({ page }) => {
  await page.goto('/')
  await page.setInputFiles('#input-file', paths['plain.csv'])
  await expect(page.locator('body')).toHaveClass(/loaded/)

  await page.click('#sponsor-cta')
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  // Escape must not also wipe the search or otherwise disturb the grid
  await expect(page.locator('#handsontable-container .ht_master tbody tr')).toHaveCount(3)
})

test('the CTA still sits among the sponsor tiles at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.rail .tile#sponsor-cta')).toBeVisible()

  await page.click('#sponsor-cta')
  await expect(dialog(page)).toBeVisible()
  const box = await dialog(page).boundingBox()
  expect(box.width).toBeLessThanOrEqual(390)
  expect(box.x).toBeGreaterThanOrEqual(0)
})
