import { defineConfig, devices } from '@playwright/test'

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
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: process.env.CI ? 'npm run start' : 'npm run dev',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
