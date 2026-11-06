// Pure functions only: every metric is computed from visits in the browser, so
// the slider stays live.

import { isoToEpoch } from './time'
import type { IdleInterval, Lane, Meta, ObjectVisit, Run, Session, Visit } from './types'

/** Lanes the team coverage strip and monitor ↔ patient switches are about. */
export const PATIENT_LANE = 'Patient assessment'
export const MONITOR_LANE = 'Vital sign monitor'

/** Runs shorter than this are fragments and can't be the default view. */
const MIN_DEFAULT_RUN_S = 45 * 60

export interface Interval {
  start: number
  end: number
}

export function runDurationS(run: Run): number {
  return isoToEpoch(run.end) - isoToEpoch(run.start)
}

export function runWindow(run: Run): Interval {
  return { start: isoToEpoch(run.start), end: isoToEpoch(run.end) }
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

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

// Team coverage -------------------------------------------------------------

export interface Coverage {
  uncovered: Interval[]
  uncoveredPct: number
  longestS: number
}

/**
 * A lane is covered at time t if any learner visited it in [t - windowS, t].
 * The first windowS seconds of the run are never uncovered, because nobody has
 * had a full window to look yet.
 */
export function laneCoverage(
  items: Visit[],
  laneId: string,
  window: Interval,
  windowS: number,
): Coverage {
  const visits = items.filter((visit) => visit.lane === laneId).sort((a, b) => a.start - b.start)
  const uncovered: Interval[] = []
  let cursor = window.start + windowS

  for (const visit of visits) {
    if (visit.start > cursor) uncovered.push({ start: cursor, end: Math.min(visit.start, window.end) })
    cursor = Math.max(cursor, visit.end + windowS)
    if (cursor >= window.end) break
  }
  if (cursor < window.end) uncovered.push({ start: cursor, end: window.end })

  const lengths = uncovered.map((gap) => gap.end - gap.start)
  const total = lengths.reduce((sum, length) => sum + length, 0)
  return {
    uncovered,
    uncoveredPct: (total / Math.max(1, window.end - window.start)) * 100,
    longestS: Math.max(0, ...lengths),
  }
}

// What a learner was doing at one moment --------------------------------------

export type LearnerState =
  | { kind: 'visit'; lane: string; objectId?: string }
  | { kind: 'idle' }
  | { kind: 'background' }

export function stateAt(
  time: number,
  userId: number,
  runVisits: Visit[],
  idle: IdleInterval[],
): LearnerState {
  const visit = runVisits.find(
    (item) => item.userId === userId && item.start <= time && time <= item.end,
  )
  if (visit) return { kind: 'visit', lane: visit.lane, objectId: topObjects(visit, 1)[0]?.[0] }
  if (idle.some((item) => item.userId === userId && item.start <= time && time <= item.end)) {
    return { kind: 'idle' }
  }
  return { kind: 'background' }
}

/** A visit's most-looked-at objects, as [objectId, seconds]. */
export function topObjects(visit: Visit, count: number): [string, number][] {
  return Object.entries(visit.objects)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
}

// Learner profiles ------------------------------------------------------------

export interface LaneStats {
  dwellS: number
  count: number
  meanS: number
  /** Seconds from the learner's session start. Undefined if never visited. */
  firstS: number | undefined
  /** Longest stretch in the learner's sessions with no touchpoint on this lane. */
  longestGapS: number
}

export interface LearnerProfile {
  userId: number
  byLane: Map<string, LaneStats>
  totalDwellS: number
  activeS: number
  activeSharePct: number
  count: number
  monitorPatientSwitches: number
  /** from lane -> to lane -> count of consecutive touchpoints */
  transitions: Map<string, Map<string, number>>
  inferredHints: string[]
}

/** The start and end of a learner's sessions in a run, which may be more than one. */
export function learnerSpan(userId: number, runId: string, sessions: Session[]): Interval | undefined {
  const own = sessions.filter((session) => session.userId === userId && session.runId === runId)
  if (own.length === 0) return undefined
  return {
    start: Math.min(...own.map((session) => isoToEpoch(session.start))),
    end: Math.max(...own.map((session) => isoToEpoch(session.end))),
  }
}

export function learnerProfile(
  userId: number,
  run: Run,
  runTouchpoints: Visit[],
  sessions: Session[],
  lanes: Lane[],
): LearnerProfile {
  const own = runTouchpoints.filter((visit) => visit.userId === userId)
  const span = learnerSpan(userId, run.id, sessions) ?? runWindow(run)
  const ownSessions = sessions.filter((item) => item.userId === userId && item.runId === run.id)

  const byLane = new Map<string, LaneStats>()
  for (const lane of lanes) {
    const visits = own.filter((visit) => visit.lane === lane.id)
    const dwellS = visits.reduce((sum, visit) => sum + visit.dwell, 0)
    let longestGapS = 0
    let cursor = span.start
    for (const visit of visits) {
      longestGapS = Math.max(longestGapS, visit.start - cursor)
      cursor = Math.max(cursor, visit.end)
    }
    longestGapS = Math.max(longestGapS, span.end - cursor)
    byLane.set(lane.id, {
      dwellS,
      count: visits.length,
      meanS: visits.length > 0 ? dwellS / visits.length : 0,
      firstS: visits.length > 0 ? visits[0].start - span.start : undefined,
      longestGapS,
    })
  }

  const transitions = new Map<string, Map<string, number>>()
  let monitorPatientSwitches = 0
  for (let i = 1; i < own.length; i++) {
    const from = own[i - 1].lane
    const to = own[i].lane
    const row = transitions.get(from) ?? new Map<string, number>()
    row.set(to, (row.get(to) ?? 0) + 1)
    transitions.set(from, row)
    if (
      (from === MONITOR_LANE && to === PATIENT_LANE) ||
      (from === PATIENT_LANE && to === MONITOR_LANE)
    ) {
      monitorPatientSwitches++
    }
  }

  const totalDwellS = own.reduce((sum, visit) => sum + visit.dwell, 0)
  const activeS = ownSessions.reduce((sum, item) => sum + item.activeSeconds, 0)
  return {
    userId,
    byLane,
    totalDwellS,
    activeS,
    activeSharePct: activeS > 0 ? (totalDwellS / activeS) * 100 : 0,
    count: own.length,
    monitorPatientSwitches,
    transitions,
    inferredHints: [...new Set(ownSessions.flatMap((item) => item.inferredHints))],
  }
}

// Display under test ----------------------------------------------------------

export type DisplayTarget = { kind: 'lane'; id: string } | { kind: 'object'; id: string }

export interface Glance {
  start: number
  end: number
  dwell: number
}

export interface LearnerGlances {
  userId: number
  glances: Glance[]
  firstLookS: number | undefined
  totalDwellS: number
  meanS: number
}

export function displayGlances(
  target: DisplayTarget,
  run: Run,
  minVisitS: number,
  visits: Visit[],
  objectVisits: ObjectVisit[],
  sessions: Session[],
): LearnerGlances[] {
  const source: (Glance & { userId: number })[] =
    target.kind === 'lane'
      ? visits.filter((visit) => visit.runId === run.id && visit.lane === target.id)
      : objectVisits.filter((visit) => visit.runId === run.id && visit.objectId === target.id)

  return run.userIds.map((userId) => {
    const glances = source
      .filter((glance) => glance.userId === userId && glance.dwell >= minVisitS)
      .sort((a, b) => a.start - b.start)
    const span = learnerSpan(userId, run.id, sessions) ?? runWindow(run)
    const totalDwellS = glances.reduce((sum, glance) => sum + glance.dwell, 0)
    return {
      userId,
      glances,
      firstLookS: glances.length > 0 ? glances[0].start - span.start : undefined,
      totalDwellS,
      meanS: glances.length > 0 ? totalDwellS / glances.length : 0,
    }
  })
}
