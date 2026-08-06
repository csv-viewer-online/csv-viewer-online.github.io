import { test, expect } from '@playwright/test'
import { ensureFixtures } from './fixtures.mjs'

let paths
test.beforeAll(async () => { paths = await ensureFixtures() })

const CELL = (row, col) =>
  `#handsontable-container .ht_master tbody tr:nth-child(${row}) td:nth-child(${col})`

async function open(page, file = 'plain.csv') {
  await page.goto('/')
  await page.setInputFiles('#input-file', paths[file])
  await expect(page.locator('body')).toHaveClass(/loaded/)
  await expect(page.locator(CELL(1, 2))).toBeVisible()
}

/** Sets the editor's value outright — Ctrl+A does not select inside it. */
async function editCell(page, row, col, value) {
  await page.dblclick(CELL(row, col))
  await page.fill('.handsontableInput', value)
  await page.keyboard.press('Enter')
}

const marked = (page) => page.$$eval('#handsontable-container .ht_master tbody td.is-edited',
  tds => tds.map(td => td.textContent))

test('an untouched file has no markers', async ({ page }) => {
  await open(page)
  expect(await marked(page)).toEqual([])
})

test('editing a cell marks it, and only it', async ({ page }) => {
  await open(page)
  await editCell(page, 1, 2, 'CHANGED')

  await expect(page.locator(CELL(1, 2))).toHaveClass(/is-edited/)
  expect(await marked(page)).toEqual(['CHANGED'])
  // neighbours stay unmarked
  await expect(page.locator(CELL(1, 3))).not.toHaveClass(/is-edited/)
  await expect(page.locator(CELL(2, 2))).not.toHaveClass(/is-edited/)
})

test('emptying a cell with Delete marks it', async ({ page }) => {
  // The reported case: a wiped cell looked identical to one the file left blank
  await open(page)
  await page.click(CELL(1, 2))
  await page.keyboard.press('Delete')

  await expect(page.locator(CELL(1, 2))).toHaveText('')
  await expect(page.locator(CELL(1, 2)), 'an emptied cell must not look like file data')
    .toHaveClass(/is-edited/)
})

test('retyping the original value still counts as untouched-looking data', async ({ page }) => {
  // Marking is about "you changed this", so a no-op edit should not mark
  await open(page)
  const original = await page.locator(CELL(1, 2)).textContent()
  await editCell(page, 1, 2, original)
  await expect(page.locator(CELL(1, 2))).not.toHaveClass(/is-edited/)
})

test('the marker follows its row when the grid is sorted', async ({ page }) => {
  await open(page)
  await editCell(page, 1, 2, 'zzz-last-when-sorted')

  await page.click('#handsontable-container .ht_clone_top thead th:nth-child(2)')
  await expect(page.locator(CELL(1, 2))).not.toHaveText('zzz-last-when-sorted')

  // Still exactly one marked cell, and it is the one that was edited
  expect(await marked(page)).toEqual(['zzz-last-when-sorted'])
})

test('the marker survives searching and clearing', async ({ page }) => {
  await open(page)
  await editCell(page, 1, 2, 'Marseille')

  await page.click('#search-input')
  await page.keyboard.type('Marseille')
  await expect(page.locator('#handsontable-container .ht_master tbody tr')).toHaveCount(1)
  expect(await marked(page)).toEqual(['Marseille'])

  for (let i = 0; i < 12; i++) await page.keyboard.press('Backspace')
  await expect(page.locator('#handsontable-container .ht_master tbody tr')).toHaveCount(3)
  expect(await marked(page), 'filtering must not lose or duplicate markers').toEqual(['Marseille'])
})

test('opening another file clears the markers', async ({ page }) => {
  await open(page)
  await editCell(page, 1, 2, 'CHANGED')
  expect(await marked(page)).toHaveLength(1)

  await page.setInputFiles('#input-file', paths['semicolons.csv'])
  await expect(page.locator('#file-name')).toHaveText('semicolons.csv')
  expect(await marked(page)).toEqual([])
})

test('an edited cell still downloads with its new value', async ({ page }) => {
  await open(page)
  await editCell(page, 1, 2, 'CHANGED')

  await page.click('#download-btn')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-export="csv"]')
  ])
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(await download.path(), 'utf8')
  expect(text).toContain('CHANGED')
})
