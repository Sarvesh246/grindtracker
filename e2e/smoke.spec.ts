import { test, expect } from '@playwright/test'

test.describe('public shell', () => {
  test('login page renders GRIND brand and Google sign-in', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByText('GRIND').first()).toBeVisible()
    // Google OAuth button copy varies slightly; look for Continu/Sign with Google.
    await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible({
      timeout: 15_000,
    })
  })

  test('root redirects into the app or login', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.ok() || res?.status() === 307 || res?.status() === 308).toBeTruthy()
    await expect(page).toHaveURL(/\/(login|home|setup)/)
  })
})
