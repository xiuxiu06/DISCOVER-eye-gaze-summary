import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  use: { baseURL: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173', channel: 'msedge', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  workers: 1,
})
