// Checks that the browser upload (src/processLog.ts) gives the same result as the
// Python pipeline, so the two can't drift apart unnoticed. Needs the pipeline's
// output in public/data/ and the gaze log in data/raw/.
// Run with: npm run check:upload

import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const fromApp = (path) => new URL(`../${path}`, import.meta.url)
const readJson = (name) => JSON.parse(readFileSync(fromApp(`public/data/${name}.json`), 'utf8'))
const text = (path) => readFileSync(fromApp(path), 'utf8')

// Both sides round, but they break ties differently: one last digit either way is fine.
// Totals in seconds have 1 decimal, and the other times have 3.
const allowedDifference = (path) => (/seconds$/i.test(path) ? 0.11 : 0.0011)

function differences(python, browser, path, found) {
  if (typeof python === 'number' && typeof browser === 'number') {
    if (Math.abs(python - browser) > allowedDifference(path)) {
      found.push(`${path}: python ${python}, browser ${browser}`)
    }
  } else if (Array.isArray(python) && Array.isArray(browser)) {
    if (python.length !== browser.length) found.push(`${path}: python ${python.length} items, browser ${browser.length}`)
    python.slice(0, browser.length).forEach((item, i) => differences(item, browser[i], `${path}[${i}]`, found))
  } else if (python && browser && typeof python === 'object' && typeof browser === 'object') {
    for (const key of new Set([...Object.keys(python), ...Object.keys(browser)])) {
      differences(python[key], browser[key], `${path}.${key}`, found)
    }
  } else if (python !== browser) {
    found.push(`${path}: python ${JSON.stringify(python)}, browser ${JSON.stringify(browser)}`)
  }
}

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
let failed = false
try {
  const { processLog } = await vite.ssrLoadModule('/src/processLog.ts')
  const meta = readJson('meta')
  const started = performance.now()
  const { dataset, skippedRows } = processLog(
    text('../data/raw/eye_gaze_tracking_050505092026.csv'),
    text('../data/lane_map.csv'),
    meta,
    meta.source.split('. ')[0] + '.csv',
  )
  console.log(`Processed in ${Math.round(performance.now() - started)} ms, ${skippedRows} rows skipped`)

  const pairs = [
    ['funnel', dataset.funnel],
    ['sessions', dataset.sessions],
    ['runs', dataset.runs],
    ['visits', dataset.visits],
    ['object_visits', dataset.objectVisits],
    ['idle', dataset.idle],
    ['raw_sample', dataset.rawSample],
  ]
  for (const [name, browser] of pairs) {
    const found = []
    differences(readJson(name), browser, name, found)
    console.log(`${name}: ${browser.length} items, ${found.length} differences`)
    found.slice(0, 5).forEach((line) => console.log(`  ${line}`))
    if (found.length > 0) failed = true
  }
  const found = []
  differences(meta.objects, dataset.meta.objects, 'meta.objects', found)
  console.log(`meta.objects: ${Object.keys(dataset.meta.objects).length} items, ${found.length} differences`)
  found.slice(0, 5).forEach((line) => console.log(`  ${line}`))
  if (found.length > 0) failed = true
} finally {
  await vite.close()
}
if (failed) process.exit(1)
