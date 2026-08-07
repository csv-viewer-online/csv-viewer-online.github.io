import { test, expect } from '@playwright/test'
import { ensureFixtures } from './fixtures.mjs'

let paths
test.beforeAll(async () => { paths = await ensureFixtures() })

test('the manifest is served, parses, and declares what installation needs', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest')
  expect(res.status()).toBe(200)
  // Served as octet-stream the browser rejects it and the install prompt
  // never appears, with nothing in the console to say why.
  expect(res.headers()['content-type']).toContain('application/manifest+json')

  const m = JSON.parse(await res.text())
  expect(m.name).toBe('CSV Viewer & Editor Online')
  expect(m.short_name).toBe('CSV Viewer')
  expect(m.start_url).toBe('/')
  expect(m.scope).toBe('/')
  expect(m.display).toBe('standalone')
  expect(m.theme_color).toBe('#126BCF')
  expect(m.background_color).toBe('#126BCF')

  expect(m.icons).toHaveLength(3)
  expect(m.icons.some((i) => i.purpose === 'maskable'), 'Android needs a maskable icon').toBe(true)
  expect(m.file_handlers[0].accept['text/csv']).toContain('.csv')
})

test('every icon the manifest declares is served at the size it claims', async ({ page }) => {
  await page.goto('/')
  const declared = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href
    return (await (await fetch(href)).json()).icons.map((i) => ({ src: i.src, sizes: i.sizes }))
  })
  expect(declared.length).toBe(3)

  for (const icon of declared) {
    // A manifest that names a missing icon still parses, so the install
    // prompt appears and the icon silently falls back to a screenshot.
    const real = await page.evaluate(async (src) => {
      const res = await fetch(src)
      if (!res.ok) return `HTTP ${res.status}`
      const bmp = await createImageBitmap(await res.blob())
      return `${bmp.width}x${bmp.height}`
    }, icon.src)
    expect(real, `${icon.src} must exist at ${icon.sizes}`).toBe(icon.sizes)
  }
})

test('the head links the manifest, theme colour and apple touch icon', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/manifest.webmanifest')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#126BCF')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-180.png')
})

test('the service worker reaches activated', async ({ page }) => {
  await page.goto('/')
  // Asserting registration is not enough: if any SHELL entry 404s, install
  // rejects, the worker never activates, and the site keeps working online
  // with no offline support and no visible error.
  const state = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    // `ready` resolves once `active` is set, which happens at the start of
    // the activate step (state "activating") — before the activate event's
    // waitUntil settles into "activated". Wait for the real transition
    // instead of racing it with a bare read.
    if (reg.active.state === 'activated') return reg.active.state
    return new Promise((resolve) => {
      reg.active.addEventListener('statechange', function onChange() {
        if (reg.active.state === 'activated') {
          reg.active.removeEventListener('statechange', onChange)
          resolve(reg.active.state)
        }
      })
    })
  })
  expect(state).toBe('activated')
})

test('the shell still loads with the network off', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  // Without clients.claim the worker does not control the page that
  // registered it, so offline only works from the second load.
  await page.reload()

  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('#drop-zone')).toBeVisible()
  await context.setOffline(false)
})

test('the version-queried css and js resolve from cache offline', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()

  await context.setOffline(true)
  await page.reload()

  // index.html asks for ./styles.css?N but the cache holds ./styles.css.
  // Without ignoreSearch this misses, and the page renders unstyled offline
  // while looking perfectly fine online.
  const applied = await page.evaluate(() => ({
    sheets: document.styleSheets.length,
    rows: getComputedStyle(document.body).gridTemplateRows
  }))
  expect(applied.sheets, 'styles.css must have resolved from cache').toBeGreaterThan(0)
  expect(applied.rows, 'the body grid from styles.css must be in effect').not.toBe('none')
  await context.setOffline(false)
})

