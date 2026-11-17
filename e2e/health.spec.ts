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
