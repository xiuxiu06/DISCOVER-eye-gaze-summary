import { createSummary } from './createSummary'
// The Python pipeline's steps, run in the browser on an uploaded gaze log, so
// nothing leaves the machine. scripts/check-upload.mjs checks that both give the
// same result. Thresholds and lanes come from meta.json, not from this file.

import type {
  Dataset,
  FunnelStep,
  IdleInterval,
  Meta,
  ObjectVisit,
  RawRow,
  Run,
  Session,
  Visit,
} from './types'

const UNMAPPED_LANE = 'Unmapped'
const BACKGROUND_COLOR = '#9AA0A6'
const LANE_MAP_NOTE =
  "The lane map is a draft that hasn't had clinical review, so numbers per lane are provisional."

const REQUIRED_COLUMNS = ['user_id', 'object_id', 'gaze_time', 'time_stamp'] as const

const HEADER_ALIASES: Record<string, string> = {
  userid: 'user_id',
  user: 'user_id',
  sessionid: 'session_id',
  session: 'session_id',
  objectid: 'object_id',
  object: 'object_id',
  gazetime: 'gaze_time',
  duration: 'gaze_time',
  timestamp: 'time_stamp',
  time: 'time_stamp',
}

export interface UploadResult {
  dataset: Dataset
  /** Rows dropped because a value was missing or couldn't be read. */
  skippedRows: number
  /** Objects in the file that the lane map doesn't know, so they count as background. */
  unmappedObjects: string[]
}

interface LogRow {
  userId: number
  logSession: number
  objectId: string
  gazeTime: number
  epoch: number
  order: number
}

interface TimedRow extends LogRow {
  startS: number
  endS: number
  idle: boolean
  rawSession: number
  sessionId: string
  lane: string
  include: boolean
}

interface MergedVisit {
  sessionId: string
  key: string
  start: number
  end: number
  dwell: number
  objects: Record<string, number>
}

interface SessionSpan {
  id: string
  userId: number
  first: number
  last: number
  durationS: number
  rows: TimedRow[]
  runId: string
}

const round = (value: number, digits: number) => {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

const sumGaze = (rows: { gazeTime: number }[]) => rows.reduce((sum, row) => sum + row.gazeTime, 0)

const isoSeconds = (epoch: number) => new Date(epoch * 1000).toISOString().slice(0, 19)

const toEpoch = (iso: string) => Date.parse(`${iso}Z`) / 1000

function parseLine(line: string, delimiter: string): string[] {
  if (!line.includes('"')) return line.split(delimiter)
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"' && quoted && line[i + 1] === '"') {
      field += '"'
      i++
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === delimiter && !quoted) {
      fields.push(field)
      field = ''
    } else {
      field += char
    }
  }
  fields.push(field)
  return fields
}

function parseTable(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const first = lines[0] ?? ''
  const delimiter = first.includes('\t') ? '\t' : ','
  return {
    header: parseLine(first, delimiter).map((name) => name.trim()),
    rows: lines
      .slice(1)
      .filter((line) => line.trim() !== '')
      .map((line) => parseLine(line, delimiter)),
  }
}

function parseMonthFirst(text: string): number | undefined {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(?:\s*([AP]M))?$/i.exec(text)
  if (!match) return undefined
  const [, month, day, year, hour, minute, second, meridiem] = match
  let hours = Number(hour)
  if (meridiem) hours = (hours % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0)
  const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year)
  return Date.UTC(fullYear, Number(month) - 1, Number(day), hours, Number(minute)) / 1000 + Number(second ?? 0)
}

/** The log's clock as UTC seconds, so times show as logged in any browser timezone. */
function parseTimestamp(text: string): number | undefined {
  const value = text.trim()
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) {
    const epoch = Date.parse(`${value.replace(' ', 'T')}Z`) / 1000
    return Number.isNaN(epoch) ? undefined : epoch
  }
  return parseMonthFirst(value)
}

