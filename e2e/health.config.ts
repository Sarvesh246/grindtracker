import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  testMatch: 'health.spec.ts',
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  use: { browserName: 'chromium', contextOptions: { reducedMotion: 'reduce' } }
})
