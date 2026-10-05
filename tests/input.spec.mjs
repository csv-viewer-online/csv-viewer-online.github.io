import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { ensureFixtures } from './fixtures.mjs'

let paths
test.beforeAll(async () => { paths = await ensureFixtures() })

/** Dispatches a real drop event, which is the path that used to fail silently. */
async function dropFile(page, name, { extra } = {}) {
  const files = [name, ...(extra ? [extra] : [])].map((f) => ({
    name: f,
    data: readFileSync(paths[f]).toString('base64')
  }))
  await page.evaluate((files) => {
    const dt = new DataTransfer()
    for (const f of files) {
      const bin = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))
      dt.items.add(new File([bin], f.name))
    }
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, files)
}

test.describe('accepted file types', () => {
  // The bug: the drop handler required a .csv extension, so a .tsv was
  // discarded with no message at all.
  test('a .tsv can be dropped, not just picked', async ({ page }) => {
    await page.goto('/')
    await dropFile(page, 'tabs.tsv')
    await expect(page.locator('body')).toHaveClass(/loaded/)
    await expect(page.locator('#file-name')).toHaveText('tabs.tsv')
    await expect(page.locator('#handsontable-container .ht_master tbody tr')).toHaveCount(2)
  })

  test('a .tsv can still be opened through the file picker', async ({ page }) => {
    await page.goto('/')
    await page.setInputFiles('#input-file', paths['tabs.tsv'])
    await expect(page.locator('body')).toHaveClass(/loaded/)
    await expect(page.locator('#handsontable-container .ht_master tbody tr')).toHaveCount(2)
  })

  test('the picker offers more than .csv', async ({ page }) => {
    await page.goto('/')
    const accept = await page.getAttribute('#input-file', 'accept')
    for (const ext of ['.csv', '.tsv', '.tab', '.txt']) expect(accept).toContain(ext)
  })

  test('the detected separator is named when it is not a comma', async ({ page }) => {
    await page.goto('/')
    await page.setInputFiles('#input-file', paths['tabs.tsv'])
    await expect(page.locator('#file-count')).toContainText('tab')

    await page.setInputFiles('#input-file', paths['semicolons.csv'])
    await expect(page.locator('#file-count')).toContainText('semicolon')

    await page.setInputFiles('#input-file', paths['pipes.csv'])
    await expect(page.locator('#file-count')).toContainText('pipe')
  })

  test('a comma-separated file says nothing about its separator', async ({ page }) => {
    await page.goto('/')
    await page.setInputFiles('#input-file', paths['plain.csv'])
    await expect(page.locator('#file-count')).toHaveText('3 rows × 3 cols')
  })

  test('dropping several files opens one and says so', async ({ page }) => {
    await page.goto('/')
    await dropFile(page, 'plain.csv', { extra: 'tabs.tsv' })
    await expect(page.locator('body')).toHaveClass(/loaded/)
    await expect(page.locator('#file-name')).toHaveText('plain.csv')
    await expect(page.locator('#notice')).toContainText('Only one file')
  })
})

test.describe('parse problems are reported', () => {
  // The bug: parsed.errors was discarded, so a mis-parse looked like a clean read.
  test('a malformed file warns instead of looking fine', async ({ page }) => {
    await page.goto('/')
    await page.setInputFiles('#input-file', paths['malformed.csv'])
    await expect(page.locator('body')).toHaveClass(/loaded/)

    const notice = page.locator('#notice')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('malformed.csv')
    await expect(notice).toContainText(/parse warning/)
    // The rows still show — a partial read is usually still useful
    await expect(page.locator('#handsontable-container')).toBeVisible()
  })

  test('a header-only file explains itself', async ({ page }) => {
    await page.goto('/')
    await page.setInputFiles('#input-file', paths['header-only.csv'])
    const notice = page.locator('#notice')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('No rows found')
    await expect(notice).toHaveClass(/is-error/)
  })

  test('a file that is not delimited text is called out', async ({ page }) => {
    await page.goto('/')
    await page.setInputFiles('#input-file', paths['not-a-csv.png'])
    const notice = page.locator('#notice')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveClass(/is-error/)
    // Whatever the wording, it must not be silent and must not claim success
    await expect(notice).toContainText('not-a-csv.png')
  })

  test('a clean file shows no notice at all', async ({ page }) => {
    await page.goto('/')
    await page.setInputFiles('#input-file', paths['plain.csv'])
    await expect(page.locator('body')).toHaveClass(/loaded/)
    await expect(page.locator('#notice')).toBeHidden()
  })

  test('the notice can be dismissed and does not persist to the next file', async ({ page }) => {
    await page.goto('/')
    await page.setInputFiles('#input-file', paths['malformed.csv'])
    await expect(page.locator('#notice')).toBeVisible()

    await page.click('#notice-dismiss')
    await expect(page.locator('#notice')).toBeHidden()

    // A clean file afterwards must not inherit the warning
    await page.setInputFiles('#input-file', paths['plain.csv'])
    await expect(page.locator('#handsontable-container .ht_master tbody tr')).toHaveCount(3)
    await expect(page.locator('#notice')).toBeHidden()
  })
})

test('the notice does not break layout or the grid', async ({ page }) => {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    await page.setInputFiles('#input-file', paths['malformed.csv'])
    await expect(page.locator('#notice')).toBeVisible()

    // No page-level scrollbars, and the grid still has room to render
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight)).toBe(false)
    const box = await page.locator('#handsontable-container').boundingBox()
    expect(box.height).toBeGreaterThan(50)
  }
})

test('the toolbar survives a long chip at 390px', async ({ page }) => {
  // tab-separated AND Windows-1252 makes the longest chip the app can produce
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.setInputFiles('#input-file', {
    name: 'wide.tsv',
    mimeType: 'text/tab-separated-values',
    buffer: Buffer.from('name\tcity\nJos\xe9\tK\xf6ln\n', 'latin1')
  })
  await expect(page.locator('body')).toHaveClass(/loaded/)
  await expect(page.locator('#file-count')).toContainText('Windows-1252')

  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  await expect(page.locator('#open-btn')).toBeVisible()
  expect(await page.evaluate(() => Math.round(document.querySelector('.toolbar').getBoundingClientRect().height))).toBe(49)
})
