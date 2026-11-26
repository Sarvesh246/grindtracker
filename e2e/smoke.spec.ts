import { test, expect } from '@playwright/test'

test.describe('public shell', () => {
  test('private writes reject cross-origin requests and require authentication', async ({ request, baseURL }) => {
    const path = '/api/profile/delete-data'
    const data = { confirmation: 'DELETE' }
    const crossOrigin = await request.post(path, { data, headers: { origin: 'https://outside.example' } })
    expect(crossOrigin.status()).toBe(403)
    const sameOrigin = await request.post(path, { data, headers: { origin: new URL(baseURL!).origin } })
    expect(sameOrigin.status()).toBe(401)
  })

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
