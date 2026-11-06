import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import laneMapCsv from '../../data/lane_map.csv?raw'
import { analyzeFiles, pollReport, reportCacheKey, startReport, type Analysis, type Matching, type TextFile } from './api'
import {
  applyLaneMapToBuiltInDataset,
  checkServerClaudeStatus,
  extractObjectsForClassification,
  matchLaneMapWithClaude,
} from './claudeLaneMap'
import { loadDataset } from './data'
import { validateReport, type ClaudeReport } from './reportTypes'
import type { Dataset } from './types'
import type { FileControls } from './screens/types'
import { readUpload, saveUpload, type SavedUpload } from './uploadStorage'
import { isSpreadsheetExcelFile, parseXlsxBufferToCsv } from './xlsxGaze'

interface Files extends Omit<SavedUpload, 'gaze'> {
  gaze?: TextFile
}

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason))

async function readFile(file: File, csvOnly = false): Promise<TextFile> {
  if (file.size > 50 * 1024 * 1024) throw new Error(file.name + ' is over the 50 MB limit.')
  if (!csvOnly && isSpreadsheetExcelFile(file.name)) {
    return {
      name: file.name,
      size: file.size,
      text: await parseXlsxBufferToCsv(await file.arrayBuffer()),
    }
  }
  if (!/\.(csv|tsv)$/i.test(file.name)) {
    throw new Error(csvOnly ? 'Choose a CSV or TSV file.' : 'Choose a CSV, TSV, or Excel (.xlsx) file.')
  }
  return { name: file.name, size: file.size, text: await file.text() }
}

function isLaneMapHeader(text: string): boolean {
  const header = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toLowerCase()
  return /\bobject_id\b/.test(header) && /\blane\b/.test(header)
}

function normalizeMatching(analysis: Analysis, previous: Matching = {}): Matching {
  const available = new Set(analysis.ideals.map((ideal) => ideal.key))
  const used = new Set<string>()
  return Object.fromEntries(
    analysis.learners.map((learner) => {
      const target = previous[learner.key]
      if (target && available.has(target) && !used.has(target)) {
        used.add(target)
        return [learner.key, target]
      }
      return [learner.key, null]
    }),
  )
}

