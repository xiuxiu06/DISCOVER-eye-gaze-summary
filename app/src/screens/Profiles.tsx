import { interpolateRgb } from 'd3'
import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  MONITOR_LANE,
  PATIENT_LANE,
  includedLanes,
  learnerProfile,
  type LearnerProfile,
} from '../metrics'
import { formatDuration, formatElapsed } from '../time'
import type { Lane } from '../types'
import type { ScreenProps } from './types'

const heat = interpolateRgb('#EEF2F6', '#1F3A5F')

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export function Profiles({ dataset, run, touchpoints }: ScreenProps) {
  const lanes = useMemo(() => includedLanes(dataset.meta), [dataset.meta])
  const profiles = useMemo(
    () =>
      run.userIds.map((userId) =>
        learnerProfile(userId, run, touchpoints, dataset.sessions, lanes),
      ),
    [run, touchpoints, dataset.sessions, lanes],
  )
  // One colour scale across learners, so their heatmaps can be compared.
  const maxTransitions = Math.max(
    1,
    ...profiles.flatMap((profile) =>
      [...profile.transitions.values()].flatMap((row) => [...row.values()]),
    ),
  )

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          How each learner's attention was spread across the room
        </h2>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {lanes.map((lane) => (
            <li key={lane.id} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-sm" style={{ background: lane.color }} />
              {lane.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {profiles.map((profile) => (
          <LearnerCard
            key={profile.userId}
            profile={profile}
            lanes={lanes}
            maxTransitions={maxTransitions}
          />
        ))}
      </div>

      <div>
        <h3 className="mb-2 font-semibold">Learners side by side</h3>
        <ComparisonTable profiles={profiles} lanes={lanes} />
      </div>
    </section>
  )
}

function LearnerCard({
  profile,
  lanes,
  maxTransitions,
}: {
  profile: LearnerProfile
  lanes: Lane[]
  maxTransitions: number
}) {
  const monitor = profile.byLane.get(MONITOR_LANE)?.count ?? 0
  const patient = profile.byLane.get(PATIENT_LANE)?.count ?? 0
  return (
    <Card data-testid="learner-card">
      <CardHeader>
        <CardTitle>Learner {profile.userId}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Share of time on the five lanes</p>
          <div className="mt-1.5 flex h-5 gap-0.5">
            {lanes.map((lane) => {
              const dwell = profile.byLane.get(lane.id)?.dwellS ?? 0
              if (dwell === 0) return null
              const share = (dwell / profile.totalDwellS) * 100
              return (
                <div
                  key={lane.id}
                  data-testid="share-segment"
                  title={`${lane.label}: ${share.toFixed(0)}% (${formatDuration(dwell)})`}
                  className="rounded-[2px]"
                  style={{ flexGrow: dwell, flexBasis: 0, background: lane.color }}
                />
              )
            })}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
            {profile.activeSharePct.toFixed(1)}% of active time was on these lanes
          </p>
        </div>

        <p>
          Looked at the monitor {plural(monitor, 'time')} and the patient {plural(patient, 'time')}.
          Switched between them {plural(profile.monitorPatientSwitches, 'time')}.
        </p>

        <Heatmap profile={profile} lanes={lanes} maxTransitions={maxTransitions} />

        {profile.inferredHints.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Inferred scenario hint: {profile.inferredHints.join(', ')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function Heatmap({
  profile,
  lanes,
  maxTransitions,
}: {
  profile: LearnerProfile
  lanes: Lane[]
  maxTransitions: number
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">Where they looked next (row → column)</p>
      <div
        className="mt-1.5 grid gap-0.5 text-[11px] tabular-nums"
        style={{ gridTemplateColumns: `1.25rem repeat(${lanes.length}, minmax(0, 1fr))` }}
      >
        <span />
        {lanes.map((lane) => (
          <span key={lane.id} title={lane.label} className="text-center text-muted-foreground">
            {lane.label[0]}
          </span>
        ))}
        {lanes.map((from) => (
          <div key={from.id} className="contents">
            <span title={from.label} className="self-center text-muted-foreground">
              {from.label[0]}
            </span>
            {lanes.map((to) => {
              const count = profile.transitions.get(from.id)?.get(to.id) ?? 0
              const level = count / maxTransitions
              return (
                <span
                  key={to.id}
                  data-testid="heat-cell"
                  title={`${from.label} → ${to.label}: ${plural(count, 'time')}`}
                  className="flex h-6 items-center justify-center rounded-[2px]"
                  style={{
                    background: count === 0 ? '#F7F8FA' : heat(level),
                    color: level > 0.5 ? '#fff' : '#1f2933',
                  }}
                >
                  {count > 0 ? count : ''}
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function ComparisonTable({ profiles, lanes }: { profiles: LearnerProfile[]; lanes: Lane[] }) {
  const gap = (profile: LearnerProfile, laneId: string) =>
    formatDuration(profile.byLane.get(laneId)?.longestGapS ?? 0)
  const summaryRows: { label: string; value: (profile: LearnerProfile) => string }[] = [
    { label: 'Touchpoints', value: (profile) => String(profile.count) },
    {
      label: 'Mean touchpoint length',
      value: (profile) =>
        profile.count > 0 ? formatDuration(profile.totalDwellS / profile.count) : '–',
    },
    { label: 'Monitor ↔ patient switches', value: (profile) => String(profile.monitorPatientSwitches) },
    { label: 'Longest stretch with no monitor touchpoint', value: (profile) => gap(profile, MONITOR_LANE) },
    { label: 'Longest stretch with no patient touchpoint', value: (profile) => gap(profile, PATIENT_LANE) },
  ]
  return (
    <Table className="tabular-nums">
      <TableHeader>
        <TableRow>
          <TableHead>Measure</TableHead>
          {profiles.map((profile) => (
            <TableHead key={profile.userId}>Learner {profile.userId}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {summaryRows.map((row) => (
          <TableRow key={row.label}>
            <TableCell>{row.label}</TableCell>
            {profiles.map((profile) => (
              <TableCell key={profile.userId}>{row.value(profile)}</TableCell>
            ))}
          </TableRow>
        ))}
        {lanes.map((lane) => (
          <TableRow key={lane.id}>
            <TableCell>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-sm" style={{ background: lane.color }} />
                {lane.label}
                <span className="text-xs text-muted-foreground">count · mean · first</span>
              </span>
            </TableCell>
            {profiles.map((profile) => {
              const stats = profile.byLane.get(lane.id)
              return (
                <TableCell key={profile.userId}>
                  {stats && stats.count > 0
                    ? `${stats.count} · ${stats.meanS.toFixed(1)} s · ${formatElapsed(stats.firstS ?? 0)}`
                    : 'None'}
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
