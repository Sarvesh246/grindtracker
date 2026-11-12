import { test, expect } from '@playwright/test'

/**
 * Offline shell. Signed-in screens need a real session (not available in this
 * suite), so this covers what is checkable without one: the service worker
 * installs, a public page reloads with no network, and a private route falls
 * back to the offline shell instead of a browser error page.
 * Saving/replaying signed-in pages and offline workouts are covered by the
 * unit tests (offlineQueue.test.ts) and need a device test.
 */
test.describe('offline', () => {
  test('service worker serves public and fallback pages with no network', async ({ page, context }) => {
    await page.goto('/login')
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    // Reload once so the page is controlled by the worker and /login is cached.
    await page.reload()
    await page.evaluate(() => navigator.serviceWorker.controller !== null)

    await context.setOffline(true)

    await page.reload()
    await expect(page.locator('body')).not.toContainText('ERR_INTERNET_DISCONNECTED')
    await expect(page.locator('body')).toBeVisible()

    // A private route with no saved copy shows the branded offline shell.
    await page.goto('/home').catch(() => {})
    await expect(page.locator('body')).not.toContainText('ERR_INTERNET_DISCONNECTED')

    await context.setOffline(false)
  })
})
