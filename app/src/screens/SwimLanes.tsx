import { useMemo, useState } from 'react'
import { LaneDot, PageFooter, PageTitle, Panel, PanelTitle } from '../components/Page'
import { ObjectSwimLanes } from './ObjectSwimLanes'
import { LEARNER_LINES, SwimChart } from '../components/SwimChart'
import {
  COMMUNICATION_LANE,
  MONITOR_LANE,
  PATIENT_LANE,
  coveredIntervals,
  includedLanes,
  laneCoverage,
  learnerSpan,
  runWindow,
  stateAt,
  topObjects,
  type LearnerState,
} from '../metrics'
import {
  formatClock,
  formatClockSpan,
  formatDay,
  formatDuration,
  formatElapsed,
  formatMinutes,
} from '../time'
import type { Lane, Visit } from '../types'
import type { ScreenProps } from './types'

function stateDetail(
  state: LearnerState,
  userId: number,
  time: number,
  touchpoints: Visit[],
  laneLabel: (id: string) => string,
): string {
  if (state.kind === 'visit') return `${state.objectId ?? ''} · ${formatDuration(state.dwell)} look`
  if (state.kind === 'idle') return 'No movement logged at this moment'
  const last = touchpoints.filter((visit) => visit.userId === userId && visit.end <= time).at(-1)
  return last
    ? `Last touchpoint: ${laneLabel(last.lane)}, ${formatDuration(time - last.end)} earlier`
    : 'No touchpoint yet'
}

