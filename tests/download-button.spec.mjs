import { test, expect } from '@playwright/test'
import { ensureFixtures } from './fixtures.mjs'

let paths
test.beforeAll(async () => { paths = await ensureFixtures() })

async function open(page) {
  await page.goto('/')
  await page.setInputFiles('#input-file', paths['plain.csv'])
  await expect(page.locator('body')).toHaveClass(/loaded/)
}

/** WCAG relative luminance, for a real contrast check rather than eyeballing. */
const CONTRAST = `(bg, fg) => {
  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/\\d+/g).slice(0, 3).map(Number).map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const a = lum(bg), b2 = lum(fg)
  return (Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05)
}`

test('it stands out from Open file rather than matching it', async ({ page }) => {
  await open(page)
  const colours = await page.evaluate(() => ({
    download: getComputedStyle(document.getElementById('download-btn')).backgroundColor,
    open: getComputedStyle(document.getElementById('open-btn')).backgroundColor
  }))
  expect(colours.download).not.toBe(colours.open)

  // green: more green than red or blue
  const [r, g, b] = colours.download.match(/\d+/g).slice(0, 3).map(Number)
  expect(g, 'the download button should read as green').toBeGreaterThan(r)
  expect(g).toBeGreaterThan(b)
})

test('its label is readable on that green', async ({ page }) => {
  await open(page)
  const ratio = await page.evaluate((fn) => {
    const el = document.getElementById('download-btn')
    const s = getComputedStyle(el)
    return eval(`(${fn})`)(s.backgroundColor, s.color)
  }, CONTRAST)
  expect(ratio, `contrast was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
})

test('it carries a download icon', async ({ page }) => {
  await open(page)
  const icon = page.locator('#download-btn svg')
  await expect(icon).toBeVisible()
  const box = await icon.boundingBox()
  expect(box.width).toBeGreaterThan(8)
})

test('it keeps an accessible name even where the text is hidden', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await open(page)
    // the word is hidden below 820px, so the icon must not be a nameless button
    await expect(page.locator('#download-btn')).toHaveAccessibleName('Download')
  }
})

test('it still opens the menu, and the menu still works', async ({ page }) => {
  await open(page)
  await page.click('#download-btn')
  await expect(page.locator('#download-menu')).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-export="csv"]')
  ])
  expect(download.suggestedFilename()).toBe('plain-export.csv')
})

test('the wider button does not break the toolbar at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)

  await expect(page.locator('#download-btn')).toBeVisible()
  await expect(page.locator('#open-btn')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  expect(await page.evaluate(() => Math.round(document.querySelector('.toolbar').getBoundingClientRect().height))).toBe(49)
})