function readLog(text: string): { rows: LogRow[]; skipped: number } {
  const { header, rows } = parseTable(text)
  const columns = new Map<string, number>()
  header.forEach((name, index) => {
    const normalized = name.toLowerCase().replace(/[\s_-]/g, '')
    columns.set(HEADER_ALIASES[normalized] ?? name.toLowerCase(), index)
  })
  const missing = REQUIRED_COLUMNS.filter((name) => !columns.has(name))
  if (missing.length > 0) {
    throw new Error(`This doesn't look like a gaze log. Missing columns: ${missing.join(', ')}.`)
  }
  const userAt = columns.get('user_id')!
  const objectAt = columns.get('object_id')!
  const gazeAt = columns.get('gaze_time')!
  const timeAt = columns.get('time_stamp')!
  const sessionAt = columns.get('session_id')

  const parsed: LogRow[] = []
  let skipped = 0
  for (const row of rows) {
    const objectId = (row[objectAt] ?? '').trim()
    const userText = (row[userAt] ?? '').trim()
    const gazeText = (row[gazeAt] ?? '').trim()
    const userId = Number(userText)
    const gazeTime = Number(gazeText)
    const epoch = parseTimestamp(row[timeAt] ?? '')
    if (
      objectId === '' ||
      ['null', 'none', 'nan'].includes(objectId.toLowerCase()) ||
      userText === '' ||
      !Number.isInteger(userId) ||
      gazeText === '' ||
      !Number.isFinite(gazeTime) ||
      gazeTime < 0 ||
      epoch === undefined
    ) {
      skipped++
      continue
    }
    const logSession = sessionAt === undefined ? 0 : Number(row[sessionAt])
    parsed.push({
      userId,
      logSession: Number.isFinite(logSession) ? logSession : 0,
      objectId,
      gazeTime,
      epoch,
      order: parsed.length,
    })
  }
  return { rows: parsed, skipped }
}

function readLaneMap(text: string): Map<string, { lane: string; include: boolean; verify: boolean }> {
  const { header, rows } = parseTable(text)
  const at = (name: string) => header.indexOf(name)
  return new Map(
    rows.map((row) => [
      row[at('object_id')],
      {
        lane: row[at('lane')],
        include: row[at('include')] === 'True',
        verify: row[at('confidence')] === 'verify',
      },
    ]),
  )
}

/** Merges consecutive rows in each session by lane or object. Pass included, non-idle rows. */
function mergeVisits(rows: TimedRow[], keyOf: (row: TimedRow) => string, gapS: number): MergedVisit[] {
  const visits: MergedVisit[] = []
  let current: MergedVisit | undefined
  for (const row of rows) {
    const key = keyOf(row)
    if (
      current &&
      current.sessionId === row.sessionId &&
      current.key === key &&
      row.startS - current.end <= gapS
    ) {
      current.start = Math.min(current.start, row.startS)
      current.end = Math.max(current.end, row.endS)
      current.dwell += row.gazeTime
      current.objects[row.objectId] = (current.objects[row.objectId] ?? 0) + row.gazeTime
    } else {
      current = {
        sessionId: row.sessionId,
        key,
        start: row.startS,
        end: row.endS,
        dwell: row.gazeTime,
        objects: { [row.objectId]: row.gazeTime },
      }
      visits.push(current)
    }
  }
  return visits
}

function assignTeamRuns(spans: SessionSpan[], overlapFrac: number) {
  let current: { id: string; start: number; end: number } | undefined
  const byStart = spans
    .map((span, index) => ({ span, index }))
    .sort((a, b) => a.span.first - b.span.first || a.index - b.index)
  for (const { span } of byStart) {
    if (current && span.durationS > 0) {
      const overlap = Math.min(span.last, current.end) - Math.max(span.first, current.start)
      if (Math.max(0, overlap) / span.durationS >= overlapFrac) {
        current.end = Math.max(current.end, span.last)
        span.runId = current.id
        continue
      }
    }
    const iso = isoSeconds(span.first)
    current = {
      id: `run-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`,
      start: span.first,
      end: span.last,
    }
    span.runId = current.id
  }
}

/** Tells a gaze log from a lane map by its header row. Anything else counts as a gaze log. */
export function fileKind(text: string): 'gaze' | 'laneMap' {
  const { header } = parseTable(text.slice(0, 2000))
  return header.includes('lane') && header.includes('object_id') ? 'laneMap' : 'gaze'
}

