import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const serviceKey = process.env.E2E_LOCAL_SERVICE_ROLE_KEY ?? ''
const enabled = process.env.GRIND_DB_E2E === '1' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)
test.skip(!enabled, 'requires the disposable local Supabase stack')
test.describe.configure({ timeout: 60_000 })

test.beforeEach(({ page }) => {
  if (process.env.GRIND_E2E_NETWORK_TRACE !== '1') return
  page.on('pageerror', error => console.error('page error', error.message))
  page.on('console', message => {
    if (message.type() === 'error') console.error('browser', message.text().slice(0, 300))
  })
  page.on('requestfailed', request => console.error('network', new URL(request.url()).pathname, request.failure()?.errorText))
})

type Fixture = { id: string; exercise: string; email: string; password: string }
const stamp = () => new Date().toISOString()

async function makeUser(service: SupabaseClient): Promise<Fixture> {
  const keyPart = randomUUID().replaceAll('-', '').slice(0, 12)
  const email = `fixture-${keyPart}@example.test`
  const password = randomUUID()
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw created.error
  const id = created.data.user.id
  const exercise = randomUUID()
  const results = await Promise.all([
    service.from('user_profiles').upsert({
      id, username: 'test' + keyPart, display_name: 'Workout fixture',
      setup_completed_at: stamp(), onboarding_skip_all: true,
    }),
    service.from('exercises').insert({
      id: exercise, user_id: id, name: 'Controlled Tempo Shoulder Press', day_type: 'push',
      sets_target: 1, reps_target: '8', weight_target: 95, active: true,
    }),
  ])
  for (const result of results) if (result.error) throw result.error
  return { id, exercise, email, password }
}

async function signIn(context: BrowserContext, who: Fixture, app: string) {
  const cookies: { name: string; value: string; url: string }[] = []
  const client = createServerClient(url, key, {
    cookies: { getAll: () => [], setAll: items => {
      for (const item of items) cookies.push({ name: item.name, value: item.value, url: app })
    } },
  })
  const { error } = await client.auth.signInWithPassword({ email: who.email, password: who.password })
  if (error) throw error
  await context.addCookies(cookies)
  return client
}

async function logSet(page: Page, reps: string) {
  const weight = page.getByRole('textbox', { name: 'Weight for set 1' })
  await weight.fill('95')
  await weight.press('Enter')
  const input = page.getByRole('textbox', { name: 'Reps for set 1' })
  await expect(input).toBeFocused()
  await input.fill(reps)
  await input.press('Enter')
}

