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

// The tabs are hidden at desktop widths, including in the main CI project.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

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
/** Wait for the spring by waiting on frames from inside the page: headless
 *  Chromium only produces frames while something is waiting on one, so a
 *  timer-based poll can watch a spring that never gets a frame. */
const settled = (page: Page) =>
  page.locator('.progress-tabs').evaluate(async el => {
    for (let i = 0; i < 240 && el.hasAttribute('data-moving'); i++) {
      await new Promise(r => requestAnimationFrame(() => r(null)))
    }
    return !el.hasAttribute('data-moving')
  })
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
  await expect.poll(() => selected(page)).toBe('recovery')
  await touchDrag(page, 1, 120, 0)
  await expect.poll(() => selected(page)).toBe('body')
  await touchDrag(page, 2, -240, 0)
  await expect.poll(() => selected(page)).toBe('lifts')
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
    const lits = [...document.querySelectorAll<HTMLElement>('.progress-tabs button')].map(b => Number(getComputedStyle(b).getPropertyValue('--lit')))
    send('touchend', x0 + 80)
    return { pos, lits }
  })
  expect(midway.pos).toBeGreaterThanOrEqual(70)
  // 80px of a ~113px step: the labels are mid-crossfade, Recovery leading.
  expect(midway.lits[1]).toBeGreaterThan(midway.lits[0]!)
  expect(midway.lits[0]).toBeGreaterThan(0.1)
  expect(midway.lits[1]).toBeLessThan(0.95)
  expect(midway.lits[2]).toBe(0)
})

test('a short drag springs back; a quick flick carries to the next tab', async ({ page }) => {
  await touchDrag(page, 0, 40, 0, { steps: 6, pause: 150 })
  await expect.poll(() => selected(page)).toBe('lifts')
  await touchDrag(page, 0, 45, 0, { steps: 3, pause: 0 })
  await expect.poll(() => selected(page)).toBe('recovery')
  // Even a very fast flick moves one tab, never skips to the far end.
  expect(await settled(page)).toBe(true)
  await touchDrag(page, 1, 60, 0, { steps: 2, pause: 0 })
  await expect.poll(() => selected(page)).toBe('body')
  expect(await settled(page)).toBe(true)
  await touchDrag(page, 2, -30, 0, { steps: 2, pause: 0 })
  await expect.poll(() => selected(page)).toBe('recovery')
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
  await expect.poll(() => selected(page)).toBe('lifts')
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
  await expect.poll(() => selected(page)).toBe('body')
  expect(await settled(page)).toBe(true)
  const step = await page.locator('.progress-tabs-thumb').evaluate(el => (el as HTMLElement).offsetWidth + 4)
  expect(Math.abs((await thumbX(page)) - 2 * step)).toBeLessThanOrEqual(1)
})

test('a flick keeps its speed through the release instead of restarting', async ({ page }) => {
  const { initialStretch, trail } = await page.evaluate(async () => {
    const host = document.querySelectorAll<HTMLElement>('.progress-tabs button')[0]!
    const target = host.querySelector('[data-haptic-overlay]') ?? host
    const box = host.getBoundingClientRect()
    const x0 = box.left + box.width / 2, y0 = box.top + box.height / 2
    const send = (type: string, x: number, timestamp: number) => {
      const touch = { identifier: 4, target, clientX: x, clientY: y0 }
      const e = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(e, 'timeStamp', { value: timestamp })
      Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [touch] })
      Object.defineProperty(e, 'changedTouches', { value: [touch] })
      target.dispatchEvent(e)
    }
    const thumb = document.querySelector<HTMLElement>('.progress-tabs-thumb')!
    const x = () => new DOMMatrix(getComputedStyle(thumb).transform).m41
    send('touchstart', x0, 0)
    for (let i = 1; i <= 3; i++) send('touchmove', x0 + i * 15, i * 14)
    send('touchend', x0 + 45, 42)
    const initialStretch = new DOMMatrix(getComputedStyle(thumb).transform).a
    const trail: number[] = []
    for (let i = 0; i < 4; i++) { await new Promise(r => requestAnimationFrame(() => r(null))); trail.push(x()) }
    return { initialStretch, trail }
  })
  // Stretch is painted from release velocity before the first animation frame.
  // A browser can deliver that first frame with zero elapsed time.
  expect(initialStretch).toBeGreaterThan(1.02)
  expect(trail[3]).toBeGreaterThan(45)
  expect(trail[3]).toBeGreaterThan(trail[0]!)
  await expect.poll(() => selected(page)).toBe('recovery')
})

