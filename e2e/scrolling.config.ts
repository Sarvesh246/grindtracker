import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'scrolling.spec.ts',
  fullyParallel: true,
  // Tracing screenshots distort WebKit frame cadence during scroll benchmarks.
  use: { trace: 'off' },
  projects: [
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
})
