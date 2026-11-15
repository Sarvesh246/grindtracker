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

  // `/` is the public landing page for signed-out visitors (a signed-in user is
  // redirected to /home), so a fresh browser stays on `/` and sees the brand.
  test('root serves the landing page to a signed-out visitor', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.ok()).toBeTruthy()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('GRIND').first()).toBeVisible()
  })
})
