import { useEffect, useMemo, useState } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UploadLog } from './components/UploadLog'
import { loadDataset } from './data'
import { pickDefaultRun, touchpoints } from './metrics'
import { processLog, type UploadResult } from './processLog'
import { DisplayTest } from './screens/DisplayTest'
import { Profiles } from './screens/Profiles'
import { RawToSignal } from './screens/RawToSignal'
import { SwimLanes } from './screens/SwimLanes'
import type { ScreenProps } from './screens/types'
import { formatRunWindow } from './time'
import type { Dataset } from './types'

/** Tabs in demo order. */
const TABS = [
  { label: 'Raw → Signal', Screen: RawToSignal },
  { label: 'Team swim lanes', Screen: SwimLanes },
  { label: 'Attention profiles', Screen: Profiles },
  { label: 'Display under test', Screen: DisplayTest },
] satisfies { label: string; Screen: (props: ScreenProps) => React.JSX.Element }[]

/** True while a control is using the arrow keys itself: the slider or an open run list. */
function controlUsesArrows(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return (
    target instanceof HTMLInputElement ||
    target.closest('[role="listbox"], [aria-expanded="true"]') !== null
  )
}

interface Upload extends UploadResult {
  fileName: string
}

export default function App() {
  const [dataset, setDataset] = useState<Dataset>()
  const [error, setError] = useState<string>()
  const [upload, setUpload] = useState<Upload>()
  const [uploadError, setUploadError] = useState<string>()
  const [reading, setReading] = useState(false)

  useEffect(() => {
    loadDataset()
      .then(setDataset)
      .catch((reason: unknown) => setError(String(reason)))
  }, [])

  if (error) return <p className="p-6">Couldn't load the data. {error}</p>
  if (!dataset) return <p className="p-6 text-muted-foreground">Loading…</p>
  if (dataset.runs.length === 0) return <p className="p-6">The data has no team runs.</p>

  async function readFile(file: File) {
    if (!dataset) return
    setReading(true)
    setUploadError(undefined)
    try {
      const result = processLog(await file.text(), laneMapCsv, dataset.meta, file.name)
      setUpload({ ...result, fileName: file.name })
    } catch (reason) {
      // Keep showing the current data, so a wrong file loses nothing.
      setUploadError(`Couldn't use ${file.name}. ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      setReading(false)
    }
  }

  const shown = upload?.dataset ?? dataset
  return (
    <Shell
      // A new dataset has different runs, so start again from its default run.
      key={shown.meta.generatedAt}
      dataset={shown}
      notice={
        <>
          {uploadError && (
            <div role="alert" data-testid="upload-error" className="bg-red-50 px-6 py-1.5 text-sm text-red-900">
              {uploadError}
            </div>
          )}
          {upload && (
            <div
              data-testid="upload-notice"
              className="flex flex-wrap items-center gap-x-3 border-b bg-muted px-6 py-1.5 text-sm"
            >
              <span className="font-medium">Showing {upload.fileName}.</span>
              <span className="text-muted-foreground">
                Processed in this browser and not saved.
                {upload.skippedRows > 0 &&
                  ` Skipped unreadable rows: ${upload.skippedRows}.`}
                {upload.unmappedObjects.length > 0 &&
                  ` Objects not in the lane map, counted as background: ${upload.unmappedObjects.length}.`}
              </span>
              <Button
                variant="outline"
                size="xs"
                className="ml-auto"
                onClick={() => {
                  setUpload(undefined)
                  setUploadError(undefined)
                }}
              >
                Back to built-in data
              </Button>
            </div>
          )}
        </>
      }
      uploadControl={<UploadLog busy={reading} onFile={readFile} />}
    />
  )
}

function Shell({
  dataset,
  notice,
  uploadControl,
}: {
  dataset: Dataset
  notice: React.ReactNode
  uploadControl: React.ReactNode
}) {
  const [tab, setTab] = useState(0)
  const [runId, setRunId] = useState(() => pickDefaultRun(dataset.runs)!.id)
  const [minVisitS, setMinVisitS] = useState(dataset.meta.params.DEFAULT_MIN_VISIT_S ?? 0.5)

  const run = dataset.runs.find((candidate) => candidate.id === runId)!
  const runTouchpoints = useMemo(
    () => touchpoints(dataset.visits, runId, minVisitS),
    [dataset.visits, runId, minVisitS],
  )
  const runItems = useMemo(
    () =>
      dataset.runs.map((option) => ({
        value: option.id,
        label: `${formatRunWindow(option.start, option.end)} · ${option.userIds.length} learner${option.userIds.length === 1 ? '' : 's'}`,
      })),
    [dataset.runs],
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

  const { Screen } = TABS[tab]

  return (
    <div className="flex h-full flex-col">
      {dataset.origin === 'mock' && (
        <div role="alert" className="bg-red-700 px-6 py-1.5 text-sm font-medium text-white">
          MOCK DATA: synthetic values for development, not from the gaze log. Not for the demo.
        </div>
      )}
      {notice}

      <header className="flex flex-wrap items-center gap-x-8 gap-y-3 px-6 pt-4 pb-3">
        <h1 className="mr-auto text-lg font-semibold tracking-tight">DISCOVER Gaze Insights</h1>

        <div className="flex items-center gap-2 text-sm">
          <span id="run-label" className="text-muted-foreground">
            Run
          </span>
          <Select
            items={runItems}
            value={runId}
            onValueChange={(value) => {
              if (value) setRunId(value)
            }}
          >
            <SelectTrigger aria-labelledby="run-label" className="tabular-nums">
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

        <div className="flex items-center gap-3 text-sm">
          <span id="touchpoint-label" className="whitespace-nowrap text-muted-foreground">
            Min touchpoint
          </span>
          <Slider
            aria-labelledby="touchpoint-label"
            className="shrink-0 data-horizontal:w-36"
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
          <output className="w-12 text-right font-medium whitespace-nowrap tabular-nums">
            {minVisitS.toFixed(1)} s
          </output>
        </div>
        {uploadControl}
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as number)}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="border-b px-6">
          {/* The tabs handle arrow keys while focused, so make those keys switch screens too. */}
          <TabsList variant="line" loopFocus={false} activateOnFocus>
            {TABS.map(({ label }, index) => (
              <TabsTrigger key={label} value={index} className="px-2.5">
                {index + 1}. {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value={tab} className="flex min-h-0 flex-col overflow-auto p-6">
          <Screen dataset={dataset} run={run} minVisitS={minVisitS} touchpoints={runTouchpoints} />
        </TabsContent>
      </Tabs>

      <footer className="border-t px-6 py-1.5 text-xs text-muted-foreground">
        Head gaze (headset-forward ray), not eye tracking
      </footer>
    </div>
  )
}