function StandardSwimLanes({ dataset, run, touchpoints, minVisitS, openLearner }: ScreenProps) {
  const { meta, sessions } = dataset
  const lanes = useMemo(() => includedLanes(meta), [meta])
  const window = useMemo(() => runWindow(run), [run])
  const coverageWindowS = meta.params.COVERAGE_WINDOW_S ?? 30

  const [hiddenLanes, setHiddenLanes] = useState<Set<string>>(new Set())
  const [overlay, setOverlay] = useState(false)
  const [scrubTime, setScrubTime] = useState((window.start + window.end) / 2)
  const [selected, setSelected] = useState<Visit>()

  const runIdle = useMemo(
    () => dataset.idle.filter((item) => run.sessionIds.includes(item.sessionId)),
    [dataset.idle, run.sessionIds],
  )
  const runVisits = useMemo(
    () => dataset.visits.filter((visit) => visit.runId === run.id),
    [dataset.visits, run.id],
  )
  const coverageLanes = useMemo(
    () =>
      lanes
        .filter((lane) => lane.id === PATIENT_LANE || lane.id === MONITOR_LANE)
        .map((lane) => ({
          lane,
          stats: laneCoverage(touchpoints, lane.id, window, coverageWindowS),
          covered: coveredIntervals(touchpoints, lane.id, window, coverageWindowS),
        })),
    [lanes, touchpoints, window, coverageWindowS],
  )

  const visibleLanes = lanes.filter((lane) => !hiddenLanes.has(lane.id))
  const laneOf = (id: string): Lane | undefined => meta.lanes.find((lane) => lane.id === id)
  const laneLabel = (id: string) => laneOf(id)?.label ?? id
  const activeSelected = touchpoints.includes(selected as Visit) ? selected : undefined

  const caption = (userId: number) => {
    const own = touchpoints.filter((visit) => visit.userId === userId)
    const communication = own.filter((visit) => visit.lane === COMMUNICATION_LANE).length
    const span = learnerSpan(userId, run.id, sessions) ?? window
    return `${formatClockSpan(span.start, span.end)} · ${own.length - communication} clinical + ${communication} communication touchpoints`
  }

  const highlights = useMemo(() => {
    const items: string[] = []
    const patient = coverageLanes.find((row) => row.lane.id === PATIENT_LANE)
    if (patient) {
      items.push(`No one’s head gaze was on the patient for ${patient.stats.uncoveredPct.toFixed(0)}% of the run.`)
    }
    const monitorCounts = run.userIds.map((userId) => {
      const looks = touchpoints.filter((visit) => visit.userId === userId && visit.lane === MONITOR_LANE)
      return { userId, looks }
    })
    const fewest = [...monitorCounts].sort((a, b) => a.looks.length - b.looks.length)[0]
    if (fewest && run.userIds.length > 1) {
      const span = learnerSpan(fewest.userId, run.id, sessions)
      const total = fewest.looks.reduce((sum, visit) => sum + visit.dwell, 0)
      const times = fewest.looks.length === 1 ? 'once' : `${fewest.looks.length} times`
      items.push(
        fewest.looks.length === 0
          ? `Learner ${fewest.userId} had no vital sign monitor touchpoints.`
          : `Learner ${fewest.userId} looked at the vital sign monitor ${times}, for ${formatDuration(total)} in total${span ? `, in a ${formatMinutes(span.end - span.start)} session` : ''}.`,
      )
    }
    const onHeads = touchpoints.filter((visit) => visit.lane === COMMUNICATION_LANE).length
    if (onHeads > 0) {
      items.push(
        `${onHeads} of ${touchpoints.length} touchpoints are on HeadFollower, a proxy for teammates’ heads. Worth confirming what that object is.`,
      )
    }
    return items
  }, [coverageLanes, run, touchpoints, sessions])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <PageTitle>Team swim lanes</PageTitle>
        <p className="m-0 text-[15px] text-muted-foreground">
          {formatDay(run.start)}, {run.date.slice(0, 4)} · {formatClockSpan(window.start, window.end)} ·{' '}
          {run.userIds.length} {run.userIds.length === 1 ? 'learner' : 'learners'} in the room ·{' '}
          {touchpoints.length} touchpoints ≥ {minVisitS.toFixed(1)} s
        </p>
      </div>

      <Panel>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <PanelTitle>Team coverage</PanelTitle>
          <span className="text-[13px] text-muted-foreground">
            Colored where at least one learner touched the lane in the previous {coverageWindowS} s
          </span>
        </div>
        {coverageLanes.map(({ lane, stats, covered }) => (
          <div
            key={lane.id}
            data-testid="coverage-row"
            className="grid grid-cols-[170px_minmax(0,1fr)] items-center gap-x-4 gap-y-1 lg:grid-cols-[170px_minmax(0,1fr)_340px]"
          >
            <div className="flex items-center gap-2 text-[13px]">
              <LaneDot color={lane.color} />
              {lane.label}
            </div>
            <svg
              viewBox="0 0 1000 14"
              preserveAspectRatio="none"
              width="100%"
              height={14}
              role="img"
              aria-label={`${lane.label} coverage over the run`}
            >
              <rect width={1000} height={14} rx={3} fill="#ECEEF2" />
              {covered.map((segment) => {
                const duration = window.end - window.start
                return (
                  <rect
                    key={segment.start}
                    data-testid="covered"
                    x={((segment.start - window.start) / duration) * 1000}
                    width={Math.max(1, ((segment.end - segment.start) / duration) * 1000)}
                    height={14}
                    fill={lane.color}
                  >
                    <title>{`${formatElapsed(segment.start - window.start)}–${formatElapsed(segment.end - window.start)}`}</title>
                  </rect>
                )
              })}
            </svg>
            <div className="text-[13px] tabular-nums max-lg:col-start-2">
              <strong className="font-semibold">No one for {stats.uncoveredPct.toFixed(0)}% of the run</strong>{' '}
              · longest gap {formatMinutes(stats.longestS)}
            </div>
          </div>
        ))}
      </Panel>

      <div className="flex flex-wrap items-start gap-6">
        <Panel className="min-w-[320px] flex-[1_1_760px]">
          <SwimChart
            key={run.id}
            meta={meta}
            lanes={visibleLanes}
            learners={run.userIds}
            window={window}
            touchpoints={touchpoints}
            idle={runIdle}
            ariaLabel={`Swim lanes for ${run.userIds.length} learners over the run`}
            caption={caption}
            overlay={overlay}
            scrubTime={scrubTime}
            onScrub={setScrubTime}
            selected={activeSelected}
            onSelect={setSelected}
            toolbar={
              <>
                {lanes.map((lane) => (
                  <label key={lane.id} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      data-testid="lane-toggle"
                      checked={!hiddenLanes.has(lane.id)}
                      style={{ accentColor: lane.color }}
                      onChange={(event) => {
                        setHiddenLanes((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.delete(lane.id)
                          else next.add(lane.id)
                          return next
                        })
                      }}
                    />
                    <LaneDot color={lane.color} size={8} />
                    {lane.label}
                  </label>
                ))}
                <label className="flex cursor-pointer items-center gap-1.5 border-l pl-4">
                  <input
                    type="checkbox"
                    checked={overlay}
                    style={{ accentColor: '#15181E' }}
                    onChange={(event) => setOverlay(event.target.checked)}
                  />
                  Overlay learners
                </label>
              </>
            }
          />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span>Dot = a look ≥ {minVisitS.toFixed(1)} s · bigger dot = longer look</span>
            <span>Line = order of attention</span>
            {overlay ? (
              run.userIds.map((id, index) => {
                const style = LEARNER_LINES[index % LEARNER_LINES.length]
                return (
                  <span key={id} className="flex items-center gap-1.5">
                    <svg width={24} height={6} aria-hidden>
                      <line
                        x1={0}
                        x2={24}
                        y1={3}
                        y2={3}
                        stroke={style.color}
                        strokeWidth={1.5}
                        strokeDasharray={style.dash}
                      />
                    </svg>
                    Learner {id}
                  </span>
                )
              })
            ) : (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="idle-swatch inline-block h-3 w-[22px] rounded-sm" />
                Idle headset
              </span>
            )}
            <span>Time = minutes into the run</span>
          </div>
        </Panel>

        <aside className="flex min-w-[280px] flex-[1_1_300px] flex-col gap-6">
          <Panel>
            <div className="flex flex-col gap-1" data-testid="scrub-panel">
              <PanelTitle>
                At {formatElapsed(scrubTime - window.start)} · {formatClock(scrubTime)}
              </PanelTitle>
              <span className="text-xs text-muted-foreground">
                Drag the black line to move through the run
              </span>
              <ul className="m-0 mt-2 flex list-none flex-col gap-3 p-0">
                {run.userIds.map((userId) => {
                  const state = stateAt(scrubTime, userId, runVisits, runIdle)
                  const lane = state.kind === 'visit' ? laneOf(state.lane) : undefined
                  return (
                    <li key={userId} className="flex items-start gap-2.5 text-[13px]">
                      <span className="mt-1">
                        <LaneDot color={lane?.color ?? '#C3C8D1'} />
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span>
                          <button
                            type="button"
                            className="cursor-pointer font-semibold text-[#2547C9] hover:text-[#1A3497]"
                            onClick={() => openLearner(userId)}
                          >
                            Learner {userId}
                          </button>{' '}
                          ·{' '}
                          {state.kind === 'visit'
                            ? (lane?.label ?? state.lane)
                            : state.kind === 'idle'
                              ? 'Idle headset'
                              : 'Background'}
                        </span>
                        <span className="break-words text-xs text-muted-foreground">
                          {stateDetail(state, userId, scrubTime, touchpoints, laneLabel)}
                          {state.kind === 'visit' &&
                            state.objectId &&
                            meta.objects[state.objectId]?.verify &&
                            ' ?'}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </Panel>

          <Panel>
            <PanelTitle>Selected touchpoint</PanelTitle>
            {activeSelected ? (
              <div data-testid="selected-touchpoint" className="flex flex-col gap-2 text-[13px]">
                <div className="flex items-center gap-2">
                  <LaneDot color={laneOf(activeSelected.lane)?.color ?? '#C3C8D1'} />
                  <span>
                    <strong className="font-semibold">Learner {activeSelected.userId}</strong> ·{' '}
                    {laneLabel(activeSelected.lane)}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Starts {formatClock(activeSelected.start)} (
                  {formatElapsed(activeSelected.start - window.start)} into the run) ·{' '}
                  {formatDuration(activeSelected.dwell)}
                </span>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {topObjects(activeSelected, 3).map(([objectId, seconds]) => (
                    <li key={objectId} className="flex justify-between gap-3 tabular-nums">
                      <span className="break-all">
                        {objectId}
                        {meta.objects[objectId]?.verify && ' ?'}
                      </span>
                      <span>{seconds.toFixed(1)} s</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <span className="text-[13px] text-muted-foreground">
                Click a dot to see which objects that look landed on.
              </span>
            )}
          </Panel>

          <Panel>
            <PanelTitle>What stands out</PanelTitle>
            <ul data-testid="highlights" className="m-0 flex list-disc flex-col gap-2 pl-4 text-[13px]">
              {highlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>

      <PageFooter dataset={dataset} />
    </div>
  )
}

export function SwimLanes(props: ScreenProps) {
  const [view, setView] = useState<'simplified' | 'standard' | 'advanced'>('standard')
  return (
    <div className="flex flex-col gap-5">
      <div role="group" aria-label="Swim lane view" className="flex flex-wrap gap-1 self-start rounded-lg border bg-white p-1">
        {(['simplified', 'standard', 'advanced'] as const).map((option) => (
          <button key={option} type="button" aria-pressed={view === option}
            className={`min-h-11 cursor-pointer rounded-md px-5 text-sm font-medium capitalize ${view === option ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted'}`}
            onClick={() => setView(option)}>{option}</button>
        ))}
      </div>
      {view === 'standard' ? <StandardSwimLanes {...props} /> : <ObjectSwimLanes key={view + props.dataset.meta.generatedAt} {...props} view={view} />}
    </div>
  )
}