test('offline finish survives a reload and reaches exactly one owner', async ({ page, browser, context, baseURL }) => {
  const service = createClient(url, serviceKey)
  const a = await makeUser(service)
  const b = await makeUser(service)
  const other = await browser.newContext()
  try {
    await signIn(context, a, baseURL!)
    await page.goto('/log?day=push')
    await expect(page.getByRole('textbox', { name: 'Weight for set 1' })).toBeVisible({ timeout: 20_000 })
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      registration.active?.postMessage({ type: 'WARM_WORKOUT_SHELL' })
    })
    await expect.poll(() => page.evaluate(async () => !!await caches.match('/offline-workout'))).toBe(true)
    await context.setOffline(true)
    await logSet(page, '8')
    await expect(page.getByRole('button', { name: /^Edit set 1/ })).toBeVisible()
    await page.locator('#workout-note').fill('Offline finish fixture')
    await page.getByRole('button', { name: /^finish workout$/i }).click()
    await expect(page.getByRole('button', { name: /^retry finish$/i })).toBeVisible()
    let resumed = page
    if (test.info().project.name === 'webkit') {
      // Playwright WebKit cannot navigate offline on the Windows test runner.
      // Restart the page with local connectivity to the shell but keep the app
      // offline through restore so no cloud request can satisfy the assertions.
      await page.evaluate(() => localStorage.setItem('grind-fixture-offline', '1'))
      await page.close()
      await context.setOffline(false)
      await context.addInitScript(() => {
        const online = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')?.get
        if (online) Object.defineProperty(navigator, 'onLine', {
          get: () => localStorage.getItem('grind-fixture-offline') !== '1' && online.call(navigator),
        })
      })
      resumed = await context.newPage()
      await resumed.goto('/offline-workout?day=push')
    } else {
      await page.reload()
    }
    await expect(resumed.getByRole('button', { name: /^retry finish$/i })).toBeVisible({ timeout: 20_000 })
    await expect(resumed.locator('#workout-note')).toHaveValue('Offline finish fixture')
    await signIn(other, b, baseURL!)
    await other.newPage().then(tab => tab.goto('/home'))
    await context.setOffline(false)
    if (resumed !== page) {
      await resumed.bringToFront()
      await resumed.evaluate(() => {
        localStorage.removeItem('grind-fixture-offline')
        window.dispatchEvent(new Event('online'))
      })
    }
    await expect.poll(async () => {
      const { data, error } = await service.from('sessions').select('note,completed_at').eq('user_id', a.id).single()
      if (error) return null
      return data.completed_at ? data.note : null
    }, { timeout: 25_000 }).toBe('Offline finish fixture')
    const { data } = await service.from('session_logs').select('reps').eq('exercise_id', a.exercise)
    const { count } = await service.from('sessions').select('id', { head: true, count: 'exact' }).eq('user_id', b.id)
    expect(data).toEqual([{ reps: 8 }])
    expect(count).toBe(0)
  } finally {
    await other.close()
    await service.auth.admin.deleteUser(a.id)
    await service.auth.admin.deleteUser(b.id)
  }
})

test('a refused discard preserves the workout and a lost acknowledgement can be retried', async ({ page, context, baseURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'Network fault interception uses Chromium. Both engines cover the server refusal below.')
  const service = createClient(url, serviceKey)
  const user = await makeUser(service)
  const rpc = '**/rest/v1/rpc/discard_open_workout'
  try {
    await signIn(context, user, baseURL!)
    await page.goto('/log?day=push')
    await logSet(page, '9')
    await expect.poll(async () => (await service.from('session_logs').select('reps')
      .eq('exercise_id', user.exercise).maybeSingle()).data?.reps).toBe(9)
    await page.route(rpc, route => route.fulfill({ status: 403, json: { code: '42501', message: 'fixture refused' } }))
    async function discard() {
      await page.getByRole('button', { name: 'Exit workout' }).filter({ visible: true }).first().click()
      await page.getByRole('button', { name: 'Discard Workout', exact: true }).click()
    }
    await discard()
    await expect(page.getByText('Could not confirm discard. Try again.')).toBeVisible()
    const afterRefusal = await service.from('session_logs').select('reps').eq('exercise_id', user.exercise)
    expect(afterRefusal.data).toEqual([{ reps: 9 }])
    await page.unroute(rpc)
    await page.route(rpc, async route => {
      const response = await route.fetch()
      expect(response.ok()).toBeTruthy()
      await route.fulfill({ status: 502, json: { code: 'PGRST000', message: 'fixture lost acknowledgement' } })
    })
    await discard()
    await expect(page.getByText('Could not confirm discard. Try again.')).toBeVisible()
    await expect.poll(async () => (
      await service.from('session_logs').select('id', { head: true, count: 'exact' }).eq('exercise_id', user.exercise)
    ).count).toBe(0)
    await page.unroute(rpc)
    await discard()
    await expect(page).toHaveURL(/\/log$/)
    expect((await service.from('session_logs').select('reps').eq('exercise_id', user.exercise)).data).toEqual([])
  } finally {
    await service.auth.admin.deleteUser(user.id)
  }
})

