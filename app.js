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

window.addEventListener('dragenter', (e) => {
  e.preventDefault()
  dragCounter++
  dropZone.classList.add('drag-over')
})

window.addEventListener('dragleave', () => {
  dragCounter--
  if (dragCounter === 0) dropZone.classList.remove('drag-over')
})

window.addEventListener('dragover', (e) => {
  e.preventDefault()
})

window.addEventListener('drop', (e) => {
  e.preventDefault()
  dragCounter = 0
  dropZone.classList.remove('drag-over')
  const file = e.dataTransfer.files[0]
  if (file && file.name.endsWith('.csv')) {
    loadFile(file)
  }
})
