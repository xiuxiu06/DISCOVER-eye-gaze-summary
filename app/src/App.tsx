import { useCallback, useEffect, useMemo, useState } from 'react'
import laneMapCsv from '../../data/lane_map.csv?raw'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { loadDataset } from './data'
import { exportChartPng } from './lib/exportPng'
import { pickDefaultRun, teamRuns, touchpoints } from './metrics'
import { fileKind, processLog, type UploadResult } from './processLog'
import { ReportCard } from './screens/ReportCard'
import { SwimLanes } from './screens/SwimLanes'
import type { FileControls, HeldFile, ScreenProps } from './screens/types'
import { UploadClean } from './screens/UploadClean'
import { formatClockSpan, formatDay, formatLearners, isoToEpoch } from './time'
import type { Dataset } from './types'

const MAX_FILE_BYTES = 50 * 1024 * 1024

/** Tabs in demo order. */
const TABS = [
  { label: 'Upload & clean', Screen: UploadClean },
  { label: 'Team swim lanes', Screen: SwimLanes },
  { label: 'Report card', Screen: ReportCard },
] satisfies { label: string; Screen: (props: ScreenProps) => React.JSX.Element }[]

const LANES_TAB = 1
const REPORT_TAB = 2

/** True while a control is using the arrow keys itself: an input or an open run list. */
function controlUsesArrows(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.closest('[role="listbox"], [aria-expanded="true"]') !== null
  )
}

interface HeldText extends HeldFile {
  text: string
}

function uploadNote(result: UploadResult): string | undefined {
  const parts: string[] = []
  if (result.skippedRows > 0) parts.push(`Skipped unreadable rows: ${result.skippedRows}.`)
  if (result.unmappedObjects.length > 0) {
    parts.push(`Objects not in the lane map, counted as background: ${result.unmappedObjects.length}.`)
  }
  return parts.length > 0 ? parts.join(' ') : undefined
}

export default function App() {
  const [dataset, setDataset] = useState<Dataset>()
  const [loadError, setLoadError] = useState<string>()
  const [gaze, setGaze] = useState<HeldText>()
  const [laneMap, setLaneMap] = useState<HeldText>()
  const [result, setResult] = useState<UploadResult>()
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string>()
  const [waiting, setWaiting] = useState(false)

  useEffect(() => {
    loadDataset()
      .then(setDataset)
      .catch((reason: unknown) => setLoadError(String(reason)))
  }, [])

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!dataset) return
      setReading(true)
      setError(undefined)
      try {
        let nextGaze = gaze
        let nextLaneMap = laneMap
        for (const file of files) {
          if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over the 50 MB limit.`)
          const held = { name: file.name, size: file.size, text: await file.text() }
          if (fileKind(held.text) === 'laneMap') nextLaneMap = held
          else nextGaze = held
        }
        // A new upload is judged as a whole, so a bad file leaves the current data on screen.
        if (nextGaze) {
          const name = nextGaze.name
          try {
            setResult(processLog(nextGaze.text, nextLaneMap?.text ?? laneMapCsv, dataset.meta, name))
          } catch (reason) {
            throw new Error(`Couldn't use ${name}. ${reason instanceof Error ? reason.message : String(reason)}`)
          }
        }
        setGaze(nextGaze)
        setLaneMap(nextLaneMap)
        setWaiting(!nextGaze && nextLaneMap !== undefined)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setReading(false)
      }
    },
    [dataset, gaze, laneMap],
  )

  const files: FileControls | undefined = useMemo(() => {
    let note = result ? uploadNote(result) : undefined
    if (waiting) {
      note = 'Lane map loaded. Upload a gaze log to apply it, because the built-in data is already processed.'
    }
    return {
      gaze: gaze && { name: gaze.name, size: gaze.size },
      laneMap: laneMap && { name: laneMap.name, size: laneMap.size },
      reading,
      error,
      note,
      addFiles: (chosen) => void addFiles(chosen),
      removeGaze: () => {
        setGaze(undefined)
        setResult(undefined)
        setError(undefined)
        setWaiting(laneMap !== undefined)
      },
      removeLaneMap: () => {
        setLaneMap(undefined)
        setError(undefined)
        setWaiting(false)
        if (gaze && dataset) {
          setResult(processLog(gaze.text, laneMapCsv, dataset.meta, gaze.name))
        }
      },
    }
  }, [gaze, laneMap, reading, error, result, waiting, addFiles, dataset])

  if (loadError) return <p className="p-6">Couldn't load the data. {loadError}</p>
  if (!dataset || !files) return <p className="p-6 text-muted-foreground">Loading…</p>
  const shown = result?.dataset ?? dataset
  if (shown.runs.length === 0) return <p className="p-6">The data has no team runs.</p>
  return <Shell key={shown.meta.generatedAt} dataset={shown} files={files} />
}

