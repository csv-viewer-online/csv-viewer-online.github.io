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

// addAll always goes to the network — a worker's own fetches do not re-enter
// its fetch handler, so nothing consults the cache on its behalf. Without this
// check every launch would refetch 1.6 MB on a feature whose whole point is
// not spending it. Still addAll rather than individual puts, for the subset
// that is missing: it is atomic, so a warm cut short cannot leave the grid
// half-cached.
async function warmVendor() {
  const cache = await caches.open(CACHE)
  const missing = []
  for (const url of VENDOR) {
    if (!(await cache.match(url, { ignoreSearch: true }))) missing.push(url)
  }
  if (missing.length) await cache.addAll(missing)
}

// Only an installed client asks for this. Failures are swallowed on purpose:
// a warm that does not finish leaves the app exactly as capable as a browser
// tab, which is the status quo rather than a regression.
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'warm-vendor') return
  e.waitUntil(warmVendor().catch(() => {}))
})

const isImmutable = (url) => url.pathname.includes('/vendor/') || url.pathname.includes('/icons/')

// Key on the path alone: index.html asks for styles.css?N but the precache
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
  // Looked up before the fetch rather than in the catch, because whether a
  // usable fallback exists is what decides if it is safe to put a deadline on
  // the network at all. ignoreSearch because index.html requests
  // ./styles.css?N and ./app.js?N while the cache holds them unqueried.
  const cached = await cache.match(request, { ignoreSearch: true })

  const controller = new AbortController()
  // Race the network only when there is something to fall back to. Anything
  // same-origin and not precached comes through here on its first request —
  // og.png, a sponsor logo — and aborting those at 3s would turn a slow load
  // into a broken image, where before this worker existed they merely arrived
  // late. With a copy in hand the deadline is worth it; without one it is
  // strictly worse than waiting.
  const timer = cached ? setTimeout(() => controller.abort(), NETWORK_TIMEOUT) : null

  try {
    const res = await fetch(request, cached ? { signal: controller.signal } : undefined)
    if (timer) clearTimeout(timer)
    if (res.ok) {
      await cache.put(cacheKey(request), res.clone())
      return res
    }
    // A 5xx, or a 404 caught mid-deploy, would otherwise be handed to the page
    // as its own stylesheet or script and break it — while a copy known to
    // work sits in the cache. With nothing cached there is nothing better to
    // offer, so the real response goes through and the browser reports it.
    return cached || res
  } catch (err) {
    if (timer) clearTimeout(timer)
    if (cached) return cached
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
