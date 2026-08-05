import { test, expect } from '@playwright/test'

// The drop zone is the point of the page, so it must be what you see first —
// on a plain load, and on a return visit to a URL that still carries #about.
async function firstView(page) {
  return page.evaluate(() => {
    const inView = (el) => {
      const r = el.getBoundingClientRect()
      return r.top >= 0 && r.top < window.innerHeight
    }
    return {
      hash: location.hash,
      paneScrollTop: Math.round(document.querySelector('.empty').scrollTop),
      dropZoneInView: inView(document.getElementById('drop-zone')),
      h1InView: inView(document.querySelector('h1')),
      proseInView: inView(document.querySelector('.content h2'))
    }
  })
}

test('a plain load opens on the drop zone', async ({ page }) => {
  await page.goto('/')
  expect(await firstView(page)).toMatchObject({
    hash: '', paneScrollTop: 0, dropZoneInView: true, h1InView: true
  })
})

test('the cue scrolls to the prose without putting a fragment in the URL', async ({ page }) => {
  await page.goto('/')
  await page.click('.scroll-cue')
  await page.waitForTimeout(700)

  const after = await firstView(page)
  expect(after.proseInView, 'the prose must actually be reached').toBe(true)
  // The whole cause of the bug: a fragment that outlives the visit
  expect(after.hash, 'tapping the cue must not change the URL').toBe('')
  expect(page.url()).not.toContain('#')
})

test('returning to a URL that still has #about opens on the drop zone', async ({ page }) => {
  await page.goto('/#about')
  await page.waitForTimeout(500)

  const view = await firstView(page)
  expect(view.dropZoneInView, 'a stale #about must not hijack the first view').toBe(true)
  expect(view.paneScrollTop).toBe(0)
  expect(view.hash, 'the stale fragment should be cleaned out of the URL').toBe('')
})

test('the prose is still reachable by scrolling', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => document.querySelector('.empty').scrollTo(0, 99999))
  await page.waitForTimeout(300)
  await expect(page.locator('.content h2').first()).toBeVisible()
  await expect(page.locator('#drop-zone')).not.toBeInViewport()
})