function Shell({ dataset, files }: { dataset: Dataset; files: FileControls }) {
  const [tab, setTab] = useState(0)
  const pickable = useMemo(() => teamRuns(dataset.runs), [dataset.runs])
  const [runId, setRunId] = useState(() => pickDefaultRun(pickable)!.id)
  const [minVisitS, setMinVisitS] = useState(dataset.meta.params.DEFAULT_MIN_VISIT_S ?? 0.5)
  const [learnerId, setLearnerId] = useState(() => pickDefaultRun(pickable)!.userIds[0])

  const run = dataset.runs.find((candidate) => candidate.id === runId)!
  const runTouchpoints = useMemo(
    () => touchpoints(dataset.visits, runId, minVisitS),
    [dataset.visits, runId, minVisitS],
  )
  const runItems = useMemo(
    () =>
      pickable.map((option) => ({
        value: option.id,
        label: `${formatDay(option.start)} · ${formatClockSpan(isoToEpoch(option.start), isoToEpoch(option.end))} · ${formatLearners(option.userIds)}`,
      })),
    [pickable],
  )

  // Arrow keys move between tabs (demo mode), except while a control needs them.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (controlUsesArrows(event.target)) return
      if (event.key === 'ArrowRight') setTab((current) => Math.min(current + 1, TABS.length - 1))
      if (event.key === 'ArrowLeft') setTab((current) => Math.max(current - 1, 0))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // A new screen starts at its top, including when another screen's button opened it.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [tab])

  const { Screen } = TABS[tab]

  return (
    <div className="min-h-screen bg-background pb-12 print:bg-white print:pb-0">
      {dataset.origin === 'mock' && (
        <div role="alert" className="bg-red-700 px-8 py-1.5 text-sm font-medium text-white print:hidden">
          MOCK DATA: synthetic values for development, not from the gaze log. Not for the demo.
        </div>
      )}

      <header className="border-b bg-white print:hidden">
        <div className="mx-auto flex max-w-[1360px] flex-col gap-3 px-8 pt-4">
          <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
            <div className="flex grow items-center gap-3">
              <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
                <rect x="0.5" y="0.5" width="35" height="35" rx="9" fill="#15181E" />
                <rect x="7" y="9" width="22" height="4" rx="2" fill="#4FA3D1" />
                <rect x="7" y="16" width="22" height="4" rx="2" fill="#D6336C" />
                <rect x="7" y="23" width="22" height="4" rx="2" fill="#6FA832" />
                <circle cx="13" cy="11" r="2.6" fill="#FFFFFF" />
                <circle cx="21" cy="18" r="2.6" fill="#FFFFFF" />
                <circle cx="26" cy="25" r="2.6" fill="#FFFFFF" />
              </svg>
              <div className="flex flex-col gap-0.5">
                <span className="font-heading text-[19px] font-semibold tracking-[-0.01em]">
                  DISCOVER Gaze Insights
                </span>
                <span className="text-xs text-muted-foreground">
                  Head-gaze analytics for VR simulation · CCHMC DISCOVER
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span id="run-label">Team run</span>
                <Select
                  items={runItems}
                  value={runId}
                  onValueChange={(value) => {
                    if (value) setRunId(value)
                  }}
                >
                  <SelectTrigger aria-labelledby="run-label" className="tabular-nums text-foreground data-[size=default]:h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {runItems.map((item) => (
                      <SelectItem key={item.value} value={item.value} className="tabular-nums">
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
                <span id="touchpoint-label" className="whitespace-nowrap">
                  Min touchpoint
                </span>
                <Slider
                  aria-labelledby="touchpoint-label"
                  className="shrink-0 data-horizontal:w-[120px]"
                  min={0.3}
                  max={2}
                  step={0.1}
                  value={[minVisitS]}
                  onValueChange={(value) => {
                    const next = Array.isArray(value) ? value[0] : value
                    setMinVisitS(Math.round(next * 10) / 10)
                  }}
                  onValueCommitted={(_value, details) => {
                    // After a drag, hand the arrow keys back to the tabs. Keyboard users keep focus.
                    if (details.event.type !== 'keydown' && document.activeElement instanceof HTMLElement) {
                      document.activeElement.blur()
                    }
                  }}
                />
                <output className="font-semibold whitespace-nowrap text-foreground tabular-nums">
                  {minVisitS.toFixed(1)} s
                </output>
              </div>

              {tab !== 0 && (
                <Button
                  variant="outline"
                  size="lg"
                  className="min-h-11"
                  onClick={() => void exportChartPng(`discover-${TABS[tab].label.toLowerCase().replaceAll(' ', '-')}-${run.id}.png`)}
                >
                  Export PNG
                </Button>
              )}
            </div>
          </div>

          <nav aria-label="Screens" className="-mb-px flex flex-wrap gap-0.5">
            {TABS.map(({ label }, index) => {
              const current = index === tab
              return (
                <button
                  key={label}
                  type="button"
                  aria-current={current ? 'page' : undefined}
                  className={`inline-flex cursor-pointer items-center gap-2 border-b-2 p-3 text-sm ${
                    current
                      ? 'border-primary font-semibold text-foreground'
                      : 'border-transparent font-medium text-muted-foreground'
                  }`}
                  onClick={() => setTab(index)}
                >
                  <span
                    className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                      current ? 'bg-primary text-white' : 'bg-[#E7E9EE] text-muted-foreground'
                    }`}
                  >
                    {index + 1}
                  </span>
                  {label}
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1360px] px-8 pt-7 print:px-0 print:pt-0">
        <Screen
          dataset={dataset}
          run={run}
          minVisitS={minVisitS}
          touchpoints={runTouchpoints}
          files={files}
          openLanes={() => setTab(LANES_TAB)}
          openLearner={(userId) => {
            setLearnerId(userId)
            setTab(REPORT_TAB)
          }}
          learnerId={learnerId}
          setLearnerId={setLearnerId}
        />
      </main>
    </div>
  )
}
