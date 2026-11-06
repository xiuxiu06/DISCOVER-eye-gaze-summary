import { useState } from 'react'
import { PageTitle, Panel, PanelTitle, sourceName } from '../components/Page'
import { SwimChart } from '../components/SwimChart'
import { summaryVisits } from '../summary'
import { formatElapsed, formatDuration } from '../time'
import type { Lane, Visit } from '../types'
import type { ScreenProps } from './types'

const COLORS = ['#3B8EDB', '#D6336C', '#6FA832', '#D99A00', '#4FA3D1', '#8B5FBF']

export function ObjectSwimLanes({ dataset, minVisitS, view }: ScreenProps & { view: 'simplified' | 'advanced' }) {
  const simple = view === 'simplified'
  const summary = simple ? dataset.summary : dataset.advancedSummary
  const [learner, setLearner] = useState<number>()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Visit>()

  const learners = summary?.users.map((user) => user.userId) ?? []
  const userId = learner !== undefined && learners.includes(learner) ? learner : learners[0]
  const allItems = summary && userId !== undefined ? summaryVisits(summary, userId) : []
  const objectNames = [...new Set(allItems.map((visit) => visit.lane))]
    .filter((name) => name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.localeCompare(b))
  const shownNames = new Set(objectNames)
  // Summary dwell is seconds labelled by the summary, rather than the raw dwell measurement.
  const items = allItems.filter((visit) => shownNames.has(visit.lane) && visit.dwell >= minVisitS)
  const lanes: Lane[] = objectNames.map((name, index) => {
    const clinicalLane = dataset.meta.lanes.find((lane) => lane.id === dataset.meta.objects[name]?.lane)
    return { id: name, label: name, order: index, include: true,
      color: clinicalLane?.color ?? COLORS[index % COLORS.length], band: clinicalLane?.band ?? '#EFF3F8' }
  })
  const window = { start: 0, end: Math.max(1, (summary?.users.find((user) => user.userId === userId)?.entries.at(-1)?.second ?? 0) + 1) }
  const activeSelected = selected && items.find((item) => item.userId === selected.userId && item.start === selected.start && item.lane === selected.lane && item.end === selected.end)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <PageTitle>Team swim lanes - {simple ? 'Simplified' : 'Advanced'}</PageTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          {simple ? 'Filtered, condensed objects from the existing gaze summary script. One dominant object per second.'
            : 'Filtered summary with individual object names preserved. One dominant object per second.'}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{summary ? `Summary generated automatically from ${sourceName(dataset.meta.source)}.` : 'Upload a gaze log in tab 1 to generate its summary automatically.'}</span>
        {summary && <button type="button" className="min-h-11 cursor-pointer rounded-lg border bg-white px-4 font-medium text-foreground" onClick={() => {
          const json = { relevant_objects: summary.relevant_objects,
            ...Object.fromEntries(summary.users.map((user) => ['user' + user.userId, user.entries])) }
          const url = URL.createObjectURL(new Blob([JSON.stringify(json)], { type: 'application/json' }))
          const link = document.createElement('a')
          link.href = url; link.download = sourceName(dataset.meta.source).replace(/\.[^.]+$/, '') + (simple ? '_summary_condensed.json' : '_summary_uncondensed.json')
          link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
        }}>Download summary JSON</button>}
        {summary && <span className="w-full text-xs">Full recording in summary elapsed time; pauses are omitted. Team run selection applies to Standard only.</span>}
      </div>
      {summary && <>
        <Panel>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label>Learner <select className="ml-2 min-h-11 rounded border bg-white px-3" value={userId ?? ''}
              onChange={(event) => { setLearner(Number(event.target.value)); setSelected(undefined) }}>
              {learners.map((id) => <option key={id} value={id}>Learner {id}</option>)}
            </select></label>
            <label>Find object <input className="ml-2 min-h-11 rounded border px-3" type="search" value={search}
              placeholder="Object name" onChange={(event) => setSearch(event.target.value)} /></label>
            <span className="text-muted-foreground">{lanes.length} objects / {items.length} summary segments &ge; {minVisitS.toFixed(1)} s</span>
          </div>
          {lanes.length > 0 && items.length > 0 ? <SwimChart key={view + userId + search}
            meta={dataset.meta} lanes={lanes} learners={[userId]} window={window} touchpoints={items}
            idle={[]}
            ariaLabel={simple ? 'Condensed gaze summary by object' : 'Uncondensed gaze summary by object'}
            relativeTime showLearnerNames={false} laneHeight={26} selected={activeSelected} onSelect={setSelected} />
            : <p className="text-sm text-muted-foreground">No objects meet these filters and the current threshold.</p>}
          <p className="m-0 text-xs text-muted-foreground">{simple
            ? 'Each dot is a consecutive span of seconds labelled with the same condensed object. Size shows summary duration; null seconds break spans. User 0 is excluded.'
            : 'Each dot is a consecutive span of seconds labelled with the same original object. Size shows summary duration, not raw dwell; null seconds break spans. User 0 is excluded.'}</p>
        </Panel>
        {activeSelected && <Panel><PanelTitle>Selected summary segment</PanelTitle>
          <span className="text-sm">{activeSelected.lane} / {formatElapsed(activeSelected.start)} / {formatDuration(activeSelected.dwell)}</span>
        </Panel>}
      </>}
      <p className="border-t pt-4 text-xs text-muted-foreground">Head gaze (headset-forward ray), not eye tracking.</p>
    </div>
  )
}
