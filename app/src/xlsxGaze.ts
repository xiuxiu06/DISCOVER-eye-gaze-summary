/**
 * Lightweight browser/Node reader for Excel (.xlsx / .xlsm) gaze exports using
 * built-in DecompressionStream('deflate-raw') with zero external dependencies.
 */

const GAZE_HEADER_ALIASES: Record<string, string> = {
  userid: 'user_id',
  user: 'user_id',
  sessionid: 'session_id',
  session: 'session_id',
  objectid: 'object_id',
  object: 'object_id',
  gazetime: 'gaze_time',
  duration: 'gaze_time',
  timestamp: 'time_stamp',
  time: 'time_stamp',
}

export function isSpreadsheetExcelFile(fileName: string): boolean {
  return /\.(xlsx|xlsm)$/i.test(fileName)
}

function decodeXmlEntities(raw: string): string {
  if (!raw.includes('&')) return raw
  return raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function columnLettersToIndex(letters: string): number {
  let index = 0
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64)
  }
  return index - 1
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function maybeFormatExcelTimestamp(value: string): string {
  const trimmed = value.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return trimmed
  const serial = Number(trimmed)
  // Excel 1900 serial dates between ~1982 and ~2119
  if (!Number.isFinite(serial) || serial < 30000 || serial > 80000) return trimmed
  const epochSeconds = Math.round((serial - 25569) * 86400)
  return new Date(epochSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

interface ZipEntryInfo {
  method: number
  compressedSize: number
  localHeaderOffset: number
}

function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntryInfo> {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('This file is not a valid Excel (.xlsx) workbook.')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minOffset = Math.max(0, bytes.length - 65557)
  let eocd = -1
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd === -1) {
    throw new Error('Could not read Excel (.xlsx) central directory.')
  }

  const totalEntries = view.getUint16(eocd + 10, true)
  let pos = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder('utf-8')
  const entries = new Map<string, ZipEntryInfo>()

  for (let idx = 0; idx < totalEntries && pos + 46 <= bytes.length; idx++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break
    const method = view.getUint16(pos + 10, true)
    const compressedSize = view.getUint32(pos + 20, true)
    const nameLen = view.getUint16(pos + 28, true)
    const extraLen = view.getUint16(pos + 30, true)
    const commentLen = view.getUint16(pos + 32, true)
    const localHeaderOffset = view.getUint32(pos + 42, true)
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen))
    entries.set(name, { method, compressedSize, localHeaderOffset })
    pos += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function extractZipText(bytes: Uint8Array, entry: ZipEntryInfo): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const offset = entry.localHeaderOffset
  if (offset + 30 > bytes.length || view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error('Corrupted worksheet entry in Excel (.xlsx) file.')
  }
  const nameLen = view.getUint16(offset + 26, true)
  const extraLen = view.getUint16(offset + 28, true)
  const start = offset + 30 + nameLen + extraLen
  const rawSlice = bytes.subarray(start, start + entry.compressedSize)

  if (entry.method === 0) {
    return new TextDecoder('utf-8').decode(rawSlice)
  }
  if (entry.method === 8) {
    const copy = new Uint8Array(rawSlice.byteLength)
    copy.set(rawSlice)
    const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return await new Response(stream).text()
  }
  throw new Error(`Unsupported Excel compression method (${entry.method}). Save the file as CSV or standard .xlsx.`)
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = []
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let siMatch: RegExpExecArray | null
  while ((siMatch = siRegex.exec(xml)) !== null) {
    const inner = siMatch[1]
    const parts: string[] = []
    const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
    let tMatch: RegExpExecArray | null
    while ((tMatch = tRegex.exec(inner)) !== null) {
      parts.push(decodeXmlEntities(tMatch[1]))
    }
    strings.push(parts.join(''))
  }
  return strings
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = []
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowXml = rowMatch[1]
    const rowCells: string[] = []
    let nextCol = 0
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      const attrs = cellMatch[1]
      const body = cellMatch[2] ?? ''
      const refMatch = /\br="([A-Z]+)\d+"/.exec(attrs)
      const colIdx = refMatch ? columnLettersToIndex(refMatch[1]) : nextCol
      nextCol = colIdx + 1

      const typeMatch = /\bt="([^"]+)"/.exec(attrs)
      const cellType = typeMatch?.[1] ?? ''
      let text = ''
      if (cellType === 'inlineStr') {
        const parts: string[] = []
        const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
        let tMatch: RegExpExecArray | null
        while ((tMatch = tRegex.exec(body)) !== null) {
          parts.push(decodeXmlEntities(tMatch[1]))
        }
        text = parts.join('')
      } else {
        const vMatch = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)
        const rawVal = vMatch ? decodeXmlEntities(vMatch[1]) : ''
        if (cellType === 's') {
          const idx = Number(rawVal)
          text = Number.isInteger(idx) && idx >= 0 ? (sharedStrings[idx] ?? '') : ''
        } else if (cellType === 'b') {
          text = rawVal === '1' ? 'True' : 'False'
        } else {
          text = rawVal
        }
      }
      while (rowCells.length <= colIdx) rowCells.push('')
      rowCells[colIdx] = text
    }
    if (rowCells.some((cell) => cell.trim() !== '')) {
      rows.push(rowCells)
    }
  }
  return rows
}

