// Pure functions only: every metric is computed from visits in the browser, so
// the slider stays live. Add the metrics for screens 2–4 here.

import { isoToEpoch } from './time'
import type { Lane, Meta, Run, Visit } from './types'

/** Runs shorter than this are fragments and can't be the default view. */
const MIN_DEFAULT_RUN_S = 45 * 60

export function runDurationS(run: Run): number {
  return isoToEpoch(run.end) - isoToEpoch(run.start)
}

/** The default view: the earliest full-length run with the most learners. */
export function pickDefaultRun(runs: Run[]): Run | undefined {
  const fullLength = runs.filter((run) => runDurationS(run) >= MIN_DEFAULT_RUN_S)
  const candidates = fullLength.length > 0 ? fullLength : runs
  return [...candidates].sort(
    (a, b) =>
      b.userIds.length - a.userIds.length || isoToEpoch(a.start) - isoToEpoch(b.start),
  )[0]
}

/** Lanes drawn on the swim panels, in display order. */
export function includedLanes(meta: Meta): Lane[] {
  return meta.lanes.filter((lane) => lane.include).sort((a, b) => a.order - b.order)
}

/** A run's visits that reach the slider value, in time order. */
export function touchpoints(visits: Visit[], runId: string, minVisitS: number): Visit[] {
  return visits
    .filter((visit) => visit.runId === runId && visit.dwell >= minVisitS)
    .sort((a, b) => a.start - b.start)
}

export function countByLearner(items: Visit[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const item of items) counts.set(item.userId, (counts.get(item.userId) ?? 0) + 1)
  return counts
}
