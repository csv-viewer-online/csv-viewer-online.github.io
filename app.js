const input = document.getElementById('input-file')
const openBtn = document.getElementById('open-btn')
const searchInput = document.getElementById('search-input')
const fileName = document.getElementById('file-name')
const fileCount = document.getElementById('file-count')
const handsontableContainer = document.getElementById('handsontable-container')

let hot = null
let allRows = []
let fields = []

const fmt = (n) => n.toLocaleString('en-US')

function setCount(shown) {
  fileCount.textContent = shown === allRows.length
    ? fmt(allRows.length) + ' rows × ' + fields.length + ' cols'
    : fmt(shown) + ' of ' + fmt(allRows.length) + ' rows'
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

function loadFile(file) {
  if (!file) return
  const reader = new FileReader()

  reader.onload = function (e) {
    const parsed = Papa.parse(e.target.result, {
      header: true,
      skipEmptyLines: true
    })

    allRows = parsed.data
    fields = parsed.meta.fields || []
    searchInput.value = ''

    document.body.classList.add('loaded')
    document.body.classList.remove('no-match')
    fileName.textContent = file.name
    setCount(allRows.length)

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

  reader.readAsText(file)
}

// Click-to-browse
input.onchange = function () {
  loadFile(this.files[0])
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
