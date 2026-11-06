import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  LaneDot,
  PageFooter,
  PageTitle,
  Panel,
  PanelTitle,
  StatCard,
  dateRange,
  sourceName,
  verifyCount,
} from '../components/Page'
import { COMMUNICATION_LANE, includedLanes } from '../metrics'
import { formatFileSize, formatHours } from '../time'
import type { FileControls, ScreenProps } from './types'

const number = new Intl.NumberFormat('en-US')

const LANE_NOTES: Record<string, string> = {
  Reference: 'Weight-based code sheets',
  'Patient assessment': 'Heart and lung sound points, pulses, cap refill, stethoscope, penlight',
  'Vital sign monitor': 'RR, SpO2 and EKG displays, monitor bar, HFNC screen',
  'Equipment & interventions': 'O2 devices, airway, bag-mask, IV bags, medications',
  Communication: 'Teammates’ heads (to verify)',
}

const BACKGROUND_LABELS: Record<string, string> = {
  Environment: 'Room and invisible colliders',
  Self: 'Own hands and body',
  Bed: 'Bed hardware',
  System: 'UI and loading screens',
  Unmapped: 'Not in the lane map',
}

const OPEN_QUESTIONS = [
  "Is HeadFollower another participant's head? Is RobotHand* the learner's own hand or another player's?",
  'What is ThermometerSnap2? It is the most-looked-at equipment object, and two long idle looks also landed on it.',
  'Can session_id and a scenario ID be logged per run?',
  'Does the headset support true eye tracking, or only the head-forward ray?',
  'Can gaze timestamps be logged with milliseconds and a look start time?',
]

