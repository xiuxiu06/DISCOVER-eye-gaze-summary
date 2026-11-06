import type { Dataset } from './types'
import { validateReport, type ClaudeReport } from './reportTypes'

export interface TextFile { name: string; size: number; text: string }
export interface Analysis {
  recordingId: string
  reportVersion: string
  dataset: Dataset
  learners: { key: string; userId: number }[]
  ideals: { key: string }[]
  skippedRows: number
  unmappedObjects: string[]
}
export type Matching = Record<string, string | null>

async function request(path: string, init?: RequestInit) {
  let response: Response
  try { response = await fetch('/api' + path, init) }
  catch { throw new Error('Python backend is unavailable. Start it on localhost:8000, then retry.') }
  let data
  try { data = await response.json() }
  catch { throw new Error('Python backend is unavailable or returned an invalid response. Start it on localhost:8000.') }
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'The Python API could not process this request.')
  return data
}

export async function analyzeFiles(gaze: TextFile, ideal?: TextFile, laneMap?: TextFile): Promise<Analysis> {
  const form = new FormData()
  for (const [key, file] of [['gaze', gaze], ['ideal', ideal], ['laneMap', laneMap]] as const) {
    if (file) form.append(key, new Blob([file.text], { type: 'text/csv' }), file.name)
  }
  return request('/analyze', { method: 'POST', body: form })
}

export async function startReport(recordingId: string, matching: Matching): Promise<string> {
  return (await request('/report-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordingId, matching }) })).jobId
}

export async function pollReport(jobId: string): Promise<ClaudeReport | undefined> {
  const data = await request('/report-jobs/' + encodeURIComponent(jobId))
  if (data.status === 'pending') return undefined
  if (data.status === 'failed') throw new Error(data.error || 'Report generation failed. Please retry.')
  if (data.status !== 'completed') throw new Error('Unexpected report status.')
  return validateReport(data.report)
}

export function reportCacheKey(analysis: Analysis, matching: Matching) {
  return analysis.recordingId + ':' + analysis.reportVersion + ':' + JSON.stringify(Object.entries(matching).sort(([a], [b]) => a.localeCompare(b)))
}
