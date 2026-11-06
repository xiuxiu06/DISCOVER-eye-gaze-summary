import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const report = JSON.parse(readFileSync(new URL('../../tests/fixtures/claude-report.json', import.meta.url), 'utf8'))
function csv(users: number[]) {
  return 'user_id,session_id,object_id,gaze_time,time_stamp\n' + users.flatMap((user) => ['10:00:00', '10:03:00', '10:06:00'].map((time) => `${user},0,RR,1,2026-06-01 ${time}`)).join('\n')
}
const file = (name: string, users: number[]) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(csv(users)) })

test('Python upload, explicit matching, report, reload, retries and invalidation', async ({ page }) => {
  let starts = 0, polls = 0, fail = false
  const analysisRequests: string[] = []
  page.on('request', (request) => { if (request.url().includes('/api/analyze')) analysisRequests.push(request.postData() ?? '') })
  await page.route('**/api/report-jobs', async (route) => {
    starts++
    const body = route.request().postDataJSON()
    expect(body.matching).toEqual({ user1: 'idealUser1', user2: 'idealUser2', user3: null, user4: null })
    expect(JSON.stringify(body)).not.toContain('api_key')
    await route.fulfill({ json: { jobId: 'mock-job' }, status: 202 })
  })
  await page.route('**/api/report-jobs/mock-job', async (route) => {
    polls++
    if (fail) { await route.fulfill({ json: { status: 'failed', error: 'Mock network error; retry generation.' } }); return }
    if (polls === 1) { await route.fulfill({ json: { status: 'pending' } }); return }
    const data = structuredClone(report)
    data.reports = { user1: data.reports.user1, user2: data.reports.user2 }
    data.unmatched_learners = ['user3', 'user4']
    await route.fulfill({ json: { status: 'completed', report: data } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Upload and clean' })).toBeVisible()
  await page.getByTestId('upload-input').setInputFiles(file('learner.csv', [0, 1, 2, 3, 4]))
  await expect(page.getByText('Processed by Python.', { exact: true })).toBeVisible()
  await page.getByLabel('Ideal gaze log').setInputFiles(file('ideal.csv', [10, 20, 30, 40]))
  await expect(page.getByRole('combobox', { name: 'Learner 1', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Learner 1', exact: true }).selectOption('idealUser1')
  await expect(page.getByRole('combobox', { name: 'Learner 2', exact: true }).locator('option[value="idealUser1"]')).toBeDisabled()
  await page.getByRole('combobox', { name: 'Learner 2', exact: true }).selectOption('idealUser2')
  await page.getByRole('button', { name: '3 Report card' }).click()
  await expect(page.getByRole('button', { name: 'Generate report', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Generate report', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Claude is generating' })).toBeVisible()
  await page.getByRole('button', { name: '2 Team swim lanes' }).click()
  await page.getByRole('button', { name: '3 Report card' }).click()
  await expect(page.getByRole('heading', { name: 'Executive summary' })).toBeVisible()
  await expect(page.getByTestId('claude-report')).toContainText(report.reports.user1.executive_summary)
  await expect(page.getByTestId('claude-report')).not.toContainText(report.reports.user0.executive_summary)
  await page.screenshot({ path: 'test-results/claude-report.png', fullPage: true })
  await page.pdf({ path: 'test-results/claude-report.pdf', format: 'A4', printBackground: true })
  await page.getByRole('combobox', { name: 'Learner', exact: true }).selectOption('2')
  await expect(page.getByTestId('claude-report')).toContainText(report.reports.user2.executive_summary)
  await page.getByRole('combobox', { name: 'Learner', exact: true }).selectOption('3')
  await expect(page.getByRole('heading', { name: 'No report for user3' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Learner', exact: true }).selectOption('1')
  await page.getByLabel('Debrief notes').fill('Review capture quality before debrief.')
  await page.getByRole('button', { name: 'Save note', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Upload and clean' })).toBeVisible()
  await page.getByRole('button', { name: '3 Report card' }).click()
  await expect(page.getByTestId('claude-report')).toContainText(report.reports.user1.executive_summary)
  await expect(page.getByLabel('Debrief notes')).toHaveValue('Review capture quality before debrief.')
  expect(starts).toBe(1)
  await expect(page.getByRole('heading', { name: 'Attention over the session' })).not.toBeVisible()
  await page.getByText('Recorded metrics - selected team run', { exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Attention over the session' })).toBeVisible()
  fail = true
  await page.getByRole('button', { name: 'Regenerate report', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Mock network error')
  await expect(page.getByTestId('claude-report')).toContainText(report.reports.user1.executive_summary)
  await page.getByRole('button', { name: '1 Upload & clean' }).click()
  await page.getByRole('combobox', { name: 'Learner 1', exact: true }).selectOption('')
  await page.getByRole('button', { name: '3 Report card' }).click()
  await expect(page.getByTestId('claude-report')).toHaveCount(0)
  expect(analysisRequests.length).toBeGreaterThanOrEqual(3)
  expect(analysisRequests.join('')).not.toContain('ANTHROPIC_API_KEY')
  await page.getByRole('button', { name: '1 Upload & clean' }).click()
  await page.getByTestId('upload-input').setInputFiles(file('replacement.csv', [8]))
  await expect(page.getByRole('combobox', { name: 'Learner 8', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '3 Report card' }).click()
  await expect(page.getByTestId('claude-report')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Generate report', exact: true })).toBeDisabled()
  await page.screenshot({ path: 'test-results/report-flow.png', fullPage: true })
})

test('missing ideal and backend failure remain actionable', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('upload-input').setInputFiles(file('learner.csv', [1, 2]))
  await expect(page.getByText('Processed by Python.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '3 Report card' }).click()
  await expect(page.getByRole('button', { name: 'Generate report', exact: true })).toBeDisabled()
  await expect(page.getByText('Upload an ideal-user CSV in tab 1 to enable AI reports.')).toBeVisible()
  await page.getByRole('button', { name: '1 Upload & clean' }).click()
  await page.route('**/api/analyze', (route) => route.abort())
  await page.getByTestId('upload-input').setInputFiles(file('other.csv', [8]))
  await expect(page.getByRole('alert')).toContainText('Python backend is unavailable')
  await expect(page.getByText('learner.csv', { exact: true })).toBeVisible()
})