test('Coach reopens the newest turns and pages older turns with owner isolation', async ({ context, browser, baseURL }) => {
  const service = createClient(url, serviceKey)
  const a = await makeUser(service)
  const b = await makeUser(service)
  const other = await browser.newContext()
  try {
    const conversation = randomUUID()
    const { error } = await service.from('coach_conversations').insert({ id: conversation, user_id: a.id, title: 'Long thread' })
    if (error) throw error
    const start = Date.now() - 3600000
    const inserted = await service.from('coach_messages').insert(Array.from({ length: 220 }, (_, index) => ({
      user_id: a.id, conversation_id: conversation, role: 'assistant',
      content: `Saved message ${index + 1}`, created_at: new Date(start + index * 100).toISOString(),
    })))
    if (inserted.error) throw inserted.error
    await signIn(context, a, baseURL!)
    await signIn(other, b, baseURL!)
    const path = baseURL + '/api/coach/conversations/' + conversation
    const response = await context.request.get(path)
    expect(response.ok()).toBeTruthy()
    const latest = await response.json()
    expect(latest.messages[0].content).toBe('Saved message 161')
    expect(latest.messages.at(-1).content).toBe('Saved message 220')
    const older = await (await context.request.get(path, { params: { before: latest.olderCursor } })).json()
    expect(older.messages[0].content).toBe('Saved message 101')
    expect(older.messages.at(-1).content).toBe('Saved message 160')
    expect((await other.request.get(path)).status()).toBe(404)
  } finally {
    await other.close()
    await service.auth.admin.deleteUser(a.id)
    await service.auth.admin.deleteUser(b.id)
  }
})

test('a browser storage denial keeps the set editable and avoids a save confirmation', async ({ page, context, baseURL }) => {
  const service = createClient(url, serviceKey)
  const user = await makeUser(service)
  try {
    await signIn(context, user, baseURL!)
    await context.addInitScript(() => {
      IDBFactory.prototype.open = () => { throw new DOMException('Storage denied', 'SecurityError') }
    })
    await page.goto('/log?day=push')
    await logSet(page, '7')
    await expect(page.getByText('This edit could not be saved on this device. Try again.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark set 1 complete' })).toBeVisible()
    const result = await service.from('session_logs').select('id', { count: 'exact', head: true })
      .eq('exercise_id', user.exercise)
    expect(result.count).toBe(0)
  } finally {
    await service.auth.admin.deleteUser(user.id)
  }
})

test('two tabs retain the latest durable edit for the same set', async ({ page, context, baseURL }) => {
  const service = createClient(url, serviceKey)
  const user = await makeUser(service)
  const other = await context.newPage()
  try {
    await signIn(context, user, baseURL!)
    await Promise.all([page.goto('/log?day=push'), other.goto('/log?day=push')])
    for (const tab of [page, other]) {
      await expect(tab.getByRole('textbox', { name: 'Weight for set 1' })).toBeVisible()
    }
    await context.setOffline(true)
    await logSet(page, '7')
    await expect(page.getByText('Saved on this device. It will sync when you reconnect.')).toBeVisible()
    await logSet(other, '10')
    await expect(other.getByText('Saved on this device. It will sync when you reconnect.')).toBeVisible()
    await context.setOffline(false)
    await other.bringToFront()
    await other.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect.poll(async () => (await service.from('session_logs').select('reps')
      .eq('exercise_id', user.exercise)).data, { timeout: 20_000 }).toEqual([{ reps: 10 }])
  } finally {
    await context.setOffline(false)
    await other.close()
    await service.auth.admin.deleteUser(user.id)
  }
})

