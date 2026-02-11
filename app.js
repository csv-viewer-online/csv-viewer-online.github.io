const input = document.getElementById('input-file')
const dropZone = document.getElementById('drop-zone')
const handsontableContainer = document.getElementById('handsontable-container')

function loadFile(file) {
  if (!file) return
  const reader = new FileReader()

  reader.onload = function (e) {
    const csv = e.target.result
    const data = Papa.parse(csv, {
      header: true,
      skipEmptyLines: true
    })

    // reset container
    handsontableContainer.innerHTML = ''
    handsontableContainer.className = ''
    dropZone.remove()
    document.querySelector('.sponsors').remove()

    Handsontable(handsontableContainer, {
      data: data.data,
      rowHeaders: true,
      colHeaders: data.meta.fields,
      columnSorting: true,
      width: '100%',
      licenseKey: 'non-commercial-and-evaluation',
    })
  }

  reader.readAsText(file)
}

// Click-to-browse
input.onchange = function () {
  loadFile(this.files[0])
}

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
  dropZone.classList.add('drag-over')
})

window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return
  dragCounter--
  if (dragCounter === 0) dropZone.classList.remove('drag-over')
  if (dragCounter <= 0) {
    dragCounter = 0
    dropZone.classList.remove('drag-over')
  }
})

window.addEventListener('dragover', (e) => {
  e.preventDefault()
})

window.addEventListener('dragend', () => {
  dragCounter = 0
  dropZone.classList.remove('drag-over')
})
window.addEventListener('drop', (e) => {
  e.preventDefault()
  dragCounter = 0
  dropZone.classList.remove('drag-over')
  const file = e.dataTransfer.files[0]
  if (file && file.name && file.name.toLowerCase().endsWith('.csv')) {
    loadFile(file)
  }
})
