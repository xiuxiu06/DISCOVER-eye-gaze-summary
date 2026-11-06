import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { LEARNER_LINES, SwimChart } from '../components/SwimChart'
import {
  MONITOR_LANE,
  PATIENT_LANE,
  includedLanes,
  laneCoverage,
  runWindow,
  stateAt,
} from '../metrics'
import { formatClock, formatDuration, formatElapsed } from '../time'
import type { ScreenProps } from './types'

export function SwimLanes({ dataset, run, touchpoints }: ScreenProps) {
  const [overlay, setOverlay] = useState(false)
  const [scrubTime, setScrubTime] = useState<number>()

  const { meta } = dataset
  const lanes = useMemo(() => includedLanes(meta), [meta])
  const window = useMemo(() => runWindow(run), [run])
  const coverageWindowS = meta.params.COVERAGE_WINDOW_S ?? 30

  const runIdle = useMemo(
    () => dataset.idle.filter((item) => run.sessionIds.includes(item.sessionId)),
    [dataset.idle, run.sessionIds],
  )
  const runVisits = useMemo(
    () => dataset.visits.filter((visit) => visit.runId === run.id),
    [dataset.visits, run.id],
  )
  const coverage = useMemo(
    () =>
      lanes
        .filter((lane) => lane.id === PATIENT_LANE || lane.id === MONITOR_LANE)
        .map((lane) => ({
          lane,
          coverage: laneCoverage(touchpoints, lane.id, window, coverageWindowS),
        })),
    [lanes, touchpoints, window, coverageWindowS],
  )
  const activeScrub =
    scrubTime !== undefined && scrubTime >= window.start && scrubTime <= window.end
      ? scrubTime
      : undefined

  return (
    <section className="flex min-h-[460px] flex-1 flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Where each learner's head gaze went over time
        </h2>
        <p className="text-sm text-muted-foreground">
          Each dot is a touchpoint. Bigger dots are longer looks.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 gap-5">
        <SwimChart
          key={run.id}
          meta={meta}
          lanes={lanes}
          learners={run.userIds}
          window={window}
          touchpoints={touchpoints}
          idle={runIdle}
          coverage={coverage}
          overlay={overlay}
          scrubTime={activeScrub}
          onScrub={setScrubTime}
          toolbar={
            <>
              <Button
                variant={overlay ? 'default' : 'outline'}
                size="sm"
                aria-pressed={overlay}
                onClick={() => setOverlay((current) => !current)}
              >
                Overlay
              </Button>
              {overlay ? (
                <ul className="flex flex-wrap gap-3">
                  {run.userIds.map((id, index) => {
                    const style = LEARNER_LINES[index % LEARNER_LINES.length]
                    return (
                      <li key={id} className="flex items-center gap-1.5">
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
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="idle-swatch inline-block h-3 w-5 border" />
                  Idle headset
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-3 w-5 bg-[#C62828]" />
                No learner looked in the last {coverageWindowS} s
              </span>
            </>
          }
        />

        <aside className="flex w-56 shrink-0 flex-col gap-5 overflow-y-auto text-sm">
          <div>
            <h3 className="font-semibold">Time nobody watched</h3>
            <dl className="mt-2 space-y-2.5">
              {coverage.map((row) => (
                <div key={row.lane.id} data-testid="coverage-stat">
                  <dt className="text-xs text-muted-foreground">{row.lane.label}</dt>
                  <dd className="tabular-nums">
                    <span className="text-lg font-semibold">
                      {row.coverage.uncoveredPct.toFixed(0)}%
                    </span>{' '}
                    of run
                    <div className="text-xs text-muted-foreground">
                      Longest stretch {formatDuration(row.coverage.longestS)}
                    </div>
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="border-t pt-4" data-testid="scrub-panel">
            {activeScrub === undefined ? (
              <p className="text-xs text-muted-foreground">
                Click the chart to see what each learner was looking at in that moment.
              </p>
            ) : (
              <>
                <h3 className="font-semibold tabular-nums">
                  At {formatElapsed(activeScrub - window.start)}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {formatClock(activeScrub)}
                  </span>
                </h3>
                <ul className="mt-2 space-y-2.5">
                  {run.userIds.map((userId) => {
                    const state = stateAt(activeScrub, userId, runVisits, runIdle)
                    const lane =
                      state.kind === 'visit'
                        ? meta.lanes.find((item) => item.id === state.lane)
                        : undefined
                    return (
                      <li key={userId}>
                        <div className="text-xs text-muted-foreground">Learner {userId}</div>
                        {state.kind === 'visit' ? (
                          <div className="flex items-start gap-1.5">
                            <span
                              aria-hidden
                              className="mt-1.5 size-2 shrink-0 rounded-full"
                              style={{ background: lane?.color }}
                            />
                            <span className="min-w-0 break-words">
                              {lane?.label ?? state.lane}
                              {state.objectId && (
                                <span className="block text-xs text-muted-foreground">
                                  {state.objectId}
                                  {meta.objects[state.objectId]?.verify && ' ?'}
                                </span>
                              )}
                            </span>
                          </div>
                        ) : (
                          <div className="text-muted-foreground">
                            {state.kind === 'idle' ? 'Idle headset' : 'Background'}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}
