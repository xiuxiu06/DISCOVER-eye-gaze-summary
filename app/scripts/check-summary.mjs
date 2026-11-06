import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { parseSummary, summaryVisits } = await vite.ssrLoadModule('/src/summary.ts')
  const raw = JSON.parse(readFileSync(new URL('../public/gaze-summary.json', import.meta.url), 'utf8'))
  const summary = parseSummary(raw)
  assert.equal(summary.relevant_objects.length, 33)
  assert.deepEqual(summary.users.map((user) => user.userId), [1, 2, 3, 4])
  for (const user of summary.users) {
    const segments = summaryVisits(summary, user.userId)
    const restored = new Map()
    for (const visit of segments) {
      assert.equal(visit.dwell, visit.end - visit.start)
      for (let second = visit.start; second < visit.end; second++) restored.set(second, visit.lane)
    }
    for (const entry of user.entries) assert.equal(restored.get(entry.second) ?? null, entry.object)
  }
  const fixture = parseSummary({ relevant_objects: ['Eye'], user1: [
    { second: 0, object: 'Eye' }, { second: 1, object: 'Eye' },
    { second: 2, object: null }, { second: 3, object: 'Eye' }, { second: 5, object: 'Eye' },
  ] })
  assert.deepEqual(summaryVisits(fixture, 1).map((v) => [v.start, v.end]), [[0, 2], [3, 4], [5, 6]])
  assert.throws(() => parseSummary({}))
  assert.throws(() => parseSummary({ relevant_objects: ['Eye'], user1: [{ second: 0, object: 'Unknown' }] }))
  assert.throws(() => parseSummary({ relevant_objects: ['Eye'], user1: [{ second: 1, object: 'Eye' }, { second: 0, object: 'Eye' }] }))
  const { processLog } = await vite.ssrLoadModule('/src/processLog.ts')
  const meta = JSON.parse(readFileSync(new URL('../public/data/meta.json', import.meta.url), 'utf8'))
  const uploaded = processLog(
    readFileSync(new URL('../../data/raw/eye_gaze_tracking_050505092026.csv', import.meta.url), 'utf8'),
    readFileSync(new URL('../../data/lane_map.csv', import.meta.url), 'utf8'), meta, 'uploaded.csv',
  ).dataset
  assert.deepEqual(uploaded.summary, summary, 'Generated upload summary must exactly match Python output')
  assert.equal(uploaded.advancedSummary.relevant_objects.length, 91)
  assert.ok(uploaded.advancedSummary.relevant_objects.includes('CodeSheet5kg'))
  assert.ok(!uploaded.advancedSummary.relevant_objects.includes('CodeSheet'))
  for (const user of uploaded.summary.users) {
    assert.equal(uploaded.advancedSummary.users.find((candidate) => candidate.userId === user.userId).entries.length, user.entries.length)
  }
  const { createSummary, condenseMapping } = await vite.ssrLoadModule('/src/createSummary.ts')
  const minuteRows = Array.from({ length: 11 }, (_, order) => ({ userId: 17, logSession: 0, objectId: 'SPO2', gazeTime: 1, epoch: 0, order }))
  const minutes = createSummary(minuteRows)
  assert.equal(minutes.users[0].userId, 17)
  assert.equal(minutes.users[0].entries.length, 11)
  assert.ok(minutes.users[0].entries.every((entry) => entry.object === 'SPO2'))
  const groups = condenseMapping(['CodeSheet5kg', 'CodeSheet8kg', 'LeftEye', 'RightEye'])
  assert.equal(groups.get('CodeSheet8kg'), 'CodeSheet')
  assert.equal(groups.get('LeftEye'), 'Eye')
  const compete = [
    { ...minuteRows[0], epoch: 1, objectId: 'Stryker_bed_front', gazeTime: 0.12 },
    { ...minuteRows[0], epoch: 1, order: 1, objectId: 'Stryker_bed_back', gazeTime: 0.12 },
    { ...minuteRows[0], epoch: 1, order: 2, objectId: 'Liver', gazeTime: 0.15 },
  ]
  assert.equal(createSummary(compete, true).users[0].entries[0].object, 'Stryker_bed')
  assert.equal(createSummary(compete, false).users[0].entries[0].object, 'Liver')
  const blocked = createSummary(minuteRows.map((row) => ({ ...row, objectId: 'RoomCollider999' })))
  assert.equal(blocked.relevant_objects.length, 0)
  assert.ok(blocked.users[0].entries.every((entry) => entry.object === null))
  const sessions = createSummary([
    { ...minuteRows[0], objectId: 'RR', epoch: 1 },
    { ...minuteRows[0], objectId: 'SPO2', epoch: 1000, order: 1 },
  ])
  assert.equal(sessions.users[0].entries.length, 2, 'Large recording pauses must not expand the timeline')
  const { ObjectSwimLanes } = await vite.ssrLoadModule('/src/screens/ObjectSwimLanes.tsx')
  const html = renderToStaticMarkup(createElement(ObjectSwimLanes, { dataset: uploaded, run: uploaded.runs[0], minVisitS: 0.5, view: 'simplified' }))
  assert.ok(html.includes('Summary generated automatically from uploaded.csv'))
  assert.ok(html.includes('Download summary JSON'))
  assert.ok(!html.includes('type="file"'))
  const advancedHtml = renderToStaticMarkup(createElement(ObjectSwimLanes, { dataset: { ...uploaded, objectVisits: [] }, run: uploaded.runs[0], minVisitS: 0.5, view: 'advanced' }))
  assert.ok(advancedHtml.includes('individual object names preserved'))
  assert.ok(advancedHtml.includes('summary segments'))
  assert.ok(!advancedHtml.includes('Clinical lane'))
  assert.ok(!advancedHtml.includes('Object visit details'))
  assert.ok(!advancedHtml.includes('type="file"'))
  console.log('Advanced: 91 original objects, same timeline length, no object-visit dependency; condensing changes dominant-object selection correctly.')
  const python = readFileSync(new URL('../../summarize_gaze.py', import.meta.url), 'utf8')
  const rules = JSON.parse(readFileSync(new URL('../src/summaryFilter.json', import.meta.url), 'utf8'))
  const expectedObjects = [...python.slice(python.indexOf('DEFAULT_IRRELEVANT_OBJECTS:'), python.indexOf('# Scalable regex')).matchAll(/"([^"\n]+)"/g)].map((match) => match[1])
  assert.deepEqual(rules.objects, expectedObjects, 'Browser rules must match Python')
  console.log('Automatic generation checks: minute timestamps, condensing, irrelevant objects, recording gaps and no JSON picker passed.')
  console.log('Uploaded raw CSV: exact match with the full Python-generated condensed summary.')
  console.log('Summary checks passed: 33 groups, four learners, exact per-second reconstruction, nulls/gaps and invalid input.')
} finally { await vite.close() }
