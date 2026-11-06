import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { LaneDot, PageFooter, PageTitle, Panel, PanelTitle, StatCard } from '../components/Page'
import { SwimChart } from '../components/SwimChart'
import {
  COMMUNICATION_LANE,
  MONITOR_LANE,
  PATIENT_LANE,
  includedLanes,
  learnerProfile,
  learnerSpan,
  runWindow,
  topObjects,
  unionSeconds,
  type LearnerProfile,
} from '../metrics'
import { formatClock, formatDay, formatDuration, formatElapsed, formatMinutes } from '../time'
import type { Lane } from '../types'
import type { ScreenProps } from './types'
import { ClaudeReportContent } from '../components/ClaudeReport'

const number = new Intl.NumberFormat('en-US')

/** Short column names for the transition grid. */
const SHORT_LANES: Record<string, string> = {
  'Patient assessment': 'Patient',
  'Vital sign monitor': 'Monitor',
  'Equipment & interventions': 'Equipment',
  Communication: 'Team',
}

/** Readable names for monitor objects. Anything else shows its object_id. */
const MONITOR_NAMES: Record<string, string> = {
  ekg: 'EKG display',
  SPO2: 'SpO2 display',
  RR: 'RR display',
  MonitorBar: 'Monitor bar',
  HFNC_Screen: 'HFNC screen',
}

const noteKey = (runId: string, userId: number) => `discover-note:${runId}:${userId}`

