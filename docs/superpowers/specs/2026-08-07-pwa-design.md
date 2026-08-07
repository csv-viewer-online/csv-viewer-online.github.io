# Make the site an installable, offline-capable PWA

Date: 2026-08-07

## Goal

Turn csv-viewer-online.github.io into a Progressive Web App that installs to the
home screen or desktop, works completely offline, and can be registered with the
OS as a handler for `.csv` files.

"Completely offline" is the requirement that drives everything else: opening,
editing, sorting, searching and downloading a CSV must all work with no network,
on a machine that has never opened a file online.

## Current state

The site is plain HTML/CSS/JS with no build step — an explicit project value
recorded in `package.json`. All state lives in memory; there is no
`localStorage`, `sessionStorage` or `IndexedDB` anywhere in `app.js`.

The blocker for offline is `app.js:79`. Handsontable (~1.6 MB) and PapaParse are
injected from `cdn.jsdelivr.net` the first time a file is opened. Offline, that
fetch fails and the grid never renders.

Handsontable runs under its free non-commercial licence
(`licenseKey: 'non-commercial-and-evaluation'`, `app.js:259`).

## Decisions

| Decision | Choice |
|---|---|
| Offline scope | Fully functional offline, including a first-ever file open |
| Third-party deps | Vendored into the repo, not runtime-cached from the CDN |
| Update model | New version activates on next launch, silently |
| Caching strategy | Split by mutability (see below) |
| Optional capability | OS file handling for `.csv`; no share target, no shortcuts |
| Icons | Generated from `favicon.svg`, with a padded maskable variant |

### Why vendoring rather than caching the CDN

Runtime-caching jsdelivr only works offline *after* the user has opened a file
while online. Precaching 1.6 MB cross-origin at install is slow and fails
silently when jsdelivr is unreachable. Vendoring makes the first offline open
work, removes a third-party runtime dependency, and matches the site's "nothing
leaves your device" claim. The cost is ~1.6 MB in git and a manual bump to
update.

### Why split caching rather than a version constant

Every service worker tutorial assumes a build tool stamping content hashes. With
no build step, a cache-first worker depends on a human remembering to bump a
constant every deploy. Forgetting once freezes every installed user on old code,
silently.

Splitting by mutability removes the bookkeeping:

- `vendor/` and `icons/` are pinned and immutable — **cache-first, forever**.
- `index.html`, `app.js`, `styles.css` total ~56 KB and change often —
  **network-first with cache fallback**, refreshing the cache on every success.

Offline still works: every network-first fetch falls back to cache. But the
offline copy self-refreshes whenever the user is online, so freshness comes from
being online rather than from remembering to bump something.

The cost is a bounded wait on the network for ~56 KB on a cold start over a bad
connection. A 3s timeout caps it.

## Architecture

### New files

```
manifest.webmanifest
sw.js                            root — a worker's scope is capped at its own directory
vendor/
  handsontable.full.min.js       ~1.4 MB, pinned v13
  handsontable.full.min.css      ~0.2 MB
  papaparse.min.js               ~20 KB, pinned v5
  README.md                      resolved versions + SHA-256 of each file
icons/
  icon-192.png
  icon-512.png
  icon-512-maskable.png
  apple-touch-180.png
tools/make-icons.mjs             Playwright rasterizer, run by hand
tests/pwa.spec.mjs
```

### Modified files

| File | Change |
|---|---|
| `index.html` | Add manifest link, `theme-color`, `apple-touch-icon`; register the SW inline; remove the jsdelivr `preconnect` (line 40) and its now-false comment |
| `app.js` | `CDN` → local `VENDOR` path (line 79); add a `launchQueue` consumer |
| `tests/serve.mjs` | Add `.webmanifest` → `application/manifest+json` |

### Registration

Registration goes in an inline script in `index.html`, guarded by
`'serviceWorker' in navigator` — not in `app.js`. It should not wait on
`app.js?17` to parse, and keeping it inline means the version query on `app.js`
can never affect whether the worker registers.

## Service worker

### Lifecycle

No `skipWaiting`, no `clients.claim`.

```
install  → precache everything, then wait
activate → delete caches whose name differs from the current one, then take over
```

A new worker downloads quietly and takes control on the next fresh launch. It
never reloads a live page, so it cannot interact with the unsaved-edits guard
added in #50. This is why auto-reload was rejected.

### Precache list

Exact, since a single wrong entry fails the whole install:

```
./                                     navigation fallback
./index.html
./styles.css
./app.js
./favicon.svg
./manifest.webmanifest
./vendor/handsontable.full.min.js
./vendor/handsontable.full.min.css
./vendor/papaparse.min.js
./icons/icon-192.png
./icons/icon-512.png
./icons/icon-512-maskable.png
./icons/apple-touch-180.png
```

Entries are stored without the `?17` query that `index.html` uses, which is why
every lookup needs `ignoreSearch` (see Edge cases).

### Routing

