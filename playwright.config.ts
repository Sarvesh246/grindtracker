import { defineConfig, devices } from '@playwright/test'

const requestedPort = Number(process.env.PLAYWRIGHT_PORT ?? 3000)
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536 ? requestedPort : 3000
const localUrl = `http://127.0.0.1:${port}`

/**
 * Smoke e2e against a running app. Locally it starts `npm run dev`; in CI it
 * serves the production build (`npm run build` first), which is what ships and
 * has no first-request compile delay to race the 30s test timeout.
 * Auth-gated flows need a real session — this suite covers the public shell.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? localUrl,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.GRIND_DB_E2E === '1' ? [
      { name: 'webkit', testMatch: /workout-durability\.spec\.ts/, use: { ...devices['Desktop Safari'] } },
    ] : []),
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `npm run ${process.env.CI ? 'start' : 'dev'} -- --port ${port}`,
        url: localUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