test('dragging past the ends resists more the further you pull', async ({ page }) => {
  const pulls = await page.evaluate(async () => {
    const host = document.querySelectorAll<HTMLElement>('.progress-tabs button')[0]!
    const target = host.querySelector('[data-haptic-overlay]') ?? host
    const box = host.getBoundingClientRect()
    const x0 = box.left + box.width / 2, y0 = box.top + box.height / 2
    const send = (type: string, x: number) => {
      const touch = { identifier: 5, target, clientX: x, clientY: y0 }
      const e = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [touch] })
      Object.defineProperty(e, 'changedTouches', { value: [touch] })
      target.dispatchEvent(e)
    }
    const thumb = document.querySelector<HTMLElement>('.progress-tabs-thumb')!
    const x = () => new DOMMatrix(getComputedStyle(thumb).transform).m41
    send('touchstart', x0)
    const at: number[] = []
    for (const d of [-20, -40, -60, -80]) {
      send('touchmove', x0 + d)
      await new Promise(r => requestAnimationFrame(() => r(null)))
      await new Promise(r => requestAnimationFrame(() => r(null)))
      at.push(x())
    }
    send('touchend', x0 - 80)
    return at
  })
  // Moves left, never as far as the finger, and each 20px buys less.
  for (let i = 0; i < pulls.length; i++) expect(pulls[i]).toBeLessThan(0)
  expect(Math.abs(pulls[3]!)).toBeLessThan(40)
  expect(Math.abs(pulls[1]! - pulls[0]!)).toBeGreaterThan(Math.abs(pulls[3]! - pulls[2]!))
  expect(await settled(page)).toBe(true)
  expect(await thumbX(page)).toBe(0)
})

test('a tap springs the thumb over, and a moving thumb can be caught', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const nav = document.querySelector<HTMLElement>('.progress-tabs')!
    const thumb = document.querySelector<HTMLElement>('.progress-tabs-thumb')!
    const x = () => new DOMMatrix(getComputedStyle(thumb).transform).m41
    document.querySelectorAll<HTMLElement>('.progress-tabs button')[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // A few frames into the spring (frames, not a timer: headless timing varies).
    for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(() => r(null)))
    const movingAfterTap = nav.hasAttribute('data-moving')
    const inFlight = x()
    // Grab it mid-flight: it should hold where it is, not jump to a tab.
    const host = document.querySelectorAll<HTMLElement>('.progress-tabs button')[1]!
    const target = host.querySelector('[data-haptic-overlay]') ?? host
    const touch = { identifier: 6, target, clientX: host.getBoundingClientRect().left + 10, clientY: host.getBoundingClientRect().top + 10 }
    const e = new Event('touchstart', { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'touches', { value: [touch] })
    Object.defineProperty(e, 'changedTouches', { value: [touch] })
    target.dispatchEvent(e)
    for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(() => r(null)))
    const held = x()
    const end = new Event('touchend', { bubbles: true, cancelable: true })
    Object.defineProperty(end, 'touches', { value: [] })
    Object.defineProperty(end, 'changedTouches', { value: [touch] })
    target.dispatchEvent(end)
    return { movingAfterTap, inFlight, held, step: thumb.offsetWidth + 4 }
  })
  expect(result.movingAfterTap).toBe(true)
  expect(result.inFlight).toBeGreaterThan(5)
  expect(result.inFlight).toBeLessThan(2 * result.step - 5)
  expect(Math.abs(result.held - result.inFlight)).toBeLessThan(2)
  expect(await settled(page)).toBe(true)
  await expect.poll(() => selected(page)).toBe('body')
  expect(Math.abs((await thumbX(page)) - 2 * result.step)).toBeLessThanOrEqual(1)
})