export function RecordedReportCard({ dataset, run, touchpoints, minVisitS, learnerId, setLearnerId }: ScreenProps) {
  const { meta, sessions } = dataset
  const lanes = useMemo(() => includedLanes(meta), [meta])
  const window = useMemo(() => runWindow(run), [run])
  const userId = run.userIds.includes(learnerId) ? learnerId : run.userIds[0]

  const profile = useMemo(
    () => learnerProfile(userId, run, touchpoints, sessions, lanes),
    [userId, run, touchpoints, sessions, lanes],
  )
  const own = useMemo(() => touchpoints.filter((visit) => visit.userId === userId), [touchpoints, userId])
  const ownIdle = useMemo(
    () =>
      dataset.idle.filter(
        (item) => item.userId === userId && run.sessionIds.includes(item.sessionId),
      ),
    [dataset.idle, userId, run.sessionIds],
  )

  const span = learnerSpan(userId, run.id, sessions) ?? window
  const rawRows = sessions
    .filter((session) => session.userId === userId && session.runId === run.id)
    .reduce((sum, session) => sum + session.rawRows, 0)
  // Idle looks can overlap by a moment or more, so add them up without counting that twice.
  const idleS = unionSeconds(ownIdle)
  const communication = profile.byLane.get(COMMUNICATION_LANE)
  const clinical = own.filter((visit) => visit.lane !== COMMUNICATION_LANE)
  const clinicalS = clinical.reduce((sum, visit) => sum + visit.dwell, 0)
  const monitor = profile.byLane.get(MONITOR_LANE)
  const patient = profile.byLane.get(PATIENT_LANE)
  const glances = own.filter((visit) => visit.lane === MONITOR_LANE)
  const meanS = own.length > 0 ? profile.totalDwellS / own.length : 0
  const maxDwell = Math.max(0, ...lanes.map((lane) => profile.byLane.get(lane.id)?.dwellS ?? 0))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-muted-foreground">Report card</span>
          <PageTitle>Learner {userId}</PageTitle>
          <p data-testid="report-summary" className="m-0 text-[15px] text-muted-foreground tabular-nums">
            {formatDay(run.start)}, {run.date.slice(0, 4)} · session {formatClock(span.start)}–
            {formatClock(span.end)} · {formatMinutes(span.end - span.start)} · idle {formatMinutes(idleS)} ·{' '}
            {number.format(rawRows)} raw rows
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <div role="group" aria-label="Choose learner" className="inline-flex overflow-hidden rounded-lg border border-input">
            {run.userIds.map((id, index) => (
              <button
                key={id}
                type="button"
                aria-pressed={id === userId}
                className={`inline-flex min-h-11 cursor-pointer items-center px-3.5 text-sm ${
                  index > 0 ? 'border-l border-input' : ''
                } ${id === userId ? 'bg-primary font-semibold text-white' : 'bg-white font-medium'}`}
                onClick={() => setLearnerId(id)}
              >
                Learner {id}
              </button>
            ))}
          </div>
          <Button size="lg" className="min-h-11" onClick={() => globalThis.print()}>
            Export report card (PDF)
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          value={clinical.length}
          label="clinical touchpoints"
          note={`${formatDuration(clinicalS)} on patient, monitor, equipment and reference`}
        />
        <StatCard
          value={communication?.count ?? 0}
          label="touchpoints on teammates"
          note="Communication lane (to verify)"
        />
        <StatCard
          value={formatMinutes(monitor?.firstS)}
          label="to first monitor look"
          note="from the start of the session"
        />
        <StatCard
          value={formatMinutes(monitor?.longestGapS)}
          label="longest stretch with no monitor look"
          note={`longest with no patient look: ${formatMinutes(patient?.longestGapS)}`}
        />
      </div>

      <Panel>
        <PanelTitle>Attention over the session</PanelTitle>
        <SwimChart
          key={`${run.id}-${userId}`}
          meta={meta}
          lanes={lanes}
          learners={[userId]}
          window={window}
          touchpoints={own}
          idle={ownIdle}
          ariaLabel={`Learner ${userId} swim lanes over the session`}
          showLearnerNames={false}
          laneHeight={30}
        />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span>Dot = a look ≥ {minVisitS.toFixed(1)} s · bigger dot = longer look</span>
          <span>Line = order of attention</span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="idle-swatch inline-block h-3 w-[22px] rounded-sm" />
            Idle headset
          </span>
        </div>
      </Panel>

      <div className="flex flex-wrap items-start gap-6">
        <Panel className="flex-[1_1_420px] gap-1.5">
          <PanelTitle>Key measures</PanelTitle>
          <span className="text-xs text-muted-foreground">
            Descriptive only. Targets to compare against come after the MVP.
          </span>
          <dl className="m-0 mt-1.5">
            {[
              ['First look at the patient', formatMinutes(patient?.firstS)],
              ['First look at the monitor', formatMinutes(monitor?.firstS)],
              ['Longest with no monitor look', formatMinutes(monitor?.longestGapS)],
              ['Longest with no patient look', formatMinutes(patient?.longestGapS)],
              ['Monitor ↔ patient switches', String(profile.monitorPatientSwitches)],
              ['Mean touchpoint length', own.length > 0 ? `${meanS.toFixed(1)} s` : '—'],
              ['Idle headset time', formatMinutes(idleS)],
            ].map(([term, value]) => (
              <div
                key={term}
                data-testid="key-measure"
                className="flex justify-between gap-3 border-t border-[#EEF0F3] py-[11px] text-sm"
              >
                <dt className="text-muted-foreground">{term}</dt>
                <dd className="m-0 font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel className="flex-[1_1_420px] gap-1.5">
          <PanelTitle>Monitor glances ({glances.length})</PanelTitle>
          <span className="text-xs text-muted-foreground">
            Looks of {minVisitS.toFixed(1)} s or more at any part of the vital sign monitor
          </span>
          {glances.length === 0 ? (
            <p className="m-0 mt-1.5 border-t border-[#EEF0F3] pt-2.5 text-[13px] text-muted-foreground">
              No monitor looks at this threshold.
            </p>
          ) : (
            <ul className="m-0 mt-1.5 list-none p-0">
              {glances.map((visit) => {
                const objectId = topObjects(visit, 1)[0]?.[0] ?? ''
                return (
                  <li
                    key={visit.start}
                    data-testid="monitor-glance"
                    className="flex justify-between gap-3 border-t border-[#EEF0F3] py-[9px] text-[13px]"
                  >
                    <span className="tabular-nums">
                      {formatClock(visit.start)}{' '}
                      <span className="text-muted-foreground">
                        · {formatElapsed(visit.start - window.start)} into run
                      </span>
                    </span>
                    <span>
                      {MONITOR_NAMES[objectId] ?? objectId} ·{' '}
                      <span className="tabular-nums">{formatDuration(visit.dwell)}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <Panel className="flex-[1_1_420px] gap-3.5">
          <PanelTitle>Time per lane</PanelTitle>
          <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
            {lanes.map((lane) => {
              const stats = profile.byLane.get(lane.id)
              const dwell = stats?.dwellS ?? 0
              return (
                <li key={lane.id} data-testid="lane-time" className="flex flex-col gap-1">
                  <div className="flex justify-between gap-2 text-[13px]">
                    <span className="inline-flex items-center gap-2">
                      <LaneDot color={lane.color} />
                      {lane.label}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatDuration(dwell)} · {stats?.count ?? 0}{' '}
                      {stats?.count === 1 ? 'touchpoint' : 'touchpoints'} · first at{' '}
                      {formatMinutes(stats?.firstS)}
                    </span>
                  </div>
                  <div className="h-2 rounded bg-[#EEF0F3]">
                    <div
                      className="h-2 rounded"
                      style={{
                        width: `${maxDwell > 0 ? Math.max(0.5, (dwell / maxDwell) * 100) : 0.5}%`,
                        background: lane.color,
                      }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
          <span className="text-xs text-muted-foreground">
            {profile.activeSharePct.toFixed(1)}% of this learner’s active time was on these lanes.
          </span>
        </Panel>

        <Panel className="flex-[1_1_380px]">
          <PanelTitle>Where attention moved next</PanelTitle>
          <span className="text-xs text-muted-foreground">Rows = from, columns = to</span>
          <TransitionGrid profile={profile} lanes={lanes} />
        </Panel>
      </div>

    </div>
  )
}

function TransitionGrid({ profile, lanes }: { profile: LearnerProfile; lanes: Lane[] }) {
  const count = (from: string, to: string) => profile.transitions.get(from)?.get(to) ?? 0
  const highest = Math.max(
    1,
    ...lanes.flatMap((from) =>
      lanes.filter((to) => to.id !== from.id).map((to) => count(from.id, to.id)),
    ),
  )
  return (
    <div
      className="grid items-center gap-1.5"
      style={{ gridTemplateColumns: `112px repeat(${lanes.length}, minmax(0, 1fr))` }}
    >
      <div />
      {lanes.map((lane) => (
        <div key={lane.id} className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
          <LaneDot color={lane.color} size={8} />
          {SHORT_LANES[lane.id] ?? lane.label}
        </div>
      ))}
      {lanes.map((from) => (
        <div key={from.id} className="contents">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <LaneDot color={from.color} size={8} />
            {from.label}
          </div>
          {lanes.map((to) => {
            if (from.id === to.id) {
              return (
                <div
                  key={to.id}
                  className="flex aspect-square items-center justify-center rounded-md bg-muted text-[13px] text-[#9AA1AD]"
                >
                  ·
                </div>
              )
            }
            const value = count(from.id, to.id)
            const strength = 0.08 + 0.82 * (value / highest)
            return (
              <div
                key={to.id}
                data-testid="transition-cell"
                title={`${from.label} → ${to.label}: ${value}`}
                className="flex aspect-square items-center justify-center rounded-md text-[13px] font-semibold tabular-nums"
                style={{
                  background: `rgba(21, 24, 30, ${strength.toFixed(2)})`,
                  color: strength > 0.6 ? '#FFFFFF' : '#15181E',
                }}
              >
                {value}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function DebriefNotes({ runId, userId }: { runId: string; userId: number }) {
  const [text, setText] = useState(() => localStorage.getItem(noteKey(runId, userId)) ?? '')
  const [saved, setSaved] = useState(false)
  return (
    <Panel>
      <label htmlFor="debrief-notes" className="font-heading text-[17px] font-semibold">
        Debrief notes
      </label>
      <textarea
        id="debrief-notes"
        rows={4}
        value={text}
        placeholder={`What to talk about with Learner ${userId} in the debrief`}
        className="resize-y rounded-lg border border-input p-3 text-sm"
        onChange={(event) => {
          setText(event.target.value)
          setSaved(false)
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <span className="text-xs text-muted-foreground">
          {saved ? 'Saved.' : 'Saved in this browser, for this learner and this run'}
        </span>
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            localStorage.setItem(noteKey(runId, userId), text)
            setSaved(true)
          }}
        >
          Save note
        </Button>
      </div>
    </Panel>
  )
}

export function ReportCard(props: ScreenProps) {
  const { files, dataset, run, learnerId, setLearnerId } = props
  const learners = files.analysis?.learners.map((learner) => learner.userId) ?? dataset.summary?.users.map((user) => user.userId) ?? run.userIds
  const userId = learners.includes(learnerId) ? learnerId : learners[0]
  const hasPair = Object.values(files.matching).some(Boolean)
  const reason = !files.analysis ? 'Upload a learner gaze log in tab 1 to analyze it with Python.'
    : !files.analysis.ideals.length ? 'Upload an ideal-user CSV in tab 1 to enable AI reports.'
    : !hasPair ? 'Choose at least one learner/ideal pair in tab 1.' : undefined
  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><PageTitle>Report card - Learner {userId}</PageTitle><p className="mb-0 text-sm text-muted-foreground">Claude comparison with the selected expert benchmark - whole recording</p></div>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <label className="text-sm">Learner <select className="ml-2 min-h-11 rounded-lg border bg-white px-3" value={userId} onChange={(event) => setLearnerId(Number(event.target.value))}>
          {learners.map((id) => <option key={id} value={id}>Learner {id}</option>)}
        </select></label>
        <Button disabled={!!reason || files.generating || files.reading} onClick={files.generateReport}>
          {files.generating ? 'Generating report...' : files.report ? 'Regenerate report' : 'Generate report'}
        </Button>
        <Button variant="outline" onClick={() => globalThis.print()}>Export report card (PDF)</Button>
      </div>
    </div>
    <Panel>
      <p className="m-0 text-sm">{reason ?? 'Generate sends this recording?s learner/ideal comparison to Claude. It does not run automatically.'}</p>
      <p className="m-0 text-xs text-muted-foreground">The AI report covers the whole recording. The team run picker and touchpoint slider only affect the recorded metrics below.</p>
      {files.generating && <p role="status" className="m-0 text-sm">Claude is generating the report. This can take several minutes; you can switch learners or tabs while it runs.</p>}
      {files.reportError && <p role="alert" className="m-0 text-sm text-red-700">{files.reportError} Your last successful report is kept. For an expired recording, use Reprocess files in tab 1.</p>}
    </Panel>
    {files.report && <ClaudeReportContent report={files.report} userKey={'user' + userId} />}
    <details className="rounded-xl border bg-white p-5">
      <summary className="cursor-pointer font-semibold">Recorded metrics - selected team run</summary>
      <div className="mt-5">{run.userIds.includes(userId) ? <RecordedReportCard {...props} learnerId={userId} />
        : <p className="text-sm text-muted-foreground">This learner has no session in the selected team run. Choose another run to see their recorded metrics.</p>}</div>
    </details>
    <DebriefNotes key={run.id + '-' + userId} runId={run.id} userId={userId} />
    <PageFooter dataset={dataset} />
  </div>
}
