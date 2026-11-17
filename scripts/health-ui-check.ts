/** Opt-in integration check: creates one synthetic account and deletes it in finally. */
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { date, days, sleep } from '../e2e/fixtures/healthData'

async function main() {
  if (!process.argv.includes('--allow-temporary-account'))
    throw new Error(
      'Pass --allow-temporary-account to authorize one disposable synthetic account on the configured project.'
    )
  const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const suffix = randomUUID()
  const email = `health-ui-${suffix}@example.invalid`,
    password = randomUUID() + randomUUID()
  let userId: string | null = null
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  const check = (result: { error: { message: string } | null }) => {
    if (result.error) throw new Error(result.error.message)
  }
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    check(created)
    userId = created.data.user!.id
    check(
      await admin
        .from('user_profiles')
        .upsert({
          id: userId,
          username: `hui_${suffix.slice(0, 8)}`,
          display_name: 'Synthetic Health UI',
          setup_completed_at: new Date().toISOString(),
          onboarding_skip_all: true,
          onboarding_tooltips_skipped: true
        })
    )
    browser = await chromium.launch()
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: 'America/Chicago',
      reducedMotion: 'reduce'
    })
    const auth = createServerClient(url, anon, {
      cookies: {
        getAll: () => [],
        setAll: async (values) => {
          await context.addCookies(
            values.map((c) => ({
              name: c.name,
              value: c.value,
              url: base,
              sameSite: 'Lax' as const
            }))
          )
        }
      }
    })
    check(await auth.auth.signInWithPassword({ email, password }))
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    let coachPosts = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/coach/chat')) coachPosts++
    })
    await mkdir('test-results/health-app', { recursive: true })
    await page.goto(`${base}/progress`)
    await expect(page.getByRole('heading', { name: 'NO PROGRESS YET' })).toBeVisible({
      timeout: 15000
    })
    await expect(page.getByRole('link', { name: /Health & recovery/ })).toBeVisible()
    await page.screenshot({
      path: 'test-results/health-app/progress-no-exercises.png',
      fullPage: true
    })
    check(await admin.from('daily_body').insert(days.map((d) => ({ ...d, user_id: userId }))))
    const connection = randomUUID()
    check(
      await admin
        .from('health_connections')
        .insert({
          id: connection,
          user_id: userId,
          source: 'garmin_personal',
          device_id: 'synthetic-ui'
        })
    )
    check(
      await admin
        .from('sleep_sessions')
        .insert({ ...sleep, user_id: userId, connection_id: connection })
    )
    for (const width of [320, 390, 430, 768, 1280])
      for (const theme of ['dark', 'light']) {
        await page.setViewportSize({ width, height: 844 })
        await context.addCookies([{ name: 'grind_theme_pref', value: theme, url: base }])
        await page.goto(`${base}/progress/health?date=${date}`)
        await expect(page.locator('#sleep').getByText('7h 18m', { exact: true })).toBeVisible({
          timeout: 15000
        })
        await page.evaluate(() => document.fonts.ready)
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true
        )
        await expect(
          page.locator('nav[aria-label="Primary"]:visible').getByRole('link', { name: 'Progress' })
        ).toHaveAttribute('aria-current', 'page')
        await page.screenshot({
          path: `test-results/health-app/synthetic-overview-${width}-${theme}.png`,
          fullPage: true
        })
      }
    await page.setViewportSize({ width: 390, height: 844 })
    for (const route of ['sleep', 'metrics/resting_hr', 'metrics/overnight_hrv']) {
      await page.goto(`${base}/progress/health/${route}?date=${date}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({
        timeout: 15000
      })
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({
        path: `test-results/health-app/synthetic-${route.replaceAll('/', '-')}.png`,
        fullPage: true
      })
    }
    await page.goto(`${base}/progress/health?date=${date}`)
    await page.getByRole('button', { name: /Ask Coach/ }).click()
    await expect(page.getByRole('textbox', { name: 'Message to Coach' })).toHaveValue(
      new RegExp(date),
      { timeout: 15000 }
    )
    assert.equal(coachPosts, 0, 'opening the suggested question must not send a chat turn')
    await page.keyboard.press('Escape')
    const invalid = await page.goto(`${base}/progress/health/metrics/not-a-metric`)
    // Next's streamed notFound response can retain HTTP 200; the invalid
    // metric must still render its not-found boundary, never metric content.
    assert.ok(invalid && [200, 404].includes(invalid.status()))
    await expect(page.getByRole('heading', { name: 'MEASUREMENT NOT FOUND' })).toBeVisible()
    const longName =
      'Single-arm cable row with a controlled pause and a deliberately long exercise name'
    check(
      await admin.from('exercises').insert([
        {
          user_id: userId,
          name: 'Bench press',
          day_type: 'push',
          sets_target: 3,
          reps_target: '8',
          sort_order: 0
        },
        {
          user_id: userId,
          name: longName,
          day_type: 'pull',
          sets_target: 3,
          reps_target: '8',
          sort_order: 0
        }
      ])
    )
    await page.goto(`${base}/progress`)
    await page.getByRole('button', { name: 'pull', exact: true }).click()
    await expect(page.getByRole('button', { name: longName })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await page.getByRole('tab', { name: 'Volume', exact: true }).click()
    await page.locator('.app-main').evaluate((el) => {
      el.scrollTop = 48
    })
    await page.getByRole('link', { name: /Health & recovery/ }).click()
    await expect(page.getByRole('heading', { name: 'HEALTH', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '‹ Progress', exact: true }).click()
    await expect(page.getByRole('button', { name: longName })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(page.getByRole('tab', { name: 'Volume', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await page.screenshot({
      path: 'test-results/health-app/progress-restored-long-name.png',
      fullPage: true
    })
    check(
      await admin.storage
        .from('progress-photos')
        .upload(
          `${userId}/health-ui/pixel.png`,
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
            'base64'
          ),
          { contentType: 'image/png' }
        )
    )
    const deletion = await context.request.post(`${base}/api/profile/delete-data`, {
      data: { confirmation: 'DELETE' }
    })
    assert.equal(
      deletion.status(),
      200,
      'Storage API and database account cleanup must both complete'
    )
    const remaining = await admin.from('sleep_sessions').select('provider_id').eq('user_id', userId)
    check(remaining)
    assert.equal(remaining.data?.length, 0)
    assert.deepEqual(errors, [], 'no browser runtime/hydration errors')
    console.log(
      'Signed-in Health shell checks passed; screenshots contain one disposable synthetic account only.'
    )
  } catch (error) {
    console.error('Integration check:', error instanceof Error ? error.stack : 'failed')
    throw error
  } finally {
    await browser?.close()
    if (userId) {
      check(await admin.storage.from('progress-photos').remove([`${userId}/health-ui/pixel.png`]))
      // The historical user_stats/profile foreign keys do not cascade. Remove
      // only this script's newly-created synthetic rows before deleting Auth.
      check(await admin.from('user_stats').delete().eq('user_id', userId))
      check(await admin.from('user_profiles').delete().eq('id', userId))
      check(await admin.auth.admin.deleteUser(userId))
      console.log('Disposable Health UI account deleted.')
    }
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Health UI check failed')
  process.exitCode = 1
})
