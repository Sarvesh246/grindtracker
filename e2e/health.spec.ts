import { test, expect } from '@playwright/test'
import { buildSync } from 'esbuild'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const bundle = buildSync({
  entryPoints: ['e2e/fixtures/health.tsx'],
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  tsconfig: 'tsconfig.json',
  loader: { '.css': 'empty' },
  define: { 'process.env': '{"NODE_ENV":"production"}' }
}).outputFiles[0].text
const fonts = [
  ['bebas-neue', 'Bebas Neue'],
  ['dm-sans', 'DM Sans'],
  ['jetbrains-mono', 'JetBrains Mono']
]
  .map(([directory, family]) => {
    const folder = path.join('node_modules/@fontsource', directory, 'files')
    const file = readdirSync(folder).find((f) => f.includes('latin-400-normal.woff2'))!
    return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${readFileSync(path.join(folder, file)).toString('base64')}) format('woff2');font-style:normal;font-weight:400;font-display:swap}`
  })
  .join('\n')
const css =
  readFileSync('src/app/globals.css', 'utf8').replace(/^@import.*;\s*$/gm, '') +
  readFileSync('src/components/health/health.css', 'utf8') +
  readFileSync('src/components/health/health-entry.css', 'utf8') +
  readFileSync('src/components/health/health-import.css', 'utf8') +
  fonts

async function render(
  page: import('@playwright/test').Page,
  options: { width?: number; light?: boolean; state?: string; view?: string; large?: boolean } = {}
) {
  await page.setViewportSize({ width: options.width ?? 390, height: 844 })
  await page.route('https://health.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html class="${options.light ? 'light' : ''}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{overflow:auto!important;height:auto!important}html{${options.large ? 'font-size:200%;' : ''}}</style></head><body><div id="root"></div></body></html>`
    })
  )
  await page.goto(
    `https://health.test/?state=${options.state ?? 'populated'}&view=${options.view ?? 'overview'}`
  )
  await page.addScriptTag({ content: bundle })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

