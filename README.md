# CSV Viewer &amp; Editor Online

### [csv-viewer-online.github.io](https://csv-viewer-online.github.io/)

Open a CSV file, edit it, sort and search it — in your browser. Nothing is
uploaded: the file is read straight from disk by the page you already have
open, parsed in memory, and drawn on screen. No account, nothing to delete
afterwards, and no upload request carrying your data.

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

Plain HTML, CSS and JavaScript with **no build step**. The whole site is three
files plus static assets:

```
index.html      markup and <head>
styles.css      all styling
app.js          parsing, the grid, search, export
```

Two libraries do the heavy lifting, both loaded from a CDN:

- [PapaParse](https://github.com/mholt/PapaParse) — CSV parsing
- [Handsontable](https://github.com/handsontable/handsontable) — the grid

They are **fetched on first file open rather than on page load**. Handsontable
alone is ~1.6 MB, which was 92% of the page weight and wasted on every visit
where nobody opened a file. Deferring it takes the initial load from ~1,826 KB
to ~106 KB.

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
bun run test          # 85 tests
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
