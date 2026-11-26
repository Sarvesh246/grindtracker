import { test, expect, type Page } from '@playwright/test'
import { buildSync } from 'esbuild'
import { readFileSync } from 'node:fs'

/**
 * The Progress Lifts / Recovery / Body bar as it runs in the iOS home-screen
 * app: the real ProgressTabs component, the real haptic switch overlays
 * (iPhone UA, no navigator.vibrate) and tap-drag guard, and the app CSS.
 *
 * Gestures are sent as touch events ONLY. On a real iPhone, once the finger
 * is on a tab's `<input switch>` overlay WebKit can stop sending pointer
 * events while touchmove keeps reporting the finger — which is why a
 * pointer-driven drag worked in desktop Chromium and did nothing on the phone.
 */

const bundle = buildSync({
  stdin: {
    contents: `
      import { createElement, useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import ProgressTabs from './src/app/(app)/progress/ProgressTabs'
      import { setupHaptics, setupTapDragGuard } from './src/lib/utils/haptics'
      const TABS = [{ id: 'lifts', label: 'Lifts' }, { id: 'recovery', label: 'Recovery' }, { id: 'body', label: 'Body' }]
      function App() {
        const [tab, setTab] = useState('lifts')
        return createElement('div', { id: 'app', 'data-tab': tab }, createElement(ProgressTabs, { tabs: TABS, value: tab, onChange: setTab }))
      }
      setupHaptics(); setupTapDragGuard()
      createRoot(document.getElementById('root')).render(createElement(App))
    `,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  tsconfig: 'tsconfig.json',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
}).outputFiles[0].text
const css = readFileSync('src/app/globals.css', 'utf8')

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'userAgent', { value: 'iPhone', configurable: true })
  })
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>
    <div class="app-shell"><main class="app-main" style="height:600px;flex:none;padding:16px">
      <div id="root"></div>
      <div style="height:4000px">Progress content</div>
    </main></div>`)
  await page.addScriptTag({ content: bundle })
  await page.waitForSelector('.progress-tabs button[data-haptic] [data-haptic-overlay]')
})

const selected = (page: Page) => page.locator('#app').getAttribute('data-tab')
const thumbX = (page: Page) =>
  page.locator('.progress-tabs-thumb').evaluate(el => Math.round(new DOMMatrix(getComputedStyle(el).transform).m41))

/** Touch-only gesture starting on the given tab's switch overlay. */
async function touchDrag(page: Page, tab: number, dx: number, dy: number, opts: { steps?: number; pause?: number } = {}) {
  await page.evaluate(async ({ tab, dx, dy, steps, pause }) => {
    const host = document.querySelectorAll<HTMLElement>('.progress-tabs button')[tab]!
    const target = host.querySelector('[data-haptic-overlay]') ?? host
    const box = host.getBoundingClientRect()
    const x0 = box.left + box.width / 2
    const y0 = box.top + box.height / 2
    const send = (type: string, x: number, y: number) => {
      const touch = { identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y }
      const ended = type === 'touchend' || type === 'touchcancel'
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'touches', { value: ended ? [] : [touch] })
      Object.defineProperty(event, 'changedTouches', { value: [touch] })
      target.dispatchEvent(event)
    }
    send('touchstart', x0, y0)
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, 16))
      send('touchmove', x0 + (dx * i) / steps, y0 + (dy * i) / steps)
    }
    if (pause) await new Promise(r => setTimeout(r, pause))
    send('touchend', x0 + dx, y0 + dy)
  }, { tab, dx, dy, steps: opts.steps ?? 12, pause: opts.pause ?? 120 })
}

test('switch overlays are attached, so this is the iOS path', async ({ page }) => {
  await expect(page.locator('.progress-tabs [data-haptic-overlay]')).toHaveCount(3)
})

test('a slow touch drag slides the thumb and picks the tab it lands on', async ({ page }) => {
  await touchDrag(page, 0, 120, 0)
  expect(await selected(page)).toBe('recovery')
  await touchDrag(page, 1, 120, 0)
  expect(await selected(page)).toBe('body')
  await touchDrag(page, 2, -240, 0)
  expect(await selected(page)).toBe('lifts')
})

test('the thumb follows the finger while it is down', async ({ page }) => {
  const midway = await page.evaluate(async () => {
    const host = document.querySelectorAll<HTMLElement>('.progress-tabs button')[0]!
    const target = host.querySelector('[data-haptic-overlay]') ?? host
    const box = host.getBoundingClientRect()
    const x0 = box.left + box.width / 2, y0 = box.top + box.height / 2
    const send = (type: string, x: number) => {
      const touch = { identifier: 2, target, clientX: x, clientY: y0 }
      const e = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [touch] })
      Object.defineProperty(e, 'changedTouches', { value: [touch] })
      target.dispatchEvent(e)
    }
    send('touchstart', x0)
    for (let i = 1; i <= 8; i++) { send('touchmove', x0 + i * 10); await new Promise(r => setTimeout(r, 20)) }
    await new Promise(r => requestAnimationFrame(() => r(null)))
    const thumb = document.querySelector<HTMLElement>('.progress-tabs-thumb')!
    const pos = Math.round(new DOMMatrix(getComputedStyle(thumb).transform).m41)
    const lit = document.querySelector('.progress-tabs button[data-lit="true"]')?.textContent
    send('touchend', x0 + 80)
    return { pos, lit }
  })
  expect(midway.pos).toBeGreaterThanOrEqual(70)
  expect(midway.lit).toBe('Recovery')
})

test('a short drag springs back; a quick flick carries to the next tab', async ({ page }) => {
  await touchDrag(page, 0, 40, 0, { steps: 6, pause: 150 })
  expect(await selected(page)).toBe('lifts')
  await touchDrag(page, 0, 45, 0, { steps: 3, pause: 0 })
  expect(await selected(page)).toBe('recovery')
})

test('touch moves on the bar are claimed so the switch cannot slide-toggle', async ({ page }) => {
  const prevented = await page.evaluate(() => {
    const host = document.querySelectorAll<HTMLElement>('.progress-tabs button')[0]!
    const target = host.querySelector('[data-haptic-overlay]')!
    const box = host.getBoundingClientRect()
    const touch = (x: number) => ({ identifier: 3, target, clientX: x, clientY: box.top + 10 })
    const start = new Event('touchstart', { bubbles: true, cancelable: true })
    Object.defineProperty(start, 'touches', { value: [touch(box.left + 20)] })
    Object.defineProperty(start, 'changedTouches', { value: [touch(box.left + 20)] })
    target.dispatchEvent(start)
    const move = new Event('touchmove', { bubbles: true, cancelable: true })
    Object.defineProperty(move, 'touches', { value: [touch(box.left + 40)] })
    Object.defineProperty(move, 'changedTouches', { value: [touch(box.left + 40)] })
    target.dispatchEvent(move)
    const end = new Event('touchend', { bubbles: true, cancelable: true })
    Object.defineProperty(end, 'touches', { value: [] })
    Object.defineProperty(end, 'changedTouches', { value: [touch(box.left + 40)] })
    target.dispatchEvent(end)
    return move.defaultPrevented
  })
  expect(prevented).toBe(true)
})

test('a vertical drag that starts on the bar scrolls the page instead', async ({ page }) => {
  await touchDrag(page, 1, 0, -150, { pause: 150 })
  expect(await selected(page)).toBe('lifts')
  const scrolled = await page.locator('.app-main').evaluate(el => el.scrollTop)
  expect(scrolled).toBeGreaterThanOrEqual(140)
})

test('overlays come back after a drag so taps still tick', async ({ page }) => {
  await touchDrag(page, 0, 120, 0)
  await page.waitForTimeout(50)
  const states = await page.locator('.progress-tabs [data-haptic-overlay]').evaluateAll(els =>
    els.map(el => ({ disabled: (el as HTMLInputElement).disabled, pe: (el as HTMLElement).style.pointerEvents })),
  )
  expect(states).toHaveLength(3)
  for (const s of states) expect(s).toEqual({ disabled: false, pe: 'auto' })
})

test('the thumb rests on the selected tab once the spring settles', async ({ page }) => {
  await touchDrag(page, 0, 240, 0)
  expect(await selected(page)).toBe('body')
  // Let the 420ms spring finish: wait on the transition itself, not a guess.
  await page.locator('.progress-tabs-thumb').evaluate(el =>
    Promise.all(el.getAnimations().map(a => a.finished.catch(() => null))))
  const step = await page.locator('.progress-tabs-thumb').evaluate(el => (el as HTMLElement).offsetWidth + 4)
  expect(Math.abs((await thumbX(page)) - 2 * step)).toBeLessThanOrEqual(1)
})