export function UploadClean({ dataset, run, touchpoints, minVisitS, files, openLanes }: ScreenProps) {
  const { funnel, rawSample, meta, visits, sessions } = dataset
  const raw = funnel[0]
  const afterTestUser = funnel[1]
  const afterIdle = funnel[2]
  const idleShare =
    raw && afterTestUser && afterIdle
      ? (afterTestUser.seconds - afterIdle.seconds) / raw.seconds
      : 0
  const idleRows = afterTestUser && afterIdle ? afterTestUser.rows - afterIdle.rows : 0
  const allTouchpoints = useMemo(
    () => visits.filter((visit) => visit.dwell >= minVisitS).length,
    [visits, minVisitS],
  )
  const runRawRows = sessions
    .filter((session) => session.runId === run.id)
    .reduce((sum, session) => sum + session.rawRows, 0)
  const clinical = touchpoints.filter((visit) => visit.lane !== COMMUNICATION_LANE).length
  const lanes = includedLanes(meta)

  const objectsPerLane = new Map<string, number>()
  for (const info of Object.values(meta.objects)) {
    objectsPerLane.set(info.lane, (objectsPerLane.get(info.lane) ?? 0) + 1)
  }
  const objectCount = Object.keys(meta.objects).length
  const background = meta.lanes.filter(
    (lane) => !lane.include && (objectsPerLane.get(lane.id) ?? 0) > 0,
  )
  const firstRow = rawSample[0]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <PageTitle>Upload and clean</PageTitle>
        <p className="m-0 text-[15px] text-muted-foreground">
          Drop in the platform’s gaze export. Every cleaning step runs automatically, so no one has
          to watch the session and take notes.
        </p>
      </div>

      <UploadPanel
        files={files}
        gazeName={files.gaze?.name ?? sourceName(meta.source)}
        gazeContents={`${number.format(raw?.rows ?? 0)} rows · ${new Set(sessions.map((item) => item.userId)).size} learners · ${dateRange(dataset)}`}
        laneMapContents={`${objectCount} objects → ${lanes.length} lanes · ${verifyCount(dataset)} to verify`}
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          value={number.format(raw?.rows ?? 0)}
          label="raw gaze rows"
          note="one row each time the ray leaves an object"
        />
        <StatCard
          value={objectCount}
          label="tracked objects"
          note="down to finger bones and invisible colliders"
        />
        <StatCard
          value={`${Math.round(idleShare * 100)}%`}
          label="of logged time was an idle headset"
          note={`${idleRows} rows longer than ${meta.params.IDLE_MAX_S} s`}
        />
        <StatCard
          value={number.format(allTouchpoints)}
          label="touchpoints after cleaning"
          note={`looks ≥ ${minVisitS.toFixed(1)} s on the ${lanes.length} lanes`}
        />
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <Panel className="flex-[1_1_520px]">
          <div className="flex flex-col gap-1">
            <PanelTitle>Raw export</PanelTitle>
            <span className="text-[13px] text-muted-foreground">
              The first rows of the {firstRow ? firstRow.time_stamp.slice(0, 16) : ''} team run.
              Highlighted rows are idle headset periods; most looks last a fraction of a second.
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-[#EEF0F3]">
            <table className="w-full border-collapse font-mono text-xs tabular-nums">
              <thead>
                <tr className="[&>th]:border-b [&>th]:px-2.5 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold [&>th]:text-muted-foreground">
                  <th>user_id</th>
                  <th>session_id</th>
                  <th>object_id</th>
                  <th className="text-right!">gaze_time</th>
                  <th>time_stamp</th>
                </tr>
              </thead>
              <tbody>
                {rawSample.map((row, index) => (
                  <tr
                    key={index}
                    data-testid="raw-row"
                    className={`[&>td]:border-b [&>td]:border-[#EEF0F3] [&>td]:px-2.5 [&>td]:py-1.5 ${
                      row.gaze_time > meta.params.IDLE_MAX_S ? 'bg-[#FDECEC]' : ''
                    }`}
                  >
                    <td>{row.user_id}</td>
                    <td>{row.session_id}</td>
                    <td>{row.object_id}</td>
                    <td className="text-right">{Number(row.gaze_time.toFixed(2))}</td>
                    <td>{row.time_stamp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="text-xs text-muted-foreground">
            session_id is always 0 in the export, so sessions are rebuilt from time gaps.
          </span>
        </Panel>

        <Panel className="flex-[1_1_460px] gap-4">
          <div className="flex flex-col gap-1">
            <PanelTitle>Cleaning pipeline</PanelTitle>
            <span className="text-[13px] text-muted-foreground">
              All learners and dates in the file. Bars show rows left compared with the raw export.
            </span>
          </div>
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {funnel.map((step, index) => {
              const isLast = index === funnel.length - 1
              const rows = isLast ? allTouchpoints : step.rows
              const share = raw ? (rows / raw.rows) * 100 : 0
              const narrowed = index >= funnel.length - 2
              return (
                <li key={step.step} data-testid="funnel-step" className="flex items-start gap-3.5">
                  <span
                    className={`inline-flex size-[26px] shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      isLast ? 'bg-primary text-white' : 'bg-[#E7E9EE]'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 grow flex-col gap-1.5">
                    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                      <span className="text-sm font-semibold">{step.step}</span>
                      <span className="text-[13px] tabular-nums">
                        {isLast
                          ? `${number.format(rows)} touchpoints ≥ ${minVisitS.toFixed(1)} s`
                          : `${number.format(rows)} rows · ${formatHours(step.seconds)}`}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-sm bg-[#EEF0F3]">
                      <div
                        className={`h-1.5 rounded-sm ${narrowed ? 'bg-primary' : 'bg-[#9AA1AD]'}`}
                        style={{ width: `${Math.max(0.5, share)}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{step.note}</span>
                  </div>
                </li>
              )
            })}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-muted px-4 py-3.5">
            <span data-testid="run-summary" className="text-sm">
              Selected run:{' '}
              <strong className="font-semibold">
                {number.format(runRawRows)} raw rows → {number.format(touchpoints.length)} touchpoints
              </strong>
              , {number.format(clinical)} on clinical lanes.
            </span>
            <Button size="lg" onClick={openLanes}>
              Open team swim lanes →
            </Button>
          </div>
        </Panel>
      </div>

      <Panel className="gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <PanelTitle>
            Lane mapping: {objectCount} objects → {lanes.length} lanes
          </PanelTitle>
          <span className="text-[13px] text-muted-foreground">
            Lane order and colors follow the PI’s hand-drawn swim lane maps.
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {lanes.map((lane) => (
            <div
              key={lane.id}
              data-testid="lane-card"
              className="flex flex-col gap-1.5 rounded-[10px] px-4 py-3.5"
              style={{ background: lane.band }}
            >
              <div className="flex items-center gap-2">
                <LaneDot color={lane.color} />
                <span className="text-sm font-semibold">{lane.id}</span>
              </div>
              <span className="text-[13px] tabular-nums">
                {objectsPerLane.get(lane.id) ?? 0}{' '}
                {objectsPerLane.get(lane.id) === 1 ? 'object' : 'objects'}
              </span>
              <span className="text-xs text-[#3F4552]">{LANE_NOTES[lane.id]}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
          <span>Set aside as background:</span>
          {background.map((lane) => (
            <span key={lane.id}>
              {BACKGROUND_LABELS[lane.id] ?? lane.label} · {objectsPerLane.get(lane.id)}
            </span>
          ))}
        </div>
      </Panel>

      <details className="rounded-xl border bg-white px-6 py-4 text-sm">
        <summary className="cursor-pointer font-medium">About the data</summary>
        <h3 className="mt-3 font-medium">Open questions for the DISCOVER dev team</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {OPEN_QUESTIONS.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
      </details>

      <PageFooter dataset={dataset} />
    </div>
  )
}

function StatusPill({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[#E3F3E8] px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-[#1E6B3A]">
      {children}
    </span>
  )
}

function UploadPanel({
  files,
  gazeName,
  gazeContents,
  laneMapContents,
}: {
  files: FileControls
  gazeName: string
  gazeContents: string
  laneMapContents: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const cell = 'border-b border-[#EEF0F3] px-3.5 py-3 align-middle text-[13px]'
  const heading = 'border-b px-3.5 py-2.5 text-left text-xs font-semibold text-muted-foreground'

  return (
    <Panel className="gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <PanelTitle>Upload data</PanelTitle>
        <span className="text-[13px] text-muted-foreground">
          Processed in your browser. Nothing leaves this computer.
        </span>
      </div>

      <label
        data-testid="drop-zone"
        className={`relative flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-dashed px-6 py-8 text-center ${
          dragOver ? 'border-primary bg-[#E7E9EE]' : 'border-[#AEB4BF] bg-muted'
        }`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          files.addFiles([...event.dataTransfer.files])
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#15181E"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 15V4" />
          <path d="M7.5 8.5 12 4l4.5 4.5" />
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
        <span className="text-base font-semibold">
          {files.reading ? 'Reading…' : 'Drag a gaze log here'}
        </span>
        <span className="text-[13px] text-muted-foreground">or</span>
        <span className="inline-flex min-h-11 items-center rounded-lg bg-primary px-[18px] text-sm font-medium text-white">
          Browse files
        </span>
        <span className="text-xs text-muted-foreground">
          .csv gaze export or lane map · up to 50 MB each
        </span>
        <input
          ref={input}
          data-testid="upload-input"
          type="file"
          accept=".csv,.tsv,text/csv"
          multiple
          className="absolute size-px opacity-0"
          disabled={files.reading}
          onChange={(event) => {
            const chosen = [...(event.target.files ?? [])]
            // Clear it so choosing the same file again still fires a change.
            event.target.value = ''
            if (chosen.length > 0) files.addFiles(chosen)
          }}
        />
      </label>

      {files.error && (
        <p
          role="alert"
          data-testid="upload-error"
          className="m-0 rounded-lg bg-[#FDECEC] px-3.5 py-2.5 text-sm text-[#8A1C1C]"
        >
          {files.error}
        </p>
      )}
      {files.note && (
        <p data-testid="upload-note" className="m-0 rounded-lg bg-muted px-3.5 py-2.5 text-sm">
          {files.note}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th scope="col" className={heading}>File</th>
              <th scope="col" className={heading}>Type</th>
              <th scope="col" className={heading}>Contents</th>
              <th scope="col" className={heading}>Status</th>
              <th scope="col" className={`${heading} text-right`}>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr data-testid="file-row">
              <td className={cell}>
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold break-all">{gazeName}</span>
                  {files.gaze && (
                    <span className="text-xs text-muted-foreground">{formatFileSize(files.gaze.size)}</span>
                  )}
                </div>
              </td>
              <td className={cell}>Gaze log</td>
              <td className={`${cell} text-muted-foreground`}>{gazeContents}</td>
              <td className={cell}>
                <StatusPill>{files.gaze ? 'Processed' : 'Built in'}</StatusPill>
              </td>
              <td className={`${cell} text-right`}>
                {files.gaze && (
                  <Button
                    variant="outline"
                    aria-label={`Remove ${files.gaze.name}`}
                    onClick={files.removeGaze}
                  >
                    Remove
                  </Button>
                )}
              </td>
            </tr>
            <tr data-testid="file-row">
              <td className={cell}>
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold break-all">{files.laneMap?.name ?? 'lane_map.csv'}</span>
                  {files.laneMap && (
                    <span className="text-xs text-muted-foreground">{formatFileSize(files.laneMap.size)}</span>
                  )}
                </div>
              </td>
              <td className={cell}>Lane map</td>
              <td className={`${cell} text-muted-foreground`}>{laneMapContents}</td>
              <td className={cell}>
                <StatusPill>{files.laneMap ? 'Loaded' : 'Built in'}</StatusPill>
              </td>
              <td className={`${cell} text-right`}>
                <div className="flex justify-end gap-2">
                  {files.laneMap && (
                    <Button variant="outline" onClick={files.removeLaneMap}>
                      Use built-in
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    aria-label="Replace lane map"
                    onClick={() => input.current?.click()}
                  >
                    Replace
                  </Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap justify-between gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <span>Gaze log columns: user_id, session_id, object_id, gaze_time, time_stamp</span>
        <span>Scenario and vitals files come after the MVP</span>
      </div>
    </Panel>
  )
}
