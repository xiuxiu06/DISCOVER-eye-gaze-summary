// Writes synthetic data to public/data-mock/ so the app runs before the pipeline exists.
// Nothing here comes from the gaze log: all rows, visits and funnel counts are random.
// Run with: npm run mock

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data-mock')

// Seeded, so re-running gives the same files and no noisy diffs.
let seed = 20260506
function random() {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const between = (low, high) => low + random() * (high - low)
const round3 = (value) => Math.round(value * 1000) / 1000

const LANES = [
  { id: 'Reference', label: 'Reference', include: true, color: '#3B8EDB', band: '#D6E8F8' },
  { id: 'Patient assessment', label: 'Patient assessment', include: true, color: '#D6336C', band: '#F7D4E1' },
  { id: 'Vital sign monitor', label: 'Vital sign monitor', include: true, color: '#7CB342', band: '#E3F0D3' },
  { id: 'Equipment & interventions', label: 'Equipment & interventions', include: true, color: '#E0A800', band: '#FBF0C9' },
  { id: 'Communication', label: 'Communication', include: true, color: '#5AA9D6', band: '#E6F3FA' },
  { id: 'Self', label: 'Self', include: false, color: '#9AA0A6', band: '#F1F3F4' },
  { id: 'Bed', label: 'Bed', include: false, color: '#9AA0A6', band: '#F1F3F4' },
  { id: 'System', label: 'System', include: false, color: '#9AA0A6', band: '#F1F3F4' },
  { id: 'Environment', label: 'Environment', include: false, color: '#9AA0A6', band: '#F1F3F4' },
].map((lane, order) => ({ ...lane, order }))

const OBJECTS = {
  Reference: ['MockCodeSheetA', 'MockCodeSheetB'],
  'Patient assessment': ['MockPatientChest', 'MockPatientHead', 'MockStethoscope'],
  'Vital sign monitor': ['MockMonitorBar', 'MockMonitorScreen', 'MockSpO2'],
  'Equipment & interventions': ['MockBagMask', 'MockIVPole', 'MockO2Device'],
  Communication: ['MockHeadFollower'],
}
const VERIFY = new Set(['MockHeadFollower'])

// Chance of each lane per learner, so the four learners scan differently.
const LANE_WEIGHTS = {
  1: [0.03, 0.2, 0.3, 0.17, 0.3],
  2: [0.02, 0.1, 0.18, 0.2, 0.5],
  3: [0.05, 0.3, 0.1, 0.35, 0.2],
  4: [0.01, 0.08, 0.4, 0.11, 0.4],
}
const INCLUDED = LANES.filter((lane) => lane.include).map((lane) => lane.id)

function pickLane(userId, previous) {
  for (;;) {
    let roll = random()
    for (let i = 0; i < INCLUDED.length; i++) {
      roll -= LANE_WEIGHTS[userId][i]
      if (roll <= 0) {
        if (INCLUDED[i] !== previous) return INCLUDED[i]
        break
      }
    }
  }
}

const RUNS = [
  { start: '2026-05-06T13:04:00', minutes: 51, stamp: '2026-05-06-1304' },
  { start: '2026-05-08T13:21:00', minutes: 50, stamp: '2026-05-08-1321' },
]
const toEpoch = (iso) => Date.parse(`${iso}Z`) / 1000
const toIso = (epoch) => new Date(epoch * 1000).toISOString().slice(0, 19)

const runs = []
const sessions = []
const visits = []
const objectVisits = []
const idle = []

for (const runSpec of RUNS) {
  const runId = `run-${runSpec.stamp}`
  const runStart = toEpoch(runSpec.start)
  const sessionIds = []
  let latestEnd = runStart

  for (const userId of [1, 2, 3, 4]) {
    const sessionId = `u${userId}-s${runs.length + 1}`
    sessionIds.push(sessionId)
    const start = runStart + Math.floor(between(0, 60))
    const end = runStart + runSpec.minutes * 60 - Math.floor(between(0, 240))
    latestEnd = Math.max(latestEnd, end)

    const idleStart = start + between(0.3, 0.7) * (end - start)
    const idleEnd = idleStart + between(45, 200)
    idle.push({ sessionId, userId, start: round3(idleStart), end: round3(idleEnd) })

    let clock = start + between(2, 15)
    let previousLane
    while (clock < end) {
      if (clock >= idleStart && clock < idleEnd) {
        clock = idleEnd + 1
        continue
      }
      const lane = pickLane(userId, previousLane)
      previousLane = lane
      const dwell = Math.min(20, 0.1 + -Math.log(1 - random()) * 1.6)
      const names = OBJECTS[lane]
      const first = names[Math.floor(random() * names.length)]
      const second = names[Math.floor(random() * names.length)]
      const split = first === second ? 1 : between(0.4, 0.8)
      const objects = { [first]: round3(dwell * split) }
      if (split < 1) objects[second] = round3(dwell * (1 - split))

      visits.push({
        sessionId, userId, runId, lane,
        start: round3(clock), end: round3(clock + dwell), dwell: round3(dwell), objects,
      })
      let objectClock = clock
      for (const [objectId, seconds] of Object.entries(objects)) {
        objectVisits.push({
          sessionId, userId, runId, objectId, lane,
          start: round3(objectClock), end: round3(objectClock + seconds), dwell: seconds,
        })
        objectClock += seconds
      }
      clock += dwell + between(3, 75)
    }

    const durationS = end - start
    const idleS = idleEnd - idleStart
    sessions.push({
      id: sessionId, userId, runId,
      start: toIso(start), end: toIso(end),
      durationMin: round3(durationS / 60),
      rawRows: Math.floor(between(3000, 9000)),
      idleSeconds: round3(idleS),
      activeSeconds: round3(durationS - idleS),
      inferredHints: ['MockCodeSheetA seen'],
    })
  }

  runs.push({
    id: runId, date: runSpec.start.slice(0, 10),
    start: runSpec.start, end: toIso(latestEnd),
    sessionIds, userIds: [1, 2, 3, 4],
  })
}

const objects = {}
for (const [lane, names] of Object.entries(OBJECTS)) {
  for (const name of names) objects[name] = { lane, verify: VERIFY.has(name) }
}

const sum = (items, key) => round3(items.reduce((total, item) => total + item[key], 0))
const visitSeconds = sum(visits, 'dwell')
const idleSeconds = sum(sessions, 'idleSeconds')
const activeSeconds = sum(sessions, 'activeSeconds')
const rawRows = sessions.reduce((total, session) => total + session.rawRows, 0)
const funnel = [
  { step: 'Raw log (mock)', rows: rawRows + 40, seconds: round3(activeSeconds + idleSeconds), note: 'Mock: every row in the file.' },
  { step: 'Idle removed (mock)', rows: rawRows + 32, seconds: round3(activeSeconds), note: 'Mock: removed 8 idle rows.' },
  { step: 'Sessions kept (mock)', rows: rawRows, seconds: round3(activeSeconds * 0.9), note: 'Mock: dropped short sessions.' },
  { step: 'Included lanes (mock)', rows: Math.round(rawRows * 0.1), seconds: visitSeconds, note: 'Mock: dropped walls, hands and other background.' },
  { step: 'Lane visits (mock)', rows: visits.length, seconds: visitSeconds, note: 'Mock: merged consecutive looks at the same lane.' },
]

const rawSample = []
let rawClock = toEpoch(RUNS[0].start)
const rawNames = ['MockRoomWall', ...Object.values(OBJECTS).flat()]
for (let i = 0; i < 25; i++) {
  rawClock += Math.floor(between(0, 2))
  rawSample.push({
    user_id: 1 + (i % 4),
    session_id: 0,
    object_id: rawNames[Math.floor(random() * rawNames.length)],
    gaze_time: round3(between(0.02, 0.4)),
    time_stamp: toIso(rawClock).replace('T', ' '),
  })
}

const meta = {
  generatedAt: 'mock',
  source: 'MOCK: synthetic data from scripts/make-mock-data.mjs, not from the gaze log',
  params: {
    IDLE_MAX_S: 30, SESSION_GAP_S: 300, MIN_SESSION_MIN: 5, MERGE_GAP_S: 1,
    EXPORT_MIN_VISIT_S: 0.1, DEFAULT_MIN_VISIT_S: 0.5, TEAM_OVERLAP_FRAC: 0.5, COVERAGE_WINDOW_S: 30,
  },
  lanes: LANES,
  objects,
}

mkdirSync(outDir, { recursive: true })
const files = {
  meta, funnel, sessions, runs, visits, object_visits: objectVisits, idle, raw_sample: rawSample,
}
for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(content, null, 1)}\n`)
}
console.log(`Wrote mock data to ${outDir}: ${runs.length} runs, ${visits.length} visits`)
