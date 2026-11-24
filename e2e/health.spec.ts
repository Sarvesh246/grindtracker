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
  readFileSync('src/components/health/recovery/recovery.css', 'utf8') +
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

const noOverflow = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)

for (const width of [320, 390, 430, 768, 1280])
  for (const light of [false, true]) {
    test(`overview ${width}px ${light ? 'light' : 'dark'}`, async ({ page }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await render(page, { width, light })
      await expect(page.getByRole('heading', { level: 1, name: 'Recovery' })).toBeVisible()
      await expect(page.locator('#sleep')).toHaveAttribute('aria-label', /^Sleep 7h 18m, score 81/)
      await expect(page.getByRole('img', { name: /^Charge \d+ of 100/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Vitals' })).toBeVisible()
      expect(await noOverflow(page)).toBe(true)
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
      await expect(page.getByRole('link', { name: 'Connect Garmin', exact: true })).toHaveCount(0)
    }
    if (state === 'disconnected')
      await expect(page.getByRole('link', { name: 'Connect Garmin', exact: true })).toBeVisible()
    if (state === 'partial') await expect(page.locator('#sleep')).toContainText('No sleep recorded')
    expect(await noOverflow(page)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${state}.png`), fullPage: true })
  })
}
for (const view of ['sleep', 'metric'])
  for (const width of [390, 1280])
    test(`${view} detail at ${width}px and large text`, async ({ page }, info) => {
      await render(page, { view, large: width === 390, width, light: width === 390 })
      expect(await noOverflow(page)).toBe(true)
      await expect(page.getByRole('link', { name: 'Back to Recovery' })).toHaveAttribute(
        'href',
        '/progress/health?date=2026-11-16'
      )
      await page.screenshot({ path: info.outputPath(`${view}-${width}.png`), fullPage: true })
    })
test('Garmin trends display coverage and keyboard controls on a narrow screen', async ({ page }) => {
  await render(page, { state: 'garmin', width: 320 })
  const section = page.getByRole('region', { name: 'Garmin Connect measurements' })
  await expect(section).toBeVisible()
  await section.getByLabel('Measurement').selectOption('overnight_hrv')
  await section.getByRole('button', { name: '7D', exact: true }).click()
  await expect(section).toContainText('1/7 days with readings')
  await expect(section).toContainText('49 ms')
  await section.getByText(/Measurements for /).click()
  await expect(section.getByText('45–55 ms')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('day strip, calendar, drivers and an editable Coach suggestion', async ({ page }) => {
  await render(page)
  const strip = page.getByRole('navigation', { name: 'Choose a day' })
  await expect(strip.locator('[aria-pressed="true"]')).toHaveCount(1)
  await strip.getByRole('button', { name: /Nov 15/ }).click()
  await page.getByRole('button', { name: 'Choose health date' }).click()
  await expect(page.getByLabel('Selected health date')).toHaveValue('2026-11-15')
  await page.getByRole('button', { name: 'Close date picker' }).click()
  await strip.getByRole('button', { name: /Nov 16/ }).click()
  const driver = page.getByRole('region', { name: 'What moved it' }).getByRole('button').first()
  await expect(driver).toHaveAttribute('aria-expanded', 'false')
  await driver.click()
  await expect(driver).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: /^Ask Coach about/ }).click()
  expect(await page.evaluate(() => window.healthFixture.draft)).toContain('2026-11-16')
  expect(await page.evaluate(() => window.healthFixture.sent)).toBeUndefined()
})
test('sleep stages are read by keyboard and have a table', async ({ page }) => {
  await render(page, { view: 'sleep' })
  const stages = page.getByRole('group', { name: /^Sleep stages from/ })
  await stages.focus()
  await stages.press('Home')
  await stages.press('ArrowRight')
  await expect(page.locator('.rcv-readout').first()).toContainText('Light')
  await page.getByText('Stage table', { exact: true }).click()
  await expect(page.getByRole('table').first()).toBeVisible()
})
test('metric trend windows, chips and coverage', async ({ page }) => {
  await render(page, { view: 'metric' })
  await expect(page.getByRole('heading', { level: 1, name: 'Resting HR' })).toBeVisible()
  await page.getByRole('button', { name: '90 days', exact: true }).click()
  await expect(page.getByText('90/90 days', { exact: false })).toBeVisible()
  const chips = page.getByRole('group', { name: 'Measurement' })
  await expect(chips.getByRole('link', { name: 'Resting HR' })).toHaveAttribute('aria-current', 'page')
  expect(await chips.evaluate((el) => !!el.closest('[data-swipe-ignore]'))).toBe(false)
  expect(await chips.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
})
test('charts are read by dragging, with no slider', async ({ page }) => {
  await render(page)
  await expect(page.getByRole('slider')).toHaveCount(0)
  const plot = page.getByRole('group', {
    name: 'Body Battery chart. Use left and right arrow keys to read values.'
  })
  await plot.scrollIntoViewIfNeeded()
  const box = (await plot.boundingBox())!
  const reading = page.locator('#day .rcv-readout')
  const y = box.y + box.height / 3
  await page.mouse.move(box.x + box.width * 0.2, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.3, y, { steps: 5 })
  const early = await reading.innerText()
  await page.mouse.move(box.x + box.width * 0.7, y, { steps: 10 })
  await page.mouse.up()
  expect(await reading.innerText()).not.toEqual(early)
  await expect(reading).toContainText('Stress')
  await plot.focus()
  await plot.press('End')
  await expect(reading).toContainText('8:00 PM')
  await plot.press('ArrowLeft')
  await expect(reading).toContainText('7:45 PM')
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
  const reading = page.locator('#day .rcv-readout')
  const client = await context.newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }]
    })
  const y = box.y + box.height / 3
  await touch('touchStart', box.x + box.width * 0.15, y)
  const first = await reading.innerText()
  for (let i = 1; i <= 12; i++) await touch('touchMove', box.x + box.width * (0.15 + i * 0.05), y)
  await touch('touchEnd', 0, 0)
  expect(await reading.innerText()).not.toEqual(first)
  await context.close()
})
test('the Progress card shows Charge, the week and opens Recovery', async ({ page }, info) => {
  await render(page, { width: 390 })
  const entry = page.locator('.rcv-entry')
  await expect(entry).toHaveAttribute('href', '/progress/health')
  await expect(entry).toHaveAttribute('aria-label', /^Recovery: Charge \d+/)
  await expect(entry.locator('.rcv-bars > i')).toHaveCount(7)
  await entry.screenshot({ path: info.outputPath('progress-card.png') })
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
    format: 'esm',
    jsx: 'automatic',
    tsconfig: 'tsconfig.json',
    loader: { '.css': 'empty' },
    define: {
      'process.env':
        '{"NODE_ENV":"production","NEXT_PUBLIC_SUPABASE_URL":"https://stub.supabase.co","NEXT_PUBLIC_SUPABASE_ANON_KEY":"stub"}'
    }
  }).outputFiles[0].text
  const workerBundle = buildSync({
    entryPoints: ['src/lib/health/garminExport.worker.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    tsconfig: 'tsconfig.json',
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
  await page.route('https://settings.test/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/fixtures/settings.js' || path === '/lib/health/garminExport.worker.ts') {
      return route.fulfill({
        contentType: 'application/javascript',
        body: path === '/fixtures/settings.js' ? bundle : workerBundle,
      })
    }
    return route.fulfill({
      contentType: 'text/html',
      body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{overflow:auto!important;height:auto!important}</style></head><body><div id="root"></div><script type="module" src="/fixtures/settings.js"></script></body></html>`
    })
  })
  await page.goto('https://settings.test/')
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
  await page.locator('input[type=file]').setInputFiles({
    name: 'oversized-entry.zip', mimeType: 'application/zip',
    buffer: Buffer.from(zipSync({ 'oversized_sleepData.json': new Uint8Array(9 * 1024 * 1024) })),
  })
  await expect(page.getByText(/This export exceeds the import limit/)).toBeVisible()
  expect(batches).toHaveLength(2)
  await page.screenshot({ path: test.info().outputPath('settings-import.png'), fullPage: true })
})