test('a refreshed shell asset replaces the stale offline copy, not just the online response', async ({
  page,
  context
}) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  // Without clients.claim the worker does not control the page that
  // registered it, so the interception below only takes effect from the
  // second load.
  await page.reload()

  // Stand in for a real deploy that changes styles.css without touching
  // sw.js. context.route (not page.route) is required: this request is made
  // by the service worker's own fetch() call during networkFirst, not by the
  // page, so page.route never observes it.
  await context.route('**/styles.css*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/css; charset=utf-8',
      body: 'body { background-color: rgb(1, 2, 3); }'
    })
  )

  // Online reload: networkFirst fetches the new bytes and must refresh the
  // single cache entry for styles.css, not add a second one alongside the
  // install-time copy from addAll.
  await page.reload()
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(1, 2, 3)')
  await context.unroute('**/styles.css*')

  // Offline reload: the cache must now serve the NEW bytes. If cache.put had
  // keyed on the queried request (./styles.css?N) instead of the bare path,
  // two entries would exist and ignoreSearch's first match — the stale
  // install-time one — would win forever.
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(1, 2, 3)')
  await context.setOffline(false)
})

test('a browser tab does not precache the grid', async ({ page, context }) => {
  // The whole reason vendor/ is not in SHELL. If this fails, the change has
  // silently reversed the 1.6 MB deferral that app.js exists to provide.
  const requested = []
  // context, not page: page.on('request') is blind to service-worker-initiated
  // fetches, so the precache this test exists to catch would go unseen. Verified
  // by putting vendor/ into SHELL — the page-scoped listener still reported clean.
  context.on('request', (r) => requested.push(r.url()))

  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForLoadState('networkidle')

  expect(requested.some((u) => /handsontable/.test(u)), 'a tab must not warm the grid').toBe(false)
})

test('after warming, an installed client opens a file with the network off', async ({ page, context }) => {
  await page.goto('/')

  // display-mode: standalone cannot be faked reliably in Playwright, so the
  // message the installed branch sends is posted directly. The branch itself
  // is covered by the tab test above.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    reg.active.postMessage({ type: 'warm-vendor' })
  })

  // Not page.waitForFunction: it evaluates an async predicate but ignores
  // its resolved value, resolving as soon as the returned promise settles
  // regardless of whether that value is truthy. expect.poll re-runs
  // page.evaluate (which genuinely awaits) from the Node side instead, so
  // this actually gates on the cache entry existing.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const c = await caches.open('csv-viewer-v1')
          return !!(await c.match('./vendor/handsontable.full.min.js', { ignoreSearch: true }))
        }),
      { timeout: 30_000 }
    )
    .toBe(true)

  await page.reload()
  await context.setOffline(true)
  await page.reload()

  await page.setInputFiles('#input-file', paths['plain.csv'])
  await expect(page.locator('body')).toHaveClass(/loaded/)
  await expect(page.locator('#handsontable-container .ht_master tbody tr')).toHaveCount(3)

  await context.setOffline(false)
})

test('a file handed over by the OS launch queue is opened', async ({ page }) => {
  // launchQueue only exists when the OS actually launched the app. Rather than
  // exposing the consumer for tests, stand up a stub before load so app.js's
  // real feature-detect branch runs and registers against it — the
  // registration path is then covered too, not bypassed.
  //
  // Object.defineProperty, not a plain assignment: modern Chromium exposes
  // window.launchQueue as a readonly (getter-only) property on every page,
  // installed or not. A plain `window.launchQueue = {...}` silently no-ops
  // against an accessor with no setter, so the real (inert) LaunchQueue would
  // still be what app.js registers against, and __fire would never be set.
  // The property is configurable, so defineProperty can still replace it.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'launchQueue', {
      value: { setConsumer: (fn) => { window.__fire = fn } },
      configurable: true,
      writable: true
    })
  })
  await page.goto('/')

  await page.evaluate(async () => {
    const csv = 'name,city\nAcme,Berlin\nGlobex,Tokyo\n'
    const handle = { getFile: async () => new File([csv], 'launched.csv', { type: 'text/csv' }) }
    await window.__fire({ files: [handle] })
  })

  await expect(page.locator('body')).toHaveClass(/loaded/)
  await expect(page.locator('#file-name')).toHaveText('launched.csv')
  await expect(page.locator('#handsontable-container .ht_master tbody tr')).toHaveCount(2)
})

