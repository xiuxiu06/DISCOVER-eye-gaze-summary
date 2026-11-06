import type { GazeSummary } from './summary'
// The JSON files written by the pipeline to app/public/data/.
//
// Times: `start` and `end` on visits are epoch seconds and ISO strings are
// clock times from the log. Treat the log's clock as UTC on both sides, so a
// time shows as logged whatever timezone the browser is in. See time.ts.

export interface Lane {
  id: string
  label: string
  order: number
  include: boolean
  color: string
  band: string
}

export interface ObjectInfo {
  lane: string
  /** True when the lane map marks this object's lane as uncertain ("?" in tooltips). */
  verify: boolean
}

export interface Meta {
  generatedAt: string
  params: Record<string, number>
  source: string
  lanes: Lane[]
  /** object_id -> lane and confidence. Needed for the "?" marker in tooltips. */
  objects: Record<string, ObjectInfo>
}

export interface FunnelStep {
  step: string
  rows: number
  seconds: number
  note: string
}

export interface Session {
  id: string
  userId: number
  runId: string
  start: string
  end: string
  durationMin: number
  rawRows: number
  idleSeconds: number
  activeSeconds: number
  /** Guesses about the scenario. Always label these "inferred" in the UI. */
  inferredHints: string[]
}

export interface Run {
  id: string
  date: string
  start: string
  end: string
  sessionIds: string[]
  userIds: number[]
}

/** A lane-level visit. A touchpoint is a visit with dwell >= the slider value. */
export interface Visit {
  sessionId: string
  userId: number
  runId: string
  lane: string
  start: number
  end: number
  dwell: number
  /** object_id -> seconds */
  objects: Record<string, number>
}

export interface ObjectVisit {
  sessionId: string
  userId: number
  runId: string
  objectId: string
  lane: string
  start: number
  end: number
  dwell: number
}

export interface IdleInterval {
  sessionId: string
  userId: number
  start: number
  end: number
}

/** One row of the gaze log, with the same columns as the CSV. */
export interface RawRow {
  user_id: number
  session_id: number
  object_id: string
  gaze_time: number
  time_stamp: string
}

export interface Dataset {
  /** Where the data came from. "mock" must show a visible banner. */
  origin: 'real' | 'mock' | 'uploaded'
  summary?: GazeSummary
  meta: Meta
  funnel: FunnelStep[]
  sessions: Session[]
  runs: Run[]
  visits: Visit[]
  objectVisits: ObjectVisit[]
  idle: IdleInterval[]
  rawSample: RawRow[]
}
