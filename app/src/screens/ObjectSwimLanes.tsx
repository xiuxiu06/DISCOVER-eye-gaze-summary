import { useEffect, useMemo, useState } from 'react'
import { PageTitle, Panel, PanelTitle } from '../components/Page'
import { SwimChart } from '../components/SwimChart'
import { runWindow } from '../metrics'
import { parseSummary, summaryVisits, type GazeSummary } from '../summary'
import { formatClock, formatElapsed, formatDuration } from '../time'
import type { Lane, Visit } from '../types'
import type { ScreenProps } from './types'

const COLORS = ['#3B8EDB', '#D6336C', '#6FA832', '#D99A00', '#4FA3D1', '#8B5FBF']

interface SummaryFile { summary: GazeSummary; source: string }

export function ObjectSwimLanes({ dataset, run, minVisitS, view, summaryFile, setSummaryFile }: ScreenProps & { view: 'simplified' | 'advanced'; summaryFile?: SummaryFile; setSummaryFile: (file: SummaryFile) => void }) {
  const simple = view === 'simplified'
  const summary = summaryFile?.summary
  const source = summaryFile?.source
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(() => simple && !summaryFile && dataset.origin === 'real' && dataset.meta.source.startsWith('eye_gaze_tracking_050505092026.csv'))
  const [learner, setLearner] = useState<number>()
  const [search, setSearch] = useState('')
  const [laneFilter, setLaneFilter] = useState('Vital sign monitor')
  const [selected, setSelected] = useState<Visit>()

  useEffect(() => {
    if (summaryFile || !simple || dataset.origin !== 'real' || !dataset.meta.source.startsWith('eye_gaze_tracking_050505092026.csv')) return
    let cancelled = false
    fetch(import.meta.env.BASE_URL + 'gaze-summary.json')
      .then((response) => { if (!response.ok) throw new Error('Summary is unavailable.'); return response.json() })
      .then((data: unknown) => { if (!cancelled) { setSummaryFile({ summary: parseSummary(data), source: 'gaze_summary2.json (built-in recording)' }); setLoading(false) } })
      .catch((reason: unknown) => { if (!cancelled) setError(String(reason)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [simple, dataset.origin, dataset.meta.source, summaryFile, setSummaryFile])

  const learners = simple ? summary?.users.map((user) => user.userId) ?? [] : run.userIds
  const userId = learner !== undefined && learners.includes(learner) ? learner : learners[0]
  const allItems = useMemo<Visit[]>(() => simple
    ? summary && userId !== undefined ? summaryVisits(summary, userId) : []
    : dataset.objectVisits.filter((visit) => visit.runId === run.id && visit.userId === userId)
      .map((visit) => ({ ...visit, lane: visit.objectId, objects: { [visit.objectId]: visit.dwell } })),
  [simple, summary, userId, dataset.objectVisits, run.id])
  const filtered = allItems.filter((visit) => simple || laneFilter === '' || dataset.meta.objects[visit.lane]?.lane === laneFilter)
  const objectNames = [...new Set(filtered.map((visit) => visit.lane))]
    .filter((name) => name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.localeCompare(b))
  const shownNames = new Set(objectNames)
  // Summary dwell is seconds labelled by the summary, rather than the raw dwell measurement.
  const items = filtered.filter((visit) => shownNames.has(visit.lane) && visit.dwell >= minVisitS)
  const lanes: Lane[] = objectNames.map((name, index) => {
    const clinicalLane = dataset.meta.lanes.find((lane) => lane.id === dataset.meta.objects[name]?.lane)
    return { id: name, label: name, order: index, include: true,
      color: clinicalLane?.color ?? COLORS[index % COLORS.length], band: clinicalLane?.band ?? '#EFF3F8' }
  })
  const window = simple
    ? { start: 0, end: Math.max(1, (summary?.users.find((user) => user.userId === userId)?.entries.at(-1)?.second ?? 0) + 1) }
    : runWindow(run)
  const activeSelected = selected && items.find((item) => item.userId === selected.userId && item.start === selected.start && item.lane === selected.lane && item.end === selected.end)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <PageTitle>Team swim lanes ? {simple ? 'Simplified' : 'Advanced'}</PageTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          {simple ? 'Filtered, condensed objects from the existing gaze summary script. One dominant object per second.'
            : 'Individual included objects in the selected team run, colored by clinical lane. Background objects are excluded.'}
        </p>
      </div>
      {simple && <Panel>
        <PanelTitle>Gaze summary</PanelTitle>
        <p className="m-0 text-sm text-muted-foreground">
          Upload the condensed summary JSON for your recording, generated with summarize_gaze.py --condense --no-ideal.
          This view spans the summary?s full recording; the Team run picker applies to Standard and Advanced.
          Pauses between sessions are omitted by the script. This is summary elapsed time, not clock time.
        </p>
        <label className="text-sm font-medium">Choose summary JSON
          <input className="ml-3 max-w-full" type="file" accept=".json,application/json" disabled={loading}
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              setError(''); setLoading(true)
              try {
                if (file.size > 50 * 1024 * 1024) throw new Error('Summary exceeds 50 MB.')
                const parsed = parseSummary(JSON.parse(await file.text()))
                setSummaryFile({ summary: parsed, source: file.name }); setLearner(undefined); setSelected(undefined)
              } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
              finally { setLoading(false) }
            }} />
        </label>
        {source && <p role="status" className="m-0 text-sm">Summary source: <strong>{source}</strong></p>}
        {loading && <p role="status">Reading summary?</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {!summary && !loading && <p className="m-0 text-sm">Choose a summary to display this recording. No sample data is substituted for an uploaded gaze log.</p>}
      </Panel>}
      {(!simple || summary) && <>
        <Panel>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label>Learner <select className="ml-2 min-h-11 rounded border bg-white px-3" value={userId ?? ''}
              onChange={(event) => { setLearner(Number(event.target.value)); setSelected(undefined) }}>
              {learners.map((id) => <option key={id} value={id}>Learner {id}</option>)}
            </select></label>
            {!simple && <label>Clinical lane <select className="ml-2 min-h-11 rounded border bg-white px-3" value={laneFilter}
              onChange={(event) => { setLaneFilter(event.target.value); setSelected(undefined) }}>
              <option value="">All included lanes</option>
              {dataset.meta.lanes.filter((lane) => lane.include).map((lane) => <option key={lane.id} value={lane.id}>{lane.label}</option>)}
            </select></label>}
            <label>Find object <input className="ml-2 min-h-11 rounded border px-3" type="search" value={search}
              placeholder="Object name" onChange={(event) => setSearch(event.target.value)} /></label>
            <span className="text-muted-foreground">{lanes.length} objects ? {items.length} {simple ? 'summary segments' : 'object visits'} ? {minVisitS.toFixed(1)} s</span>
          </div>
          {lanes.length && items.length ? <SwimChart key={view + run.id + userId + laneFilter + search}
            meta={dataset.meta} lanes={lanes} learners={[userId]} window={window} touchpoints={items}
            idle={simple ? [] : dataset.idle.filter((item) => item.userId === userId && run.sessionIds.includes(item.sessionId))}
            ariaLabel={simple ? 'Condensed gaze summary by object' : 'Detailed object visits'}
            relativeTime={simple} showLearnerNames={false} laneHeight={26} selected={activeSelected} onSelect={setSelected} />
            : <p className="text-sm text-muted-foreground">No objects meet these filters and the current threshold.</p>}
          <p className="m-0 text-xs text-muted-foreground">{simple
            ? 'Each dot is a consecutive span of seconds labelled with the same condensed object. Size shows summary duration; null seconds break spans. User 0 is excluded.'
            : 'Each dot is an object visit. Hover or select a dot for exact times and dwell. Use Ctrl+scroll to zoom and Shift+drag to pan.'}</p>
        </Panel>
        {!simple && <Panel>
          <PanelTitle>Object visit details</PanelTitle>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="sticky top-0 bg-white"><tr>{['Time', 'Object', 'Clinical lane', 'Dwell'].map((heading) => <th className="border-b p-2" key={heading}>{heading}</th>)}</tr></thead>
              <tbody>{items.slice().sort((a, b) => a.start - b.start).map((visit, index) => <tr key={index} className="border-b">
                <td className="p-2 whitespace-nowrap">{formatClock(visit.start)} ? {formatElapsed(visit.start - window.start)}</td>
                <td className="p-2 break-all">{visit.lane}{dataset.meta.objects[visit.lane]?.verify ? ' ?' : ''}</td>
                <td className="p-2">{dataset.meta.objects[visit.lane]?.lane ?? 'Unmapped'}</td>
                <td className="p-2 whitespace-nowrap">{formatDuration(visit.dwell)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </Panel>}
        {activeSelected && <Panel><PanelTitle>Selected {simple ? 'summary segment' : 'object visit'}</PanelTitle>
          <span className="text-sm">{activeSelected.lane} ? {simple ? formatElapsed(activeSelected.start) : formatClock(activeSelected.start)} ? {formatDuration(activeSelected.dwell)}</span>
        </Panel>}
      </>}
      <p className="border-t pt-4 text-xs text-muted-foreground">Head gaze (headset-forward ray), not eye tracking.</p>
    </div>
  )
}