test('the page still works where launchQueue does not exist', async ({ page }) => {
  // Chromium always has launchQueue, so the absent-API branch — Firefox and
  // Safari — is only reachable by removing it. Without this the test would
  // pass with the feature detection deleted entirely.
  await page.addInitScript(() => { delete window.launchQueue })

  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')

  await expect(page.locator('#drop-zone')).toBeVisible()
  expect(errors).toEqual([])
})

test('a multi-file OS launch opens the first file and shows the notice', async ({ page }) => {
  // Mirrors the drop handler's own multi-file case: the launch path is not
  // allowed to be the one silent entry point when extra files are handed
  // over that cannot be shown.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'launchQueue', {
      value: { setConsumer: (fn) => { window.__fire = fn } },
      configurable: true,
      writable: true
    })
  })
  await page.goto('/')

  await page.evaluate(async () => {
    const csv = 'name,city\nAcme,Berlin\n'
    const first = { getFile: async () => new File([csv], 'first.csv', { type: 'text/csv' }) }
    const second = { getFile: async () => new File([csv], 'second.csv', { type: 'text/csv' }) }
    await window.__fire({ files: [first, second] })
  })

  await expect(page.locator('body')).toHaveClass(/loaded/)
  await expect(page.locator('#file-name')).toHaveText('first.csv')
  await expect(page.locator('#notice-text')).toHaveText('Opened first.csv. Only one file can be viewed at a time.')
})

test('a rejecting getFile() from the OS launch surfaces an error, not silence', async ({ page }) => {
  // If the launched file was moved, deleted, or its permission was revoked
  // between the OS launch and consumption, getFile() rejects. openLaunchedFiles
  // is invoked by the native LaunchQueue, which attaches no rejection handler
  // of its own, so an uncaught rejection here would leave the user staring at
  // an unchanged page with no sign the double-click did anything.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'launchQueue', {
      value: { setConsumer: (fn) => { window.__fire = fn } },
      configurable: true,
      writable: true
    })
  })
  await page.goto('/')

  await page.evaluate(async () => {
    const handle = { getFile: async () => { throw new Error('file not found') } }
    await window.__fire({ files: [handle] })
  })

  await expect(page.locator('body')).toHaveClass(/load-error/)
  await expect(page.locator('#drop-status')).toHaveText('Could not open that file. It may have been moved or deleted.')
})

test('a rejecting getFile() from the OS launch is still visible when a file is already open', async ({ page }) => {
  // The previous test only covers the empty state, where #drop-status lives
  // in the visible .empty block. Once a file is already open, body carries
  // the loaded class and styles.css hides .empty (and #drop-status with it),
  // so writing the error there again is silent: a second OS launch that
  // fails looks exactly like nothing happened. The fix routes this case
  // through showNotice, which is not inside .empty.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'launchQueue', {
      value: { setConsumer: (fn) => { window.__fire = fn } },
      configurable: true,
      writable: true
    })
  })
  await page.goto('/')

  await page.setInputFiles('#input-file', paths['plain.csv'])
  await expect(page.locator('body')).toHaveClass(/loaded/)

  await page.evaluate(async () => {
    const handle = { getFile: async () => { throw new Error('file not found') } }
    await window.__fire({ files: [handle] })
  })

  // The user's already-open data must not be thrown away by the failed launch.
  await expect(page.locator('body')).toHaveClass(/loaded/)
  await expect(page.locator('#notice')).toBeVisible()
  await expect(page.locator('#notice-text')).toHaveText('Could not open that file. It may have been moved or deleted.')
})
