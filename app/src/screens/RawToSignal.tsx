import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { median } from '../metrics'
import type { ScreenProps } from './types'

const number = new Intl.NumberFormat('en-US')

const OPEN_QUESTIONS = [
  "Is HeadFollower another participant's head? Is RobotHand* the learner's own hand or another player's?",
  'What is ThermometerSnap2? It is the most-looked-at equipment object, and two long idle looks also landed on it.',
  'Can session_id and a scenario ID be logged per run?',
  'Does the headset support true eye tracking, or only the head-forward ray?',
  'Can gaze timestamps be logged with milliseconds and a look start time?',
]

export function RawToSignal({ dataset, run, touchpoints, minVisitS }: ScreenProps) {
  const { funnel, rawSample, meta, sessions } = dataset
  const firstStep = funnel[0]
  const counts = run.userIds.map(
    (userId) => touchpoints.filter((visit) => visit.userId === userId).length,
  )
  const typicalCount = median(counts) ?? 0
  const typicalMinutes =
    median(sessions.filter((item) => item.runId === run.id).map((item) => item.durationMin)) ?? 0

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          How the raw gaze log becomes a clean signal
        </h2>
        <p className="text-sm text-muted-foreground">
          The log records every object the head-gaze ray crosses, including walls and finger bones.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">
              {firstStep ? number.format(firstStep.rows) : '–'}
            </span>{' '}
            raw rows,{' '}
            <span className="text-2xl font-semibold tabular-nums">
              {number.format(Object.keys(meta.objects).length)}
            </span>{' '}
            distinct objects
          </p>
          <Card size="sm">
            <CardHeader>
              <CardTitle>The first {rawSample.length} rows of the log</CardTitle>
            </CardHeader>
            <CardContent>
              <Table className="font-mono text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>user</TableHead>
                    <TableHead>object_id</TableHead>
                    <TableHead className="text-right">gaze_time</TableHead>
                    <TableHead>time_stamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rawSample.map((row, index) => (
                    <TableRow key={index} className="[&>td]:py-0.5">
                      <TableCell>{row.user_id}</TableCell>
                      <TableCell>{row.object_id}</TableCell>
                      <TableCell className="text-right">{row.gaze_time}</TableCell>
                      <TableCell>{row.time_stamp}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <h3 className="font-semibold">What each cleaning step removes</h3>
          <ol className="flex flex-col gap-4">
            {funnel.map((step, index) => (
              <li key={step.step} data-testid="funnel-step" className="text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-medium">
                    {index + 1}. {step.step}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {number.format(step.rows)} rows · {number.format(Math.round(step.seconds))} s
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{
                      width: `${firstStep ? Math.max(0.5, (step.rows / firstStep.rows) * 100) : 0}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{step.note}</p>
              </li>
            ))}
          </ol>

          <Card>
            <CardContent data-testid="final-card">
              <p className="text-sm text-muted-foreground">
                A {typicalMinutes.toFixed(0)}-minute session becomes about
              </p>
              <p className="text-4xl font-semibold tracking-tight tabular-nums">
                {typicalCount.toFixed(0)} touchpoints
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Median per learner in this run, counting looks of at least {minVisitS.toFixed(1)} s.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <details className="rounded-lg border p-4 text-sm">
        <summary className="cursor-pointer font-medium">About the data</summary>
        <p className="mt-2 text-muted-foreground">Source: {meta.source}</p>
        <h3 className="mt-3 font-medium">Open questions for the DISCOVER dev team</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {OPEN_QUESTIONS.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
      </details>
    </section>
  )
}
