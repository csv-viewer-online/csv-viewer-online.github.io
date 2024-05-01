const input = document.getElementById('input-file')
const handsontableContainer = document.getElementById('handsontable-container')

input.onchange = function () {
  const file = this.files[0]
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
    document.querySelector('input').remove()
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

  file && reader.readAsText(file)
}