```
vendor/, icons/          cache-first → on miss, fetch and cache
html, css, js, navigate  network-first (3s timeout)
                           → on success, refresh cache, return
                           → on failure or timeout, serve from cache
cross-origin             not intercepted at all — no respondWith
```

Analytics (`analytics.limonte.dev`) is cross-origin, so it passes straight
through and fails harmlessly offline. It is deliberately never cached.

Only same-origin `GET` requests with `response.ok` are written to the cache.

### `CACHE` version constant

Bumped only when `vendor/` changes, since the app shell self-refreshes. One
constant with one reason to change, documented in a comment above it.

## Edge cases

**The query-string trap.** `index.html` requests `./styles.css?17` and
`./app.js?17`, but the precache list holds `./styles.css`. A plain
`cache.match()` misses, so the worker appears to work online and fails only
offline. All cache lookups use `{ ignoreSearch: true }`. This has a dedicated
test.

**First visit has no offline.** Without `clients.claim`, the worker does not
control the page that registered it. Offline works from the second load. The
offline test must load the page twice.

**A failed install is silent.** If any precache entry 404s, `install` rejects
and the worker never activates; the site keeps working online with no offline
support and no visible error. The test asserts the worker reaches `activated`,
not merely that it registered.

**Quota.** ~1.6 MB total. Not a concern; no cache-size management.

## File handling

```json
"file_handlers": [
  { "action": "/", "accept": { "text/csv": [".csv"] } }
]
```

Consumer in `app.js`, feature-detected. A launch handle is a
`FileSystemFileHandle`, not a `File`, so it needs `getFile()`. The existing
entry point is `loadFile(file, notice)`, which takes a `File`:

```js
if ('launchQueue' in window) {
  launchQueue.setConsumer(async ({ files }) => {
    if (files.length) loadFile(await files[0].getFile())
  })
}
```

Chromium desktop only. Feature detection makes it inert elsewhere.

### Unsaved edits on launch: match existing behaviour

The discard confirmation from #50 is wired **only** to the wordmark link
(`app.js:490`). Both other entry points replace the open file with no
confirmation:

- `app.js:471` — `input.onchange` calls `loadFile(file)` directly
- `app.js:559` — the drop handler calls `loadFile(files[0], …)` directly

So the launch consumer does **not** confirm either. Adding a guard to only the
new path would make OS-launch stricter than drag-and-drop, which is an
inconsistent behaviour change smuggled into a PWA task.

**Follow-up, out of scope:** dropping or browsing to a new file silently
discards unsaved edits. That gap predates this work and should be fixed across
all three entry points at once, in its own change.

## Icons

`tools/make-icons.mjs` loads `favicon.svg` in Playwright's Chromium at each size
and screenshots it.

| File | Size | Purpose |
|---|---|---|
| `icon-192.png` | 192 | any |
| `icon-512.png` | 512 | any |
| `icon-512-maskable.png` | 512 | maskable — same art inset to ~62% |
| `apple-touch-180.png` | 180 | iOS home screen |

The maskable variant needs the inset because Android crops to a safe zone and
the white table in the current mark runs close to the edges.

`theme_color` and `background_color` are `#126BCF`, taken from `favicon.svg`, so
the splash screen matches the mark rather than introducing a second blue.

The script is not wired into CI. It runs when the mark changes, which is
approximately never; adding it to `test.yml` would mean installing Playwright
browsers to regenerate four PNGs that are already committed. It exists for
reproducibility, not automation.

## Vendored file provenance

The vendored files are fetched from jsdelivr at the versions currently pinned in
`app.js` (`handsontable@13`, `papaparse@5`). `vendor/README.md` records the
resolved exact versions and the SHA-256 of each file, so a future bump is a
diffable, checkable operation rather than an opaque blob swap.

## Testing

`tests/pwa.spec.mjs`, five tests, each targeting a specific failure mode:

| Test | Catches |
|---|---|
| Manifest parses; required fields and three icons present | Typos, missing icon files |
| Worker reaches `activated` | A 404 in the precache list |
| Reload twice, go offline, page still loads | Broken offline shell |
| Offline, open a CSV, grid renders | Vendored deps unreachable offline |
| Offline load with `?17` on css/js | The `ignoreSearch` trap |

The fourth is the one that would have caught the original CDN problem, and is
the test that matters most.

`tests/serve.mjs` must serve `.webmanifest` as `application/manifest+json`;
without it the manifest is `application/octet-stream` and the browser rejects
it, failing tests confusingly.

## Out of scope

No offline fallback page, no "you are offline" banner, no background sync, no
cache-size management, no share target, no manifest shortcuts. The app precaches
1.6 MB and genuinely works offline — there is nothing for a fallback page to
say.

## Success criteria

1. Chrome and Edge offer to install the site.
2. With the network disabled, a fresh launch opens, loads a CSV, renders the
   grid, sorts, searches, edits and downloads.
3. That works on a profile that has never opened a file while online.
4. `bun run test` passes, including the five new tests.
5. No request to `cdn.jsdelivr.net` is made at any point.
6. A deploy reaches an installed client on its next fresh launch, with no
   version constant bumped by hand.
