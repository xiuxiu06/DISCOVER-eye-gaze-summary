import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const {
    CLAUDE_LANE_SYSTEM_PROMPT,
    applyLaneMapToBuiltInDataset,
    buildLaneMapCsvFromResponse,
    extractObjectsForClassification,
    matchLaneMapWithClaude,
  } = await vite.ssrLoadModule('/src/claudeLaneMap.ts')
  const { fileKind, processLog } = await vite.ssrLoadModule('/src/processLog.ts')
  const { UploadClean } = await vite.ssrLoadModule('/src/screens/UploadClean.tsx')

  const rawCsv = readFileSync(
    new URL('../../data/raw/eye_gaze_tracking_050505092026.csv', import.meta.url),
    'utf8',
  )
  const mockMeta = JSON.parse(
    readFileSync(new URL('../public/data-mock/meta.json', import.meta.url), 'utf8'),
  )
  const mockDataset = {
    origin: 'mock',
    meta: mockMeta,
    funnel: JSON.parse(readFileSync(new URL('../public/data-mock/funnel.json', import.meta.url), 'utf8')),
    sessions: JSON.parse(readFileSync(new URL('../public/data-mock/sessions.json', import.meta.url), 'utf8')),
    runs: JSON.parse(readFileSync(new URL('../public/data-mock/runs.json', import.meta.url), 'utf8')),
    visits: JSON.parse(readFileSync(new URL('../public/data-mock/visits.json', import.meta.url), 'utf8')),
    objectVisits: JSON.parse(
      readFileSync(new URL('../public/data-mock/object_visits.json', import.meta.url), 'utf8'),
    ),
    idle: JSON.parse(readFileSync(new URL('../public/data-mock/idle.json', import.meta.url), 'utf8')),
    rawSample: JSON.parse(readFileSync(new URL('../public/data-mock/raw_sample.json', import.meta.url), 'utf8')),
  }

  // 1. Verify all 159 real objects are extracted from raw CSV
  const extracted = extractObjectsForClassification(rawCsv, mockDataset)
  assert.equal(extracted.length, 159)
  assert.ok(extracted.some((item) => item.objectId === 'CodeSheet37kg' && item.events > 0))

  // 2. Verify CSV generation + alias normalization + processLog compatibility
  const sampleCandidates = [
    { objectId: 'CodeSheet37kg', events: 12, dwellS: 1.312, learners: 4 },
    { objectId: 'ChestSoundsHeart', events: 51, dwellS: 9.8, learners: 4 },
    { objectId: 'SPO2', events: 280, dwellS: 61.683, learners: 4 },
    { objectId: 'IV_Bag', events: 433, dwellS: 146.876, learners: 4 },
    { objectId: 'HeadFollower', events: 4314, dwellS: 1568.407, learners: 4 },
    { objectId: 'RoomCollider2', events: 22206, dwellS: 6297.032, learners: 4 },
  ]
  const claudeReply = JSON.stringify({
    mappings: {
      CodeSheet37kg: { lane: 'Reference', confidence: 'draft' },
      ChestSoundsHeart: { lane: 'Patient assessment', confidence: 'draft' },
      SPO2: { lane: 'Vital sign monitor', confidence: 'draft' },
      IV_Bag: { lane: 'Equipment', confidence: 'draft' }, // Alias -> Equipment & interventions
      HeadFollower: { lane: 'Communication', confidence: 'verify' },
      RoomCollider2: { lane: 'Environment', confidence: 'draft' },
    },
  })
  const built = buildLaneMapCsvFromResponse(sampleCandidates, claudeReply, 'claude-sonnet-5-5')
  assert.equal(fileKind(built.csvText), 'laneMap')
  assert.equal(built.clinicalObjects, 5)
  assert.equal(built.backgroundObjects, 1)
  assert.equal(built.verifyObjects, 1)

  const miniLog = [
    'user_id,session_id,object_id,gaze_time,time_stamp',
    '1,0,CodeSheet37kg,1.2,2026-06-01 10:00:00',
    '1,0,SPO2,2.0,2026-06-01 10:03:00',
    '1,0,IV_Bag,1.5,2026-06-01 10:06:00',
    '1,0,RoomCollider2,4.0,2026-06-01 10:07:00',
  ].join('\n')
  const processed = processLog(miniLog, built.csvText, mockMeta, 'mini.csv')
  assert.equal(processed.unmappedObjects.length, 0)
  assert.equal(processed.dataset.meta.objects.IV_Bag.lane, 'Equipment & interventions')
  assert.equal(processed.dataset.visits.length, 3) // RoomCollider2 excluded as background

  // 3. Verify matchLaneMapWithClaude API request via /api/match-lanes
  const origFetch = globalThis.fetch
  let capturedBody
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/match-lanes')
    capturedBody = JSON.parse(init.body)
    return new Response(
      JSON.stringify({ text: claudeReply, modelUsed: 'claude-sonnet-5-5', stopReason: 'end_turn' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  try {
    const matched = await matchLaneMapWithClaude({
      candidates: sampleCandidates,
      apiKey: 'sk-ant-test',
    })
    assert.equal(capturedBody.systemPrompt, CLAUDE_LANE_SYSTEM_PROMPT)
    assert.equal(matched.modelUsed, 'claude-sonnet-5-5')
    assert.equal(matched.clinicalObjects, 5)
  } finally {
    globalThis.fetch = origFetch
  }

  // 4. Verify applyLaneMapToBuiltInDataset updates built-in dataset immediately
  const mockCandidates = extractObjectsForClassification(undefined, mockDataset)
  const mockMappings = Object.fromEntries(
    mockCandidates.map((c) => [c.objectId, { lane: 'Reference', confidence: 'draft' }]),
  )
  const mockCsv = buildLaneMapCsvFromResponse(
    mockCandidates,
    JSON.stringify({ mappings: mockMappings }),
    'claude-sonnet-5-5',
  ).csvText
  const remapped = applyLaneMapToBuiltInDataset(mockDataset, mockCsv)
  assert.ok(Object.values(remapped.dataset.meta.objects).every((o) => o.lane === 'Reference'))

  // 5. Verify UploadClean renders Upload CSV + Match with Claude options
  const html = renderToStaticMarkup(
    createElement(UploadClean, {
      dataset: mockDataset,
      run: mockDataset.runs[0],
      minVisitS: 0.5,
      touchpoints: mockDataset.visits,
      files: {
        gaze: undefined,
        laneMap: { name: 'claude_lane_map.csv', size: 512, source: 'claude' },
        reading: false,
        matchingLanes: false,
        hasServerClaudeKey: true,
        error: undefined,
        note: undefined,
        addFiles: () => {},
        uploadLaneMapFile: () => {},
        matchLanesWithClaude: async () => true,
        downloadLaneMap: () => {},
        removeGaze: () => {},
        removeLaneMap: () => {},
      },
      openLanes: () => {},
      openLearner: () => {},
      learnerId: 1,
      setLearnerId: () => {},
    }),
  )
  assert.ok(html.includes('Upload CSV'))
  assert.ok(html.includes('Match with Claude'))
  assert.ok(html.includes('Download CSV'))
  assert.ok(html.includes('Claude AI'))

  console.log('Claude swimlane matching checks passed: 159 raw objects, 5 clinical lanes + background, API request, built-in remapping, and UI controls verified.')
} finally {
  await vite.close()
}
