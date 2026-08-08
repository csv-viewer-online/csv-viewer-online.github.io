# CSV Viewer &amp; Editor Online

### [csv-viewer-online.github.io](https://csv-viewer-online.github.io/)

Open a CSV file, edit it, sort and search it — in your browser. Nothing is
uploaded: the file is read straight from disk by the page you already have
open, parsed in memory, and drawn on screen. No account, nothing to delete
afterwards, and no upload request carrying your data.

## Install it

The site is a PWA, so it installs like an application and then runs with no
connection at all. Nothing to download from a store, and no account.

| Browser | How |
| --- | --- |
| **Chrome, Edge** (desktop) | Click the install icon in the address bar, or pick **Install** from the browser menu |
| **Chrome** (Android) | Menu → **Add to Home screen** |
| **Safari** (iOS, iPadOS) | Share → **Add to Home Screen** |
| **Safari** (macOS 14+) | **File** → **Add to Dock** |

Firefox has no install prompt on desktop; the site works normally in a tab
there.

Installed, it works with no network at all — the grid and parser are cached
on first launch. A browser tab deliberately does not preload them, so opening
the site in a tab stays as light as it has always been; they are still only
fetched, and cached, once a file is actually opened.

Installed on desktop Chrome or Edge, it also registers as a handler for
`.csv`, so you can open one straight from Finder or Explorer. If the OS does
not offer it, launch the installed app once first — handlers are registered on
first run.

To uninstall, open the app and use its menu → **Uninstall**, or remove it from
`chrome://apps`. Uninstalling clears its cached copy of the site.

## What it does

- **Commas, semicolons, tabs and pipes** — the separator is detected
  automatically, so European semicolon exports and tab-separated files open
  without changing a setting. A non-comma separator is named in the toolbar.
- **Encodings** — UTF-8, UTF-16 (with or without a BOM, either endianness) and
  Windows-1252, which is what Excel's default *CSV (Comma delimited)* export
  produces. A non-UTF-8 file says which encoding was detected, so a wrong guess
  is visible rather than silent.
- **Quoted fields** — values in quotes may contain commas, escaped quotes and
  line breaks.
- **Sorting, column resizing and search** — press <kbd>/</kbd> to jump to the
  search box.
- **Editing** — type into any cell.
- **Download** — save what is on screen as CSV or JSON, or copy it to the
  clipboard. The sort order, the active search filter and your edits all carry
  through, and the separator the file arrived with is preserved. Your original
  file is never touched.
- **Honest parsing** — malformed rows, files with no data rows, and files that
  are not delimited text at all are reported rather than quietly mis-rendered.

Files are opened by drag-and-drop or the file picker. `.csv`, `.tsv`, `.tab`
and `.txt` are offered in the picker, and any dropped file is attempted.

## How it is built

Plain HTML, CSS and JavaScript with **no build step**. The whole site is four
files plus static assets:

```
index.html      markup and <head>
styles.css      all styling
app.js          parsing, the grid, search, export
sw.js           service worker: caches the shell, warms vendor/ when installed
```

Two libraries do the heavy lifting, vendored into `vendor/` rather than
loaded from a CDN — pinned versions and checksums are in
[`vendor/README.md`](vendor/README.md). Vendoring means the site depends on
nothing but its own origin at runtime, which is what makes the offline
install described in [Install it](#install-it) possible:

- [PapaParse](https://github.com/mholt/PapaParse) — CSV parsing
- [Handsontable](https://github.com/handsontable/handsontable) — the grid

In a browser tab they are still **fetched on first file open rather than on
page load**. Handsontable alone is ~1.6 MB, which was 92% of the page weight
and wasted on every visit where nobody opened a file. Deferring it takes the
initial load from ~1,826 KB to ~106 KB. An installed client instead warms
both into the cache at launch, as Install it describes.

## Development

There is nothing to compile. Serve the directory and open it:

```sh
bun run serve      # http://localhost:4319
```

Any static server works — `serve.mjs` only exists so the test suite has one
with no dependencies.

### Tests

[Playwright](https://playwright.dev/) against a real browser, since most of
what could break here is browser behaviour — `FileReader` encodings,
drag-and-drop, the clipboard, grid rendering.

```sh
bun install
bunx playwright install chromium
bun run test          # 130 tests
bun run test:headed   # watch them run
bun run test:ui       # interactive
```

| Spec | Covers |
| --- | --- |
| `encoding.spec.mjs` | every supported encoding, and that valid UTF-8 is never misread |
| `input.spec.mjs` | accepted file types, and parse problems being reported |
| `export.spec.mjs` | CSV/JSON download, clipboard, filter and sort carrying through |
| `smoke.spec.mjs` | layout at three widths, lazy loading, search, head tags, static files |
| `sponsor-dialog.spec.mjs` | the enquiry dialog |
| `branding.spec.mjs` | naming, and that "CSV Viewer" stays the leading phrase |
| `edits.spec.mjs` | which cells get marked edited, clearing on undo or a matching retype, and the marker surviving sort, search and a download |
| `edits-indicator.spec.mjs` | the edit count, its undo hint and Revert all, and that a new file resets it |
| `discard-guard.spec.mjs` | confirming before the logo discards unsaved edits |
| `download-button.spec.mjs` | the green Download button's contrast, icon, accessible name and menu |
| `pwa.spec.mjs` | manifest and icons, service worker activation, the offline shell, the tab-versus-installed precache split, and OS file launches |

Fixtures are generated into a temp directory rather than committed, and the
suite asserts their bytes really are in the encoding they claim — a fixture
that silently stopped being Windows-1252 would otherwise pass while the bug
came back.

CI runs the suite on every pull request and push to `main`
(`.github/workflows/test.yml`). GitHub Pages deploys from `main`, so a merge
goes straight to production.

## Sponsors

The tiles in the sidebar are paid placements at **$19/month** — a logo and
name, shown on every visit and while a file is open. No tracking and no
popups. Click **Your ad here** on the site for details, or email
[csv-viewer-online@tianon.anonaddy.me](mailto:csv-viewer-online@tianon.anonaddy.me).

Visit counts are collected with self-hosted [Umami](https://umami.is/). It
records the page visited, never your file or its contents.
