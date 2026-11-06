import { useMemo, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  displayGlances,
  includedLanes,
  median,
  runWindow,
  type DisplayTarget,
} from '../metrics'
import { formatDuration, formatElapsed } from '../time'
import type { ScreenProps } from './types'

function parseTarget(value: string): DisplayTarget {
  const separator = value.indexOf(':')
  return {
    kind: value.slice(0, separator) as DisplayTarget['kind'],
    id: value.slice(separator + 1),
  }
}

export function DisplayTest({ dataset, run, minVisitS }: ScreenProps) {
  const { meta, visits, objectVisits, sessions } = dataset
  const lanes = useMemo(() => includedLanes(meta), [meta])
  const objectIds = useMemo(
    () => [...new Set(objectVisits.map((visit) => visit.objectId))].sort(),
    [objectVisits],
  )
  const [selected, setSelected] = useState(`lane:${MONITOR_LANE}`)
  const target = useMemo(() => parseTarget(selected), [selected])

  const items = useMemo(
    () => [
      ...lanes.map((lane) => ({ value: `lane:${lane.id}`, label: `Whole lane: ${lane.label}` })),
      ...objectIds.map((id) => ({ value: `object:${id}`, label: id })),
    ],
    [lanes, objectIds],
  )
  const learners = useMemo(
    () => displayGlances(target, run, minVisitS, visits, objectVisits, sessions),
    [target, run, minVisitS, visits, objectVisits, sessions],
  )

  const looked = learners.filter((learner) => learner.firstLookS !== undefined)
  const medianFirstS = median(looked.map((learner) => learner.firstLookS!))
  const window = runWindow(run)
  const duration = window.end - window.start
  const laneId = target.kind === 'lane' ? target.id : meta.objects[target.id]?.lane
  const markColor = meta.lanes.find((lane) => lane.id === laneId)?.color ?? '#2b3440'

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Whether learners looked at this display, how soon, and how often
          </h2>
          <p className="text-sm text-muted-foreground">
            Standard usability measures for an area of interest, computed from head gaze.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span id="display-label" className="text-muted-foreground">
            Display
          </span>
          <Select
            items={items}
            value={selected}
            onValueChange={(value) => {
              if (value) setSelected(value)
            }}
          >
            <SelectTrigger aria-labelledby="display-label" data-testid="display-picker">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Lanes</SelectLabel>
                {items
                  .filter((item) => item.value.startsWith('lane:'))
                  .map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Objects</SelectLabel>
                {items
                  .filter((item) => item.value.startsWith('object:'))
                  .map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                      {meta.objects[item.label]?.verify && ' ?'}
                    </SelectItem>
                  ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p data-testid="display-headline" className="text-3xl font-semibold tracking-tight">
        {looked.length} of {learners.length} learners looked at it
        {medianFirstS !== undefined && (
          <span className="tabular-nums">
            ; median time to first look {(medianFirstS / 60).toFixed(1)} min
          </span>
        )}
      </p>

      <Table className="tabular-nums">
        <TableHeader>
          <TableRow>
            <TableHead>Learner</TableHead>
            <TableHead>Time to first look</TableHead>
            <TableHead>Glances</TableHead>
            <TableHead>Total dwell</TableHead>
            <TableHead>Mean glance</TableHead>
            <TableHead className="w-1/2">
              <span className="flex justify-between font-normal text-muted-foreground">
                <span>When they looked: 00:00</span>
                <span>{formatElapsed(duration)}</span>
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {learners.map((learner) => (
            <TableRow key={learner.userId} data-testid="display-row">
              <TableCell className="font-medium">Learner {learner.userId}</TableCell>
              <TableCell>
                {learner.firstLookS === undefined ? 'Not seen' : formatElapsed(learner.firstLookS)}
              </TableCell>
              <TableCell>{learner.glances.length}</TableCell>
              <TableCell>{formatDuration(learner.totalDwellS)}</TableCell>
              <TableCell>
                {learner.glances.length > 0 ? formatDuration(learner.meanS) : '–'}
              </TableCell>
              <TableCell>
                <div className="relative h-5 rounded-sm bg-muted">
                  {learner.glances.map((glance) => (
                    <span
                      key={glance.start}
                      data-testid="glance"
                      title={`At ${formatElapsed(glance.start - window.start)} for ${formatDuration(glance.dwell)}`}
                      className="absolute inset-y-0 min-w-[2px]"
                      style={{
                        left: `${((glance.start - window.start) / duration) * 100}%`,
                        width: `${(glance.dwell / duration) * 100}%`,
                        background: markColor,
                      }}
                    />
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