for (const width of [320, 390, 430, 768, 1280])
  for (const light of [false, true]) {
    test(`overview ${width}px ${light ? 'light' : 'dark'}`, async ({ page }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await render(page, { width, light })
      await expect(page.locator('#sleep').getByText('7h 18m', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      )
      await page.screenshot({
        path: info.outputPath(`health-${width}-${light ? 'light' : 'dark'}.png`),
        fullPage: true
      })
      expect(errors).toEqual([])
    })
  }
for (const state of ['disconnected', 'partial', 'delayed', 'error', 'loading']) {
  test(`${state} state remains honest and fits mobile`, async ({ page }, info) => {
    await render(page, { state, width: 320 })
    if (state === 'error') {
      await expect(page.getByRole('alert')).toBeVisible()
      await page.getByRole('button', { name: 'Retry' }).click()
      expect(await page.evaluate(() => window.healthFixture.refreshes)).toBe(1)
      await expect(page.getByText('Connect Garmin ›', { exact: true })).toHaveCount(0)
    }
    if (state === 'disconnected')
      await expect(page.getByText('Connect Garmin ›', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${state}.png`), fullPage: true })
  })
}
for (const view of ['sleep', 'metric'])
  test(`${view} detail and large text`, async ({ page }, info) => {
    await render(page, { view, large: true, width: 390, light: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('link', { name: '‹ Health' })).toHaveAttribute(
      'href',
      '/progress/health?date=2026-11-16'
    )
    await page.screenshot({ path: info.outputPath(`${view}-large.png`), fullPage: true })
  })
test('date navigation, stage keyboard, table alternatives and editable Coach suggestion', async ({
  page
}) => {
  await render(page)
  await page.getByRole('button', { name: 'Previous day' }).click()
  await page.getByRole('button', { name: 'Choose health date' }).click()
  await expect(page.getByLabel('Selected health date')).toHaveValue('2026-11-15')
  await page.getByRole('button', { name: 'Close date picker' }).click()
  await page.getByRole('button', { name: 'Next day' }).click()
  await page.getByRole('button', { name: 'Ask Coach' }).click()
  expect(await page.evaluate(() => window.healthFixture.draft)).toContain('2026-11-16')
  expect(await page.evaluate(() => window.healthFixture.sent)).toBeUndefined()
  const stage = page.getByRole('group', { name: /Sleep stages/ })
  await stage.focus()
  await stage.press('ArrowRight')
  await expect(page.locator('.health-chart-reading').first()).toContainText('Light')
  await page.getByText('Read stage intervals', { exact: true }).click()
  await expect(page.getByRole('table').first()).toBeVisible()
  await page.getByRole('button', { name: '90 days', exact: true }).click()
  await expect(page.getByText('90 of 90 days recorded.', { exact: false })).toBeVisible()
})
test('charts are read by dragging, with no slider', async ({ page }) => {
  await render(page)
  await expect(page.getByRole('slider')).toHaveCount(0)
  const plot = page.getByRole('group', {
    name: 'Body Battery chart. Use left and right arrow keys to read values.'
  })
  await plot.scrollIntoViewIfNeeded()
  const box = (await plot.boundingBox())!
  const reading = page.locator('.health-page .health-chart-reading').last()
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * 0.2, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.3, y, { steps: 5 })
  const early = await reading.innerText()
  await page.mouse.move(box.x + box.width * 0.7, y, { steps: 10 })
  await page.mouse.up()
  expect(await reading.innerText()).not.toEqual(early)
  // The shared cursor follows on the stress chart too.
  await expect(reading).toContainText('Energy')
})
test('touch drag scrubs a chart', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 }
  })
  const page = await context.newPage()
  await render(page)
  const plot = page.getByRole('group', {
    name: 'Body Battery chart. Use left and right arrow keys to read values.'
  })
  await plot.scrollIntoViewIfNeeded()
  const box = (await plot.boundingBox())!
  const reading = page.locator('.health-page .health-chart-reading').last()
  const client = await context.newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }]
    })
  const y = box.y + box.height / 2
  await touch('touchStart', box.x + box.width * 0.15, y)
  const first = await reading.innerText()
  for (let i = 1; i <= 12; i++) await touch('touchMove', box.x + box.width * (0.15 + i * 0.05), y)
  await touch('touchEnd', 0, 0)
  expect(await reading.innerText()).not.toEqual(first)
  await context.close()
})

test('horizontal pill rows and the date strip can scroll and are not swipe-ignored', async ({
  page
}) => {
  await render(page, { width: 360 })
  for (const selector of ['.health-chips-scroll', '.health-strip']) {
    const row = page.locator(selector).first()
    await row.scrollIntoViewIfNeeded()
    // The app's iOS haptic layer refuses to forward scrolls inside data-swipe-ignore.
    expect(await row.evaluate((el) => !!el.closest('[data-swipe-ignore]'))).toBe(false)
    expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    const moved = await row.evaluate((el) => {
      el.scrollLeft = 0
      el.scrollLeft += 120
      return el.scrollLeft
    })
    expect(moved).toBeGreaterThan(0)
  }
})
test('chart axis labels line up with the plot, not the y-label gutter', async ({ page }) => {
  await render(page, { width: 390 })
  const plot = page.locator('.health-plot').first()
  const axis = page.locator('.health-axis-plot').first()
  const svg = plot.locator('svg').first()
  await svg.scrollIntoViewIfNeeded()
  const [s, a] = await Promise.all([svg.boundingBox(), axis.locator('span').first().boundingBox()])
  expect(Math.abs(a!.x - s!.x)).toBeLessThan(10)
})

test('Settings: a Garmin export zip is previewed and imported in batches through the RPC', async ({
  page
}) => {
  const { zipSync, strToU8 } = await import('fflate')
  const night = (n: number) => {
    const d = new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
    return {
      calendarDate: d,
      sleepStartTimestampGMT: `${d}T05:00:00.0`,
      sleepEndTimestampGMT: `${d}T13:00:00.0`,
      deepSleepSeconds: 5400,
      lightSleepSeconds: 14400,
      remSleepSeconds: 6000,
      awakeSleepSeconds: 1800,
      sleepScores: { overallScore: 70 + (n % 20) }
    }
  }
  const zip = zipSync({
    'DI_CONNECT/DI-Connect-Wellness/2026_sleepData.json': strToU8(
      JSON.stringify(Array.from({ length: 20 }, (_, i) => night(i + 2)))
    ),
    'DI_CONNECT/DI-Connect-Fitness/big.fit': new Uint8Array(5000)
  })
  const bundle = buildSync({
    entryPoints: ['e2e/fixtures/healthImport.tsx'],
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    tsconfig: 'tsconfig.json',
    loader: { '.css': 'empty' },
    define: {
      'process.env':
        '{"NODE_ENV":"production","NEXT_PUBLIC_SUPABASE_URL":"https://stub.supabase.co","NEXT_PUBLIC_SUPABASE_ANON_KEY":"stub"}'
    }
  }).outputFiles[0].text
  const batches: { source: string; count: number }[] = []
  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/rpc/import_health_batch')) {
      const body = route.request().postDataJSON()
      batches.push({ source: body.p_source, count: body.p_batch.sleeps.length })
      return route.fulfill({ contentType: 'application/json', body: '{"acknowledged":"x"}' })
    }
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('https://settings.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{overflow:auto!important;height:auto!important}</style></head><body><div id="root"></div></body></html>`
    })
  )
  await page.goto('https://settings.test/')
  await page.addScriptTag({ content: bundle })
  await page.getByText('1 · Garmin data export (file upload)').click()
  await page.locator('input[type=file]').setInputFiles({
    name: 'garmin-export.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zip)
  })
  await expect(page.getByText('20 nights', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('Most recent nights in this file')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Import 20 nights' }).click()
  await expect(page.getByText('Imported 20 nights.')).toBeVisible()
  expect(batches).toEqual([
    { source: 'garmin_export', count: 14 },
    { source: 'garmin_export', count: 6 }
  ])
  await page.screenshot({ path: test.info().outputPath('settings-import.png'), fullPage: true })
})
