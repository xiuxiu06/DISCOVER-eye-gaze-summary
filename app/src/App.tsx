import { useEffect, useMemo, useState } from 'react'
import { loadDataset } from './data'
import { pickDefaultRun, touchpoints } from './metrics'
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

export default function App() {
  const [dataset, setDataset] = useState<Dataset>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    loadDataset()
      .then(setDataset)
      .catch((reason: unknown) => setError(String(reason)))
  }, [])

  if (error) return <p className="status">Couldn't load the data. {error}</p>
  if (!dataset) return <p className="status">Loading…</p>
  if (dataset.runs.length === 0) return <p className="status">The data has no team runs.</p>
  return <Shell dataset={dataset} />
}

function Shell({ dataset }: { dataset: Dataset }) {
  const [tab, setTab] = useState(0)
  const [runId, setRunId] = useState(() => pickDefaultRun(dataset.runs)!.id)
  const [minVisitS, setMinVisitS] = useState(dataset.meta.params.DEFAULT_MIN_VISIT_S ?? 0.5)

  const run = dataset.runs.find((candidate) => candidate.id === runId)!
  const runTouchpoints = useMemo(
    () => touchpoints(dataset.visits, runId, minVisitS),
    [dataset.visits, runId, minVisitS],
  )

  // Arrow keys move between tabs, except while a control needs them.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return
      }
      if (event.key === 'ArrowRight') setTab((current) => Math.min(current + 1, TABS.length - 1))
      if (event.key === 'ArrowLeft') setTab((current) => Math.max(current - 1, 0))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const { Screen } = TABS[tab]

  return (
    <div className="app">
      {dataset.origin === 'mock' && (
        <div className="mock-banner" role="alert">
          MOCK DATA: synthetic values for development, not from the gaze log. Not for the demo.
        </div>
      )}

      <header className="header">
        <h1>DISCOVER Gaze Insights</h1>
        <label className="control">
          Run
          <select
            value={runId}
            onChange={(event) => {
              setRunId(event.target.value)
              event.target.blur() // hand the arrow keys back to the tabs
            }}
          >
            {dataset.runs.map((option) => (
              <option key={option.id} value={option.id}>
                {formatRunWindow(option.start, option.end)} · {option.userIds.length} learners
              </option>
            ))}
          </select>
        </label>
        <label className="control">
          Min touchpoint
          <input
            type="range"
            min={0.3}
            max={2}
            step={0.1}
            value={minVisitS}
            onChange={(event) => setMinVisitS(Number(event.target.value))}
            onPointerUp={(event) => event.currentTarget.blur()}
          />
          <output>{minVisitS.toFixed(1)} s</output>
        </label>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map(({ label }, index) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={index === tab}
            onClick={() => setTab(index)}
          >
            {index + 1}. {label}
          </button>
        ))}
      </nav>

      <main className="main">
        <Screen dataset={dataset} run={run} minVisitS={minVisitS} touchpoints={runTouchpoints} />
      </main>

      <footer className="footer">Head gaze (headset-forward ray), not eye tracking</footer>
    </div>
  )
}