export function useUploadSession() {
  const [builtin, setBuiltin] = useState<Dataset>()
  const [loadError, setLoadError] = useState<string>()
  const [analysis, setAnalysis] = useState<Analysis>()
  const [files, setFiles] = useState<Files>({})
  const [reading, setReading] = useState(false)
  const [matchingLanes, setMatchingLanes] = useState(false)
  const [hasServerClaudeKey, setHasServerClaudeKey] = useState(false)
  const [claudeNote, setClaudeNote] = useState<string>()
  const [error, setError] = useState<string>()
  const [reportError, setReportError] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [ready, setReady] = useState(false)
  const version = useRef(0)
  const writes = useRef(Promise.resolve())

  useEffect(() => {
    let cancelled = false
    void checkServerClaudeStatus().then((ok) => {
      if (!cancelled) setHasServerClaudeKey(ok)
    })
    void (async () => {
      try {
        const loaded = await loadDataset()
        if (cancelled) return
        setBuiltin(loaded)
        let saved: SavedUpload | undefined
        try {
          saved = await readUpload()
        } catch {
          /* Browser storage is optional. */
        }
        if (cancelled) return
        if (saved) {
          setFiles(saved)
          if (saved.gaze) {
            setReading(true)
            try {
              const restored = await analyzeFiles(saved.gaze, saved.ideal, saved.laneMap)
              if (!cancelled) {
                setAnalysis(restored)
                setFiles({ ...saved, matching: normalizeMatching(restored, saved.matching) })
              }
            } catch (reason) {
              if (!cancelled) setError('Could not restore analysis. ' + message(reason))
            }
          }
        }
      } catch (reason) {
        if (!cancelled) setLoadError(message(reason))
      } finally {
        if (!cancelled) {
          setReading(false)
          setReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Serialize writes so an older async save cannot overwrite newer matching or report data.
  useEffect(() => {
    if (!ready) return
    const snapshot = files.gaze || files.laneMap || files.ideal ? (files as SavedUpload) : undefined
    writes.current = writes.current
      .catch(() => {})
      .then(() => saveUpload(snapshot))
      .catch(() => {
        setError(
          'Browser storage is unavailable. Keep this tab open; files and reports may need to be loaded again after reload.',
        )
      })
  }, [files, ready])

  const matching = files.matching ?? {}
  const cacheKey = analysis ? reportCacheKey(analysis, matching) : undefined
  let report: ClaudeReport | undefined
  if (cacheKey && files.reportCache?.key === cacheKey) {
    try {
      report = validateReport(files.reportCache.report)
    } catch {
      /* Discard invalid cached content. */
    }
  }
  const pending = cacheKey && files.pendingJob?.key === cacheKey ? files.pendingJob : undefined

  useEffect(() => {
    if (!pending) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const result = await pollReport(pending!.jobId)
        if (cancelled) return
        if (!result) {
          timer = setTimeout(() => void poll(), 1500)
          return
        }
        setFiles((current) =>
          current.pendingJob?.jobId === pending!.jobId
            ? { ...current, pendingJob: undefined, reportCache: { key: pending!.key, report: result } }
            : current,
        )
      } catch (reason) {
        if (!cancelled) {
          setReportError(message(reason))
          setFiles((current) =>
            current.pendingJob?.jobId === pending!.jobId ? { ...current, pendingJob: undefined } : current,
          )
        }
      }
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [pending])

  async function process(next: Files): Promise<boolean> {
    const attempt = ++version.current
    setStarting(false)
    setReading(true)
    setError(undefined)
    setReportError(undefined)
    try {
      if (!next.gaze) {
        setFiles(next)
        setAnalysis(undefined)
        return true
      }
      const processed = await analyzeFiles(next.gaze, next.ideal, next.laneMap)
      if (attempt !== version.current) return false
      setAnalysis(processed)
      const sameFiles = analysis?.recordingId === processed.recordingId
      setFiles({
        ...next,
        matching: normalizeMatching(processed, sameFiles ? next.matching : {}),
        pendingJob: undefined,
        reportCache: sameFiles ? next.reportCache : undefined,
      })
      return true
    } catch (reason) {
      if (attempt === version.current) setError(message(reason))
      return false
    } finally {
      if (attempt === version.current) setReading(false)
    }
  }

  async function addFiles(chosen: File[]) {
    setClaudeNote(undefined)
    try {
      const next: Files = { ...files }
      for (const file of chosen) {
        const held = await readFile(file)
        if (isLaneMapHeader(held.text)) next.laneMap = { ...held, source: 'upload' }
        else next.gaze = held
      }
      await process(next)
    } catch (reason) {
      setError(message(reason))
    }
  }

  async function uploadLaneMapFile(file: File) {
    setClaudeNote(undefined)
    try {
      const held = await readFile(file, true)
      if (!isLaneMapHeader(held.text)) {
        throw new Error(
          `${file.name} does not look like a lane map CSV. Expected header columns including "object_id" and "lane".`,
        )
      }
      await process({ ...files, laneMap: { ...held, source: 'upload' } })
    } catch (reason) {
      setError(message(reason))
    }
  }

  async function runClaudeLaneMatch(apiKey?: string): Promise<boolean> {
    const baseDataset = analysis?.dataset ?? builtin
    if (!baseDataset) return false
    setMatchingLanes(true)
    setError(undefined)
    setClaudeNote(undefined)
    try {
      const candidates = extractObjectsForClassification(files.gaze?.text, baseDataset, files.ideal?.text)
      const matched = await matchLaneMapWithClaude({ candidates, apiKey })
      const csvBytes = new Blob([matched.csvText], { type: 'text/csv' }).size
      const nextLaneMap = {
        name: 'claude_lane_map.csv',
        size: csvBytes,
        text: matched.csvText,
        source: 'claude' as const,
      }
      const ok = await process({ ...files, laneMap: nextLaneMap })
      if (!ok && !analysis) {
        setFiles((current) => ({ ...current, laneMap: nextLaneMap }))
      }
      setClaudeNote(
        `Claude (${matched.modelUsed}) matched ${matched.totalObjects} objects into categories: ${matched.clinicalObjects} across the 5 clinical swimlanes, ${matched.backgroundObjects} set aside as background (${matched.verifyObjects} flagged to verify).`,
      )
      return true
    } catch (reason) {
      setError(message(reason))
      return false
    } finally {
      setMatchingLanes(false)
    }
  }

  const downloadLaneMap = useCallback(() => {
    const content = files.laneMap?.text ?? laneMapCsv
    const filename = files.laneMap?.name ?? 'lane_map.csv'
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [files.laneMap])

  async function generateReport() {
    if (!analysis || !cacheKey) return
    const attempt = version.current
    setStarting(true)
    setReportError(undefined)
    try {
      const jobId = await startReport(analysis.recordingId, matching)
      if (attempt === version.current) setFiles((current) => ({ ...current, pendingJob: { key: cacheKey, jobId } }))
    } catch (reason) {
      if (attempt === version.current) setReportError(message(reason))
    } finally {
      if (attempt === version.current) setStarting(false)
    }
  }

  const activeDataset = useMemo(() => {
    if (analysis) return analysis.dataset
    if (builtin && files.laneMap) {
      try {
        return applyLaneMapToBuiltInDataset(builtin, files.laneMap.text).dataset
      } catch {
        return builtin
      }
    }
    return builtin
  }, [analysis, builtin, files.laneMap])

  const pythonNote = analysis
    ? [
        'Processed by Python.',
        analysis.skippedRows ? `Skipped unreadable rows: ${analysis.skippedRows}.` : '',
        analysis.unmappedObjects.length
          ? `${analysis.unmappedObjects.length} unmapped objects counted as background.`
          : '',
      ]
        .filter(Boolean)
        .join(' ')
    : files.laneMap && !files.gaze
      ? 'Lane map applied to built-in data. Upload a learner gaze log to analyze your own file with it.'
      : undefined

  const note = [claudeNote, pythonNote].filter(Boolean).join(' ') || undefined

  const controls: FileControls = {
    gaze: files.gaze,
    laneMap: files.laneMap,
    ideal: files.ideal,
    reading,
    matchingLanes,
    hasServerClaudeKey,
    error,
    note,
    analysis,
    matching,
    report,
    generating: starting || !!pending,
    reportError,
    addFiles: (chosen) => void addFiles(chosen),
    uploadLaneMapFile: (file) => void uploadLaneMapFile(file),
    matchLanesWithClaude: runClaudeLaneMatch,
    downloadLaneMap,
    addIdeal: (file) => {
      void readFile(file)
        .then((ideal) => process({ ...files, ideal }))
        .catch((reason) => setError(message(reason)))
    },
    removeIdeal: () => void process({ ...files, ideal: undefined, matching: {}, reportCache: undefined }),
    removeLaneMap: () => {
      setClaudeNote(undefined)
      void process({ ...files, laneMap: undefined })
    },
    removeGaze: () => {
      version.current++
      setStarting(false)
      setReading(false)
      setFiles({ ideal: files.ideal, laneMap: files.laneMap })
      setAnalysis(undefined)
      setError(undefined)
      setReportError(undefined)
    },
    reprocess: () => void process(files),
    setMatch: (learner, ideal) => {
      version.current++
      setStarting(false)
      setReportError(undefined)
      setFiles((current) => ({
        ...current,
        matching: { ...current.matching, [learner]: ideal },
        pendingJob: undefined,
        reportCache: undefined,
      }))
    },
    generateReport: () => void generateReport(),
  }

  return { dataset: activeDataset, files: controls, loadError, ready }
}