test('signed-in Progress and workout layouts remain usable at desktop and compact widths', async ({ page, context, baseURL }, info) => {
  const service = createClient(url, serviceKey)
  const user = await makeUser(service)
  try {
    await signIn(context, user, baseURL!)
    // A 720 CSS pixel viewport gives the reflow width of 1440px at 200% zoom.
    for (const [width, theme] of [[1440, 'dark'], [720, 'light'], [390, 'dark']] as const) {
      await page.setViewportSize({ width, height: 900 })
      await context.addCookies([{ name: 'grind_theme_pref', value: theme, url: baseURL! }])
      await page.goto('/progress')
      await expect(page.getByRole('heading', { name: 'Controlled Tempo Shoulder Press' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Open push workout' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const target = page.getByRole('link', { name: 'Open push workout' })
      await expect(target).toHaveAttribute('href', '/log?day=push')
      await page.goto('/log?day=push')
      const weight = page.getByRole('textbox', { name: 'Weight for set 1' })
      const reps = page.getByRole('textbox', { name: 'Reps for set 1' })
      await expect(weight).toBeVisible({ timeout: 20_000 })
      expect((await weight.boundingBox())?.width).toBe((await reps.boundingBox())?.width)
      await weight.focus()
      await weight.press('Enter')
      await expect(reps).toBeFocused()
      await page.screenshot({ path: info.outputPath(`workout-${width}-${theme}.png`) })
    }
  } finally {
    await service.auth.admin.deleteUser(user.id)
  }
})

test('data export downloads all sets above the API cap and surfaces a failed read', async ({ page, context, baseURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'download coverage runs in Chromium')
  const service = createClient(url, serviceKey)
  const user = await makeUser(service)
  try {
    const sessions = Array.from({ length: 20 }, (_, index) => {
      const completed = new Date(Date.now() - (index + 1) * 86400000)
      return {
        id: randomUUID(), user_id: user.id, day_type: 'push',
        started_at: new Date(completed.getTime() - 3600000).toISOString(),
        completed_at: completed.toISOString(), local_date: completed.toISOString().slice(0, 10),
      }
    })
    const seeded = await service.from('sessions').insert(sessions)
    if (seeded.error) throw seeded.error
    for (const session of sessions) {
      const logs = await service.from('session_logs').insert(Array.from({ length: 55 }, (_, index) => ({
        session_id: session.id, exercise_id: user.exercise, set_number: index + 1, weight: 95, reps: 8,
      })))
      if (logs.error) throw logs.error
    }
    await signIn(context, user, baseURL!)
    await page.goto('/profile/settings')
    await page.getByRole('tab', { name: /Data & Account/ }).click()
    const exportButton = page.getByRole('button', { name: /^Export Data/ })
    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
    const path = await download.path()
    const { readFile } = await import('node:fs/promises')
    const payload = JSON.parse(await readFile(path, 'utf8'))
    expect(payload.sessions).toHaveLength(20)
    expect(payload.session_logs).toHaveLength(1100)

    await page.route('**/rest/v1/session_logs?*', route => route.fulfill({
      status: 403, json: { code: '42501', message: 'fixture read failure' },
    }))
    await exportButton.click()
    await expect(page.getByText('Export failed. No file was downloaded. Try again.')).toBeVisible()
  } finally {
    await service.auth.admin.deleteUser(user.id)
  }
})

test('discard cannot delete a workout completed by another client', async ({ page, context, baseURL }) => {
  const service = createClient(url, serviceKey)
  const user = await makeUser(service)
  try {
    const secondClient = await signIn(context, user, baseURL!)
    await page.goto('/log?day=push')
    await logSet(page, '8')
    const existing = await service.from('sessions').select('id').eq('user_id', user.id).single()
    if (existing.error) throw existing.error
    await expect.poll(async () => (await service.from('session_logs').select('reps')
      .eq('exercise_id', user.exercise).maybeSingle()).data?.reps).toBe(8)
    const finished = await secondClient.rpc('complete_session', { p_session_id: existing.data.id })
    if (finished.error) throw finished.error
    await page.getByRole('button', { name: 'Exit workout' }).filter({ visible: true }).first().click()
    await page.getByRole('button', { name: 'Discard Workout' }).click()
    await expect(page.getByText('This workout was finished in another tab.')).toBeVisible()
    expect((await service.from('session_logs').select('reps').eq('exercise_id', user.exercise)).data)
      .toEqual([{ reps: 8 }])
  } finally {
    await service.auth.admin.deleteUser(user.id)
  }
})
