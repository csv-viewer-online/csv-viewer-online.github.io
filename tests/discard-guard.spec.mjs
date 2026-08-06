import { test, expect } from '@playwright/test'
import { ensureFixtures } from './fixtures.mjs'

let paths
test.beforeAll(async () => { paths = await ensureFixtures() })

const CELL = (row, col) =>
  `#handsontable-container .ht_master tbody tr:nth-child(${row}) td:nth-child(${col})`

async function open(page) {
  await page.goto('/')
  await page.setInputFiles('#input-file', paths['plain.csv'])
  await expect(page.locator('body')).toHaveClass(/loaded/)
  await expect(page.locator(CELL(1, 2))).toBeVisible()
}

async function editCell(page, row, col, value) {
  await page.dblclick(CELL(row, col))
  await page.fill('.handsontableInput', value)
  await page.keyboard.press('Enter')
}

const dialog = (page) => page.locator('#discard-dialog')

test('with nothing edited, the logo just goes home', async ({ page }) => {
  await open(page)
  await page.click('a.mark')

  // No prompt for work that does not exist
  await expect(dialog(page)).toBeHidden()
  await expect(page.locator('#drop-zone')).toBeVisible()
  await expect(page.locator('body')).not.toHaveClass(/loaded/)
})

test('with edits, it asks first and does not navigate', async ({ page }) => {
  await open(page)
  await editCell(page, 1, 2, 'CHANGED')
  await page.click('a.mark')

  await expect(dialog(page)).toBeVisible()
  // Still on the file — nothing has been thrown away yet
  await expect(page.locator('body')).toHaveClass(/loaded/)
  await expect(page.locator(CELL(1, 2))).toHaveText('CHANGED')
})

test('the prompt says how much is at stake', async ({ page }) => {
  await open(page)
  await editCell(page, 1, 2, 'one')
  await page.click('a.mark')
  await expect(page.locator('#discard-count')).toHaveText('1 edited cell')

  await page.click('#discard-cancel')
  await editCell(page, 2, 2, 'two')
  await page.click('a.mark')
  await expect(page.locator('#discard-count')).toHaveText('2 edited cells')
})

test.describe('choosing', () => {
  test('"Keep editing" returns you to your work untouched', async ({ page }) => {
    await open(page)
    await editCell(page, 1, 2, 'CHANGED')
    await page.click('a.mark')
    await page.click('#discard-cancel')

    await expect(dialog(page)).toBeHidden()
    await expect(page.locator('body')).toHaveClass(/loaded/)
    await expect(page.locator(CELL(1, 2))).toHaveText('CHANGED')
    await expect(page.locator('#edits-count')).toHaveText('1 edited cell')
  })

  test('Escape also means keep editing', async ({ page }) => {
    await open(page)
    await editCell(page, 1, 2, 'CHANGED')
    await page.click('a.mark')
    await page.keyboard.press('Escape')

    await expect(dialog(page)).toBeHidden()
    await expect(page.locator(CELL(1, 2))).toHaveText('CHANGED')
  })

  test('"Discard and start over" actually starts over', async ({ page }) => {
    await open(page)
    await editCell(page, 1, 2, 'CHANGED')
    await page.click('a.mark')
    await page.click('#discard-confirm')

    await expect(page.locator('#drop-zone')).toBeVisible()
    await expect(page.locator('body')).not.toHaveClass(/loaded/)
    await expect(page.locator('#edits')).toBeHidden()
  })
})

test('reverting removes the reason to warn', async ({ page }) => {
  await open(page)
  await editCell(page, 1, 2, 'CHANGED')
  await page.click('#revert-edits')
  await expect(page.locator('#edits')).toBeHidden()

  await page.click('a.mark')
  await expect(dialog(page), 'nothing is unsaved, so no prompt').toBeHidden()
  await expect(page.locator('#drop-zone')).toBeVisible()
})
