import assert from 'node:assert/strict'
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
  console.log('Summary checks passed: 33 groups, four learners, exact per-second reconstruction, nulls/gaps and invalid input.')
} finally { await vite.close() }
