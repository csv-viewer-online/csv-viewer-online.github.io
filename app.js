const input = document.getElementById('input-file')
const openBtn = document.getElementById('open-btn')
const searchInput = document.getElementById('search-input')
const fileName = document.getElementById('file-name')
const fileCount = document.getElementById('file-count')
const dropStatus = document.getElementById('drop-status')
const handsontableContainer = document.getElementById('handsontable-container')

let hot = null
let allRows = []
let fields = []
let encodingLabel = ''

const fmt = (n) => n.toLocaleString('en-US')

// The grid is ~1.6 MB and the parser is only needed once a file is chosen,
// so both are fetched on first open instead of on every page view.
const CDN = 'https://cdn.jsdelivr.net/npm/'
const DEPS = [
  { tag: 'link', url: CDN + 'handsontable@13/dist/handsontable.full.min.css' },
  { tag: 'script', url: CDN + 'handsontable@13/dist/handsontable.full.min.js' },
  { tag: 'script', url: CDN + 'papaparse@5' }
]

let depsPromise = null

function injectDep(dep) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(dep.tag)
    el.onload = resolve
    el.onerror = () => reject(new Error('could not load ' + dep.url))
    if (dep.tag === 'link') {
      el.rel = 'stylesheet'
      el.href = dep.url
    } else {
      el.src = dep.url
    }
    document.head.appendChild(el)
  })
}

function loadDeps() {
  if (!depsPromise) depsPromise = Promise.all(DEPS.map(injectDep))
  return depsPromise
}

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('could not read file'))
    reader.readAsArrayBuffer(file)
  })
}

// FileReader.readAsText assumes UTF-8, which mangles the Windows-1252 files
// Excel produces by default. Sniff the encoding instead. TextDecoder strips a
// leading BOM on its own, so nothing here has to trim one.
function decodeFile(buf) {
  const bytes = new Uint8Array(buf)
  const decode = (encoding, label) => ({ text: new TextDecoder(encoding).decode(buf), encoding: label })

  // A BOM is authoritative.
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return decode('utf-16le', 'UTF-16LE')
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return decode('utf-16be', 'UTF-16BE')
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return decode('utf-8', 'UTF-8')

  // BOM-less UTF-16 gives away its ASCII text as alternating NUL bytes: at odd
  // offsets for little-endian, even for big-endian.
  const probe = bytes.subarray(0, 512)
  let nul = 0
  let nulAtEven = 0
  for (let i = 0; i < probe.length; i++) {
    if (probe[i] !== 0) continue
    nul++
    if (i % 2 === 0) nulAtEven++
  }
  if (probe.length > 1 && nul / probe.length > 0.25) {
    return nulAtEven * 2 > nul ? decode('utf-16be', 'UTF-16BE') : decode('utf-16le', 'UTF-16LE')
  }

  // Otherwise prefer UTF-8 and fall back only when the bytes are not valid
  // UTF-8 at all, so genuine UTF-8 files are never second-guessed.
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8' }
  } catch (err) {
    return decode('windows-1252', 'Windows-1252')
  }
}

function setCount(shown) {
  const base = shown === allRows.length
    ? fmt(allRows.length) + ' rows × ' + fields.length + ' cols'
    : fmt(shown) + ' of ' + fmt(allRows.length) + ' rows'
  // Only worth naming when it is not the expected UTF-8, so a wrong guess is
  // visible rather than silent.
  fileCount.textContent = encodingLabel ? base + ' · ' + encodingLabel : base
}

function applySearch() {
  const q = searchInput.value.trim().toLowerCase()
  const rows = q
    ? allRows.filter((row) => fields.some((f) => String(row[f] ?? '').toLowerCase().includes(q)))
    : allRows

  document.body.classList.toggle('no-match', rows.length === 0)
  setCount(rows.length)
  if (hot && rows.length) hot.loadData(rows)
}

function render() {
  if (hot) hot.destroy()
  hot = new Handsontable(handsontableContainer, {
    data: allRows,
    colHeaders: fields,
    rowHeaders: true,
    columnSorting: true,
    manualColumnResize: true,
    stretchH: 'all',
    width: '100%',
    height: '100%',
    licenseKey: 'non-commercial-and-evaluation'
  })
}

async function loadFile(file) {
  if (!file) return

  document.body.classList.remove('load-error')
  document.body.classList.add('loading')
  dropStatus.textContent = 'Opening ' + file.name + '…'

  try {
    const [buf] = await Promise.all([readAsArrayBuffer(file), loadDeps()])
    const decoded = decodeFile(buf)
    const parsed = Papa.parse(decoded.text, { header: true, skipEmptyLines: true })

    allRows = parsed.data
    fields = parsed.meta.fields || []
    encodingLabel = decoded.encoding === 'UTF-8' ? '' : decoded.encoding
    searchInput.value = ''

    document.body.classList.remove('loading', 'no-match')
    document.body.classList.add('loaded')
    dropStatus.textContent = ''
    fileName.textContent = file.name
    setCount(allRows.length)

    render()
  } catch (err) {
    console.error('csv-viewer: open failed', err)
    // Let the next attempt refetch rather than reusing a rejected promise.
    depsPromise = null
    document.body.classList.remove('loading')
    document.body.classList.add('load-error')
    dropStatus.textContent = 'Could not open that file. Check your connection and try again.'
  }
}

// Click-to-browse. Clearing the value means picking the same file again
// still fires change — otherwise retrying a failed open, or reopening a
// file that changed on disk, would silently do nothing.
input.onchange = function () {
  const file = this.files[0]
  this.value = ''
  loadFile(file)
}

openBtn.onclick = function () {
  input.click()
}

searchInput.oninput = applySearch

window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== searchInput && document.body.classList.contains('loaded')) {
    e.preventDefault()
    searchInput.focus()
  }
  if (e.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = ''
    applySearch()
  }
})

// Drag-and-drop — listen on the whole window so any drop position works
let dragCounter = 0

function isFileDrag(e) {
  if (!e || !e.dataTransfer || !e.dataTransfer.types) return false
  return Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1
}

window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return
  e.preventDefault()
  dragCounter++
  document.body.classList.add('drag-over')
})

window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return
  dragCounter--
  if (dragCounter <= 0) {
    dragCounter = 0
    document.body.classList.remove('drag-over')
  }
})

window.addEventListener('dragover', (e) => {
  e.preventDefault()
})

window.addEventListener('dragend', () => {
  dragCounter = 0
  document.body.classList.remove('drag-over')
})

window.addEventListener('drop', (e) => {
  e.preventDefault()
  dragCounter = 0
  document.body.classList.remove('drag-over')
  const file = e.dataTransfer.files[0]
  if (file && file.name && file.name.toLowerCase().endsWith('.csv')) {
    loadFile(file)
  }
})
