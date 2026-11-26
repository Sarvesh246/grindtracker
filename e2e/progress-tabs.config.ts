import { defineConfig, devices } from '@playwright/test'

// Fixture-only (no dev server, no account): the real ProgressTabs component,
// haptics overlay and app CSS, driven by touch events on an emulated iPhone.
export default defineConfig({
  testDir: '.',
  testMatch: 'progress-tabs.spec.ts',
  fullyParallel: true,
  use: { trace: 'off' },
  projects: [
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
})