function canonicalHeaderMap(header: string[]): Map<string, number> {
  const map = new Map<string, number>()
  header.forEach((col, index) => {
    const norm = col.trim().toLowerCase().replace(/[\s_-]/g, '')
    const canonical = GAZE_HEADER_ALIASES[norm] ?? col.trim().toLowerCase()
    if (!map.has(canonical)) map.set(canonical, index)
  })
  return map
}

export async function parseXlsxBufferToCsv(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer)
  const entries = readZipDirectory(bytes)

  const sharedEntry = entries.get('xl/sharedStrings.xml')
  const sharedStrings = sharedEntry ? parseSharedStrings(await extractZipText(bytes, sharedEntry)) : []

  const sheetNames = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = Number(/sheet(\d+)\.xml$/i.exec(a)?.[1] ?? 0)
      const numB = Number(/sheet(\d+)\.xml$/i.exec(b)?.[1] ?? 0)
      return numA - numB
    })

  if (sheetNames.length === 0) {
    throw new Error('No worksheets found in Excel (.xlsx) file.')
  }

  const parsedSheets: string[][][] = []
  for (const sheetName of sheetNames) {
    const xml = await extractZipText(bytes, entries.get(sheetName)!)
    const rows = parseWorksheetRows(xml, sharedStrings)
    if (rows.length > 0) parsedSheets.push(rows)
  }

  if (parsedSheets.length === 0) {
    throw new Error('The uploaded Excel (.xlsx) file is empty.')
  }

  const requiredGazeCols = ['user_id', 'object_id', 'gaze_time', 'time_stamp'] as const
  const gazeCsvLines: string[] = []

  for (const rows of parsedSheets) {
    const cols = canonicalHeaderMap(rows[0])
    if (!requiredGazeCols.every((req) => cols.has(req))) continue
    if (gazeCsvLines.length === 0) {
      gazeCsvLines.push('user_id,session_id,object_id,gaze_time,time_stamp')
    }
    const uIdx = cols.get('user_id')!
    const sIdx = cols.get('session_id')
    const oIdx = cols.get('object_id')!
    const gIdx = cols.get('gaze_time')!
    const tIdx = cols.get('time_stamp')!
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]
      const userVal = (row[uIdx] ?? '').trim()
      const sessVal = sIdx !== undefined ? (row[sIdx] ?? '0').trim() || '0' : '0'
      const objVal = (row[oIdx] ?? '').trim()
      const gazeVal = (row[gIdx] ?? '').trim()
      const timeVal = maybeFormatExcelTimestamp(row[tIdx] ?? '')
      if (!userVal && !objVal && !gazeVal && !timeVal) continue
      gazeCsvLines.push(
        [userVal, sessVal, objVal, gazeVal, timeVal].map(csvEscape).join(','),
      )
    }
  }

  if (gazeCsvLines.length > 0) {
    return `${gazeCsvLines.join('\n')}\n`
  }

  // Fallback: serialize the first non-empty sheet verbatim (e.g. if someone saved a lane map as .xlsx).
  const firstSheet = parsedSheets[0]
  return `${firstSheet.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`
}
