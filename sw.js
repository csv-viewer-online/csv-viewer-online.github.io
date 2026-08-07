/* Service worker.
 *
 * Caching is split by how often a thing changes, rather than precaching
 * everything behind a version constant. The site has no build step, so a
 * cache-first worker would depend on somebody remembering to bump a constant
 * on every deploy — and forgetting once freezes every installed user on old
 * code with nothing to signal it.
 *
 *   vendor/, icons/   pinned and immutable  -> cache-first, forever
 *   html, css, js     small and frequent    -> network-first, cache fallback
 *
 * Freshness therefore comes from being online rather than from bookkeeping:
 * every successful fetch refreshes the copy that offline will fall back to.
 */

// Bumped only when vendor/ or icons/ changes — both are cached first,
// forever, so nothing else revalidates them for an existing install. The
// shell refreshes itself.
const CACHE = 'csv-viewer-v1'

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './favicon.svg',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-180.png'
]

// Not precached: 1.6 MB on every page view would undo the deferral in app.js.
// Only an installed client asks for these, via the warm-vendor message.
const VENDOR = [
  './vendor/handsontable.full.min.js',
  './vendor/handsontable.full.min.css',
  './vendor/papaparse.min.js'
]

const NETWORK_TIMEOUT = 3000

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  )
})

// No skipWaiting and no clients.claim: a new worker takes over on the next
// fresh launch rather than mid-session, so it can never reload a page holding
// unsaved edits.

// Only an installed client asks for this. Failures are swallowed on purpose:
// a warm that does not finish leaves the app exactly as capable as a browser
// tab, which is the status quo rather than a regression.
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'warm-vendor') return
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(VENDOR))
      .catch(() => {})
  )
})

const isImmutable = (url) => url.pathname.includes('/vendor/') || url.pathname.includes('/icons/')

// Key on the path alone: index.html asks for styles.css?17 but the precache
// holds styles.css, and ignoreSearch returns the FIRST match — so an
// un-normalised put would leave the stale install-time copy winning forever.
const cacheKey = (request) => {
  const url = new URL(request.url)
  return url.origin + url.pathname
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request, { ignoreSearch: true })
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) await cache.put(cacheKey(request), res.clone())
  return res
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT)
  try {
    const res = await fetch(request, { signal: controller.signal })
    clearTimeout(timer)
    if (res.ok) await cache.put(cacheKey(request), res.clone())
    return res
  } catch (err) {
    clearTimeout(timer)
    // ignoreSearch because index.html requests ./styles.css?17 and ./app.js?17
    // while the cache holds them unqueried.
    const hit = await cache.match(request, { ignoreSearch: true })
    if (hit) return hit
    throw err
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET') return
  // Cross-origin is left entirely alone, so analytics passes straight through
  // and fails harmlessly offline. Caching it would be pointless and rude.
  if (url.origin !== self.location.origin) return
  e.respondWith(isImmutable(url) ? cacheFirst(e.request) : networkFirst(e.request))
})
