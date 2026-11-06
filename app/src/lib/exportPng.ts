/** Downloads the chart on the current screen as a PNG, at twice its size on screen. */
export async function exportChartPng(fileName: string): Promise<boolean> {
  const svg = document.querySelector<SVGSVGElement>('svg[data-export-chart]')
  if (!svg) return false

  const width = svg.width.baseVal.value
  const height = svg.height.baseVal.value
  const source = new XMLSerializer().serializeToString(svg)
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()

    const canvas = document.createElement('canvas')
    canvas.width = width * 2
    canvas.height = height * 2
    const context = canvas.getContext('2d')
    if (!context) return false
    context.fillStyle = '#FFFFFF'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.scale(2, 2)
    context.drawImage(image, 0, 0, width, height)

    const link = document.createElement('a')
    link.href = canvas.toDataURL('image/png')
    link.download = fileName
    link.click()
    return true
  } finally {
    URL.revokeObjectURL(url)
  }
}
