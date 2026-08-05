import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { ensureFixtures } from './fixtures.mjs'

let paths
test.beforeAll(async () => { paths = await ensureFixtures() })

async function open(page, name = 'plain.csv') {
  await page.goto('/')
  await page.setInputFiles('#input-file', paths[name])
  await expect(page.locator('body')).toHaveClass(/loaded/)
  await expect(page.locator('#handsontable-container .ht_master tbody tr').first()).toBeVisible()
}

/** Clicks a menu item and returns the downloaded file's text. */
async function grabDownload(page, action) {
  await page.click('#download-btn')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click(`[data-export="${action}"]`)
  ])
  const path = await download.path()
  return { text: await readFile(path, 'utf8'), name: download.suggestedFilename() }
}

test.describe('the menu', () => {
  test('is hidden until a file is open', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#download-btn')).toBeHidden()
    await open(page)
    await expect(page.locator('#download-btn')).toBeVisible()
  })

  test('opens, closes on Escape, and closes on an outside click', async ({ page }) => {
    await open(page)
    const menu = page.locator('#download-menu')

    await page.click('#download-btn')
    await expect(menu).toBeVisible()
    await expect(page.locator('#download-btn')).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(page.locator('#download-btn')).toHaveAttribute('aria-expanded', 'false')

    await page.click('#download-btn')
    await expect(menu).toBeVisible()
    await page.locator('.mark').click()
    await expect(menu).toBeHidden()
  })
})

test.describe('CSV', () => {
  test('downloads the rows on screen, named after the source file', async ({ page }) => {
    await open(page)
    const { text, name } = await grabDownload(page, 'csv')

    expect(name).toBe('plain-export.csv')
    // BOM first, so Excel reads it as UTF-8 instead of guessing a codepage
    expect(text.charCodeAt(0)).toBe(0xFEFF)

    const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/)
    expect(lines[0]).toBe('name,city,note')
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain('José')
  })

  test('keeps the separator the file arrived with', async ({ page }) => {
    await open(page, 'tabs.tsv')
    const { text } = await grabDownload(page, 'csv')
    const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/)
    expect(lines[0]).toBe('name\tcity\tqty')
    expect(lines[1]).toBe('Acme\tBerlin\t5')
  })

  test('exports only the rows matching the search', async ({ page }) => {
    await open(page)
    await page.fill('#search-input', 'Zürich')
    await expect(page.locator('#handsontable-container .ht_master tbody tr')).toHaveCount(1)

    const { text } = await grabDownload(page, 'csv')
    const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Müller')
    expect(text).not.toContain('José')
  })

  test('exports in the chosen sort order', async ({ page }) => {
    await open(page)
    const before = await grabDownload(page, 'csv')
    const namesOf = (t) => t.replace(/^﻿/, '').trim().split(/\r?\n/).slice(1).map((l) => l.split(',')[0])
    expect(namesOf(before.text)).toEqual(['José', 'François', 'Müller'])

    // Sort by name, then export again
    await page.click('#handsontable-container .ht_clone_top thead th:nth-child(2)')
    await expect(page.locator('#handsontable-container .ht_master tbody tr').first().locator('td').first())
      .toHaveText('François')

    const after = await grabDownload(page, 'csv')
    expect(namesOf(after.text), 'the download must follow the visible order').toEqual(['François', 'José', 'Müller'])
  })

  test('includes cell edits', async ({ page }) => {
    await open(page)
    const cell = page.locator('#handsontable-container .ht_master tbody tr').first().locator('td').first()
    await cell.dblclick()
    // Set the editor's value outright: Ctrl+A does not select inside
    // Handsontable's editor, so typing would prepend to the existing text.
    await page.fill('.handsontableInput', 'EDITED')
    await page.keyboard.press('Enter')
    await expect(cell).toHaveText('EDITED')

    const { text } = await grabDownload(page, 'csv')
    expect(text).toContain('EDITED')
  })
})

test.describe('JSON', () => {
  test('downloads an array of objects keyed by the headers', async ({ page }) => {
    await open(page)
    const { text, name } = await grabDownload(page, 'json')

    expect(name).toBe('plain-export.json')
    const data = JSON.parse(text)
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(3)
    expect(Object.keys(data[0])).toEqual(['name', 'city', 'note'])
    expect(data[0].name).toBe('José')
  })

  test('has no BOM, which would break JSON.parse for consumers', async ({ page }) => {
    await open(page)
    const { text } = await grabDownload(page, 'json')
    expect(text.charCodeAt(0)).not.toBe(0xFEFF)
    expect(() => JSON.parse(text)).not.toThrow()
  })
})

test.describe('clipboard', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  test('copies the visible rows as CSV', async ({ page }) => {
    await open(page)
    await page.click('#download-btn')
    await page.click('[data-export="copy"]')

    await expect(page.locator('#notice')).toContainText('Copied 3 rows')
    await expect(page.locator('#notice')).toHaveClass(/is-ok/)

    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip.split(/\r?\n/)[0]).toBe('name,city,note')
    expect(clip).toContain('José')
    // The clipboard gets plain text, with no BOM to paste as a stray character
    expect(clip.charCodeAt(0)).not.toBe(0xFEFF)
  })
})

test('copy still succeeds when the async clipboard API is unavailable', async ({ page }) => {
  // No clipboard permissions granted here, and the async API is removed
  // outright, so only the selection-based fallback can satisfy this.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { get: () => undefined })
  })
  await open(page)
  await page.click('#download-btn')
  await page.click('[data-export="copy"]')

  await expect(page.locator('#notice')).toContainText('Copied 3 rows')
  await expect(page.locator('#notice')).toHaveClass(/is-ok/)
})

test('a file with no rows offers nothing to download', async ({ page }) => {
  await page.goto('/')
  await page.setInputFiles('#input-file', paths['header-only.csv'])
  await expect(page.locator('#notice')).toContainText('No rows found')

  await page.click('#download-btn')
  await page.click('[data-export="csv"]')
  await expect(page.locator('#notice')).toContainText('nothing to download')
  await expect(page.locator('#notice')).toHaveClass(/is-error/)
})

test('the FAQ no longer claims there is no export', async ({ page }) => {
  await page.goto('/')
  const faq = await page.locator('.content').innerText()
  expect(faq).not.toContain('there is no export')
  expect(faq).toContain('Download')
})
