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

async function editCell(page, row, col, value) {
  await page.dblclick(CELL(row, col))
  await page.fill('.handsontableInput', value)
  await page.keyboard.press('Enter')
}

test('the indicator stays hidden until something is edited', async ({ page }) => {
  await open(page)
  await expect(page.locator('#edits')).toBeHidden()
})

test('it counts edited cells, and reads naturally at one', async ({ page }) => {
  await open(page)

  await editCell(page, 1, 2, 'one')
  await expect(page.locator('#edits')).toBeVisible()
  await expect(page.locator('#edits-count')).toHaveText('1 edited cell')

  await editCell(page, 2, 2, 'two')
  await expect(page.locator('#edits-count')).toHaveText('2 edited cells')

  // editing the same cell again is still one edited cell
  await editCell(page, 2, 2, 'two again')
  await expect(page.locator('#edits-count')).toHaveText('2 edited cells')
})

test('the undo hint names the shortcut that works on this platform', async ({ page }) => {
  await open(page)
  await editCell(page, 1, 2, 'x')

  const title = await page.getAttribute('#revert-edits', 'title')
  const expected = process.platform === 'darwin' ? '⌘Z' : 'Ctrl+Z'
  expect(title, 'the hint must not send people to a shortcut that does nothing here')
    .toContain(expected)
})

test.describe('Revert all', () => {
  test('puts every cell back to the value the file had', async ({ page }) => {
    await open(page)
    const before = await Promise.all([
      page.locator(CELL(1, 2)).textContent(),
      page.locator(CELL(2, 3)).textContent()
    ])

    await editCell(page, 1, 2, 'CHANGED')
    await page.click(CELL(2, 3))
    await page.keyboard.press('Delete')
    await expect(page.locator('#edits-count')).toHaveText('2 edited cells')

    await page.click('#revert-edits')

    await expect(page.locator(CELL(1, 2))).toHaveText(before[0])
    await expect(page.locator(CELL(2, 3))).toHaveText(before[1])
    await expect(page.locator('#edits')).toBeHidden()
    expect(await page.locator('#handsontable-container td.is-edited').count()).toBe(0)
  })

  test('reverts to the file value, not to an intermediate edit', async ({ page }) => {
    await open(page)
    const original = await page.locator(CELL(1, 2)).textContent()

    await editCell(page, 1, 2, 'first')
    await editCell(page, 1, 2, 'second')
    await page.click('#revert-edits')

    await expect(page.locator(CELL(1, 2))).toHaveText(original)
  })

  test('reverted values are what then download', async ({ page }) => {
    await open(page)
    await editCell(page, 1, 2, 'SHOULD-NOT-SURVIVE')
    await page.click('#revert-edits')

    await page.click('#download-btn')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-export="csv"]')
    ])
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(await download.path(), 'utf8')
    expect(text).not.toContain('SHOULD-NOT-SURVIVE')
    expect(text).toContain('José')
  })
})

test('opening another file resets the indicator', async ({ page }) => {
  await open(page)
  await editCell(page, 1, 2, 'CHANGED')
  await expect(page.locator('#edits')).toBeVisible()

  await page.setInputFiles('#input-file', paths['semicolons.csv'])
  await expect(page.locator('#file-name')).toHaveText('semicolons.csv')
  await expect(page.locator('#edits')).toBeHidden()
})

test('the indicator does not break the toolbar at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  await editCell(page, 1, 2, 'CHANGED')

  await expect(page.locator('#edits')).toBeVisible()
  await expect(page.locator('#revert-edits')).toBeVisible()
  await expect(page.locator('#open-btn')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  expect(await page.evaluate(() => Math.round(document.querySelector('.toolbar').getBoundingClientRect().height))).toBe(49)
})