/** Runs every pipeline step. Throws a message for the user if the file can't be used. */
export function processLog(
  text: string,
  laneMapCsv: string,
  base: Pick<Meta, 'params' | 'lanes'>,
  fileName: string,
): UploadResult {
  const { params } = base
  const { rows: raw, skipped } = readLog(text)
  if (raw.length === 0) throw new Error('This file has no gaze rows that could be read.')
  const laneMap = readLaneMap(laneMapCsv)

  const logged = sumGaze(raw)
  const noTest = raw.filter((row) => row.userId !== 0)

  // A row is written when the ray leaves an object, so its timestamp is the end of the look.
  const timed: TimedRow[] = noTest
    .map((row) => {
      const mapped = laneMap.get(row.objectId)
      const endS = row.epoch + 0.5
      return {
        ...row,
        endS,
        startS: endS - row.gazeTime,
        idle: row.gazeTime > params.IDLE_MAX_S,
        rawSession: 0,
        sessionId: '',
        lane: mapped?.lane ?? UNMAPPED_LANE,
        include: mapped?.include ?? false,
      }
    })
    .sort((a, b) => a.userId - b.userId || a.epoch - b.epoch || a.order - b.order)

  const idleRows = timed.filter((row) => row.idle)
  const idleSeconds = sumGaze(idleRows)

  // Sessions: split on time gaps, then drop the short ones.
  const allSpans: SessionSpan[] = []
  for (const row of timed) {
    const last = allSpans[allSpans.length - 1]
    if (last && last.userId === row.userId && row.epoch - last.last <= params.SESSION_GAP_S) {
      last.last = row.epoch
      last.durationS = last.last - last.first
      last.rows.push(row)
    } else {
      allSpans.push({
        id: '',
        userId: row.userId,
        first: row.epoch,
        last: row.epoch,
        durationS: 0,
        rows: [row],
        runId: '',
      })
    }
  }
  const kept = allSpans.filter((span) => span.durationS >= params.MIN_SESSION_MIN * 60)
  if (kept.length === 0) {
    throw new Error(`No session in this file ran at least ${params.MIN_SESSION_MIN} minutes.`)
  }
  const seenPerUser = new Map<number, number>()
  for (const span of kept) {
    const n = (seenPerUser.get(span.userId) ?? 0) + 1
    seenPerUser.set(span.userId, n)
    span.id = `u${span.userId}-s${n}`
    for (const row of span.rows) row.sessionId = span.id
  }
  assignTeamRuns(kept, params.TEAM_OVERLAP_FRAC)

  const keptRows = kept.flatMap((span) => span.rows)
  const active = keptRows.filter((row) => !row.idle)
  const included = active.filter((row) => row.include)

  const mergedLanes = mergeVisits(included, (row) => row.lane, params.MERGE_GAP_S).filter(
    (visit) => visit.dwell >= params.EXPORT_MIN_VISIT_S,
  )
  const mergedObjects = mergeVisits(included, (row) => row.objectId, params.MERGE_GAP_S).filter(
    (visit) => visit.dwell >= params.EXPORT_MIN_VISIT_S,
  )
  const spanById = new Map(kept.map((span) => [span.id, span]))
  const roundObjects = (objects: Record<string, number>) =>
    Object.fromEntries(Object.entries(objects).map(([name, seconds]) => [name, round(seconds, 3)]))

  const visits: Visit[] = mergedLanes.map((visit) => {
    const span = spanById.get(visit.sessionId)!
    return {
      sessionId: visit.sessionId,
      userId: span.userId,
      runId: span.runId,
      lane: visit.key,
      start: round(visit.start, 3),
      end: round(visit.end, 3),
      dwell: round(visit.dwell, 3),
      objects: roundObjects(visit.objects),
    }
  })
  const objectVisits: ObjectVisit[] = mergedObjects.map((visit) => {
    const span = spanById.get(visit.sessionId)!
    return {
      sessionId: visit.sessionId,
      userId: span.userId,
      runId: span.runId,
      objectId: visit.key,
      lane: laneMap.get(visit.key)!.lane,
      start: round(visit.start, 3),
      end: round(visit.end, 3),
      dwell: round(visit.dwell, 3),
    }
  })

  const sessions: Session[] = kept.map((span) => {
    const looks = span.rows.filter((row) => !row.idle)
    // The window covers real looks, but not an idle row's long reach backwards.
    const start = Math.floor(looks.reduce((least, row) => Math.min(least, row.startS), span.first))
    const end = Math.ceil(looks.reduce((most, row) => Math.max(most, row.endS), span.last))
    const sheets = [
      ...new Set(looks.map((row) => row.objectId).filter((name) => name.startsWith('CodeSheet'))),
    ].sort()
    return {
      id: span.id,
      userId: span.userId,
      runId: span.runId,
      start: isoSeconds(start),
      end: isoSeconds(end),
      durationMin: round((end - start) / 60, 2),
      rawRows: span.rows.length,
      idleSeconds: round(sumGaze(span.rows.filter((row) => row.idle)), 1),
      activeSeconds: round(sumGaze(looks), 1),
      inferredHints: sheets.map((sheet) => `${sheet} seen`),
    }
  })

  const runIds = [...new Set(sessions.map((session) => session.runId))]
  const runs: Run[] = runIds
    .map((id) => {
      const members = sessions.filter((session) => session.runId === id)
      const start = members.map((member) => member.start).sort()[0]
      return {
        id,
        date: start.slice(0, 10),
        start,
        end: members.map((member) => member.end).sort().at(-1)!,
        sessionIds: members.map((member) => member.id),
        userIds: [...new Set(members.map((member) => member.userId))].sort((a, b) => a - b),
      }
    })
    .sort((a, b) => a.start.localeCompare(b.start))

  // Clipped to the session, because an idle row's start can reach far before it.
  const idle: IdleInterval[] = []
  for (const row of keptRows) {
    if (!row.idle) continue
    const session = sessions.find((item) => item.id === row.sessionId)!
    const start = Math.max(row.startS, toEpoch(session.start))
    const end = Math.min(row.endS, toEpoch(session.end))
    if (end - start > 1) {
      idle.push({ sessionId: row.sessionId, userId: row.userId, start: round(start, 3), end: round(end, 3) })
    }
  }

  const rawSample: RawRow[] = raw
    .sort((a, b) => a.order - b.order)
    .slice(0, 25)
    .map((row) => ({
      user_id: row.userId,
      session_id: row.logSession,
      object_id: row.objectId,
      gaze_time: row.gazeTime,
      time_stamp: isoSeconds(row.epoch).replace('T', ' '),
    }))

  const step = (name: string, rows: number, seconds: number, note: string): FunnelStep => ({
    step: name,
    rows,
    seconds: round(seconds, 1),
    note,
  })
  const distinctObjects = new Set(raw.map((row) => row.objectId))
  const funnel: FunnelStep[] = [
    step(
      'Raw export',
      raw.length,
      logged,
      `Interleaved rows for user IDs ${raw.reduce((least, row) => Math.min(least, row.userId), Infinity)}–${raw.reduce((most, row) => Math.max(most, row.userId), -Infinity)}, across ${distinctObjects.size} objects.`,
    ),
    step('Drop the test user', noTest.length, sumGaze(noTest), `User 0 has only ${raw.length - noTest.length} rows.`),
    step(
      'Remove idle headset periods',
      timed.length - idleRows.length,
      sumGaze(noTest) - idleSeconds,
      `${idleRows.length} looks over ${params.IDLE_MAX_S} s took ${(idleSeconds / 3600).toFixed(1)} h, which is ${Math.round((idleSeconds / logged) * 100)}% of logged time.`,
    ),
    step(
      'Rebuild sessions',
      active.length,
      sumGaze(active),
      `Kept ${kept.length} of ${allSpans.length} sessions. A gap over ${params.SESSION_GAP_S / 60} min starts a new session, and sessions under ${params.MIN_SESSION_MIN} min are dropped.`,
    ),
    step(
      'Group objects into 5 lanes',
      included.length,
      sumGaze(included),
      'Walls, invisible colliders, own hands, bed and UI are set aside.',
    ),
    step(
      'Merge into touchpoints',
      visits.length,
      mergedLanes.reduce((sum, visit) => sum + visit.dwell, 0),
      'Back-to-back looks in the same lane become one touchpoint.',
    ),
  ]

  const unmappedObjects = [...distinctObjects].filter((name) => !laneMap.has(name)).sort()
  const objects: Meta['objects'] = {}
  for (const [name, info] of laneMap) {
    if (distinctObjects.has(name)) objects[name] = { lane: info.lane, verify: info.verify }
  }
  for (const name of unmappedObjects) objects[name] = { lane: UNMAPPED_LANE, verify: true }

  const lanes = base.lanes.filter((lane) => lane.id !== UNMAPPED_LANE)
  if (unmappedObjects.length > 0) {
    lanes.push({
      id: UNMAPPED_LANE,
      label: UNMAPPED_LANE,
      order: lanes.length,
      include: false,
      color: BACKGROUND_COLOR,
      band: BACKGROUND_COLOR,
    })
  }

  return {
    dataset: {
      origin: 'uploaded',
      summary: createSummary(raw),
      advancedSummary: createSummary(raw, false),
      meta: {
        generatedAt: new Date().toISOString(),
        source: `${fileName}. ${LANE_MAP_NOTE}`,
        params,
        lanes,
        objects,
      },
      funnel,
      sessions,
      runs,
      visits,
      objectVisits,
      idle,
      rawSample,
    },
    skippedRows: skipped,
    unmappedObjects,
  }
}