test('readiness trend: usual band, picked reading, status and empty state', async ({ page }, info) => {
  for (const width of [390, 1280]) {
    await render(page, { width })
    const panel = page.locator('#readiness')
    await expect(panel.getByText('HRV (RMSSD)')).toBeVisible()
    await expect(panel.getByText(/This morning: 47 ms, below your usual/)).toBeVisible()
    await expect(panel.locator('.health-readiness-status')).toHaveText('Below usual')
    await expect(panel.getByText(/Usual \d+–\d+ ms, from \d+ mornings/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await panel.screenshot({ path: info.outputPath(`readiness-${width}.png`) })
  }
  await render(page, { state: 'disconnected', width: 390 })
  await expect(page.locator('#readiness')).toHaveCount(0)
})

test('the Energy link spans the same width as the cards around it', async ({ page }) => {
  await render(page, { width: 390 })
  const entry = page.locator('.energy-entry')
  await expect(entry).toBeVisible()
  const [box, below] = await entry.evaluate((el) => [
    el.getBoundingClientRect().toJSON(),
    (el.nextElementSibling as HTMLElement).getBoundingClientRect().toJSON()
  ])
  expect(Math.round(box.x)).toBe(Math.round(below.x))
  expect(Math.round(box.width)).toBe(Math.round(below.width))
})
