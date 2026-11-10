import { test, expect } from '@playwright/test'
import { buildSync } from 'esbuild'
import { readFileSync } from 'node:fs'

// Run the actual shared gesture code and app CSS without a live account.
// These fixtures represent the app, dialog/chat lists and horizontal strips.
const bundle = buildSync({
  stdin: { contents: `import { setupHaptics, setupTapDragGuard } from './src/lib/utils/haptics'; setupHaptics(); setupTapDragGuard();`, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', tsconfig: 'tsconfig.json',
}).outputFiles[0].text
const css = readFileSync('src/app/globals.css', 'utf8')

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'userAgent', { value: 'iPhone', configurable: true })
  })
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div class="app-shell"><main class="app-main" style="height:600px;flex:none">
    <button id="vertical" data-haptic="light" style="position:relative;width:200px;height:60px">Set</button>
    <div id="blank">Ordinary content</div>
    <div id="horizontal" style="overflow-x:auto;width:250px;touch-action:pan-x"><div style="width:2000px"><button data-haptic="light" style="position:relative;width:200px;height:60px">Day</button></div></div>
    <div role="dialog" id="dialog" style="overflow-y:auto;height:150px"><button data-haptic="light" style="position:relative;width:200px;height:60px">Dialog action</button><div style="height:2000px">Chat / sheet content</div></div>
    <div style="height:4000px">Workout / settings / profile content</div>
  </main></div>`)
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach(button => button.addEventListener('click', () => button.dataset.clicked = String(Number(button.dataset.clicked ?? 0) + 1)))
  })
  await page.addScriptTag({ content: bundle })
})

async function drag(page: import('@playwright/test').Page, selector: string, axis: 'x' | 'y', pause = false, cancel = false) {
  await page.evaluate(async ({ selector, axis, pause, cancel }) => {
    const target = document.querySelector(selector)!
    function send(type: string, distance: number) {
      const point = { identifier: 1, target, clientX: axis === 'x' ? 220 - distance : 100, clientY: axis === 'y' ? 400 - distance : 100 }
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [point] })
      target.dispatchEvent(event)
    }
    send('touchstart', 0)
    for (let i = 1; i <= 8; i++) {
      await new Promise(requestAnimationFrame)
      send('touchmove', i * 20)
    }
    if (pause) await new Promise(resolve => setTimeout(resolve, 150))
    send(cancel ? 'touchcancel' : 'touchend', 160)
  }, { selector, axis, pause, cancel })
}

for (const [name, selector, scroller, axis] of [
  ['page', '#vertical input', '.app-main', 'y'],
  ['horizontal strip', '#horizontal input', '#horizontal', 'x'],
  ['dialog/chat list', '#dialog input', '#dialog', 'y'],
] as const) {
  test(`${name}: tracks finger, glides, decelerates and stops on a new touch`, async ({ page }) => {
    const position = () => page.locator(scroller).evaluate((el, axis) => axis === 'y' ? el.scrollTop : el.scrollLeft, axis)
    await drag(page, selector, axis)
    const released = await position()
    expect(released).toBeGreaterThanOrEqual(155)
    await page.waitForTimeout(120)
    const gliding = await position()
    expect(gliding).toBeGreaterThan(released + 5)
    await page.locator('#blank').dispatchEvent('touchstart', { touches: [{ identifier: 2, clientX: 20, clientY: 20 }] })
    const stopped = await position()
    await page.waitForTimeout(150)
    expect(await position()).toBe(stopped)
    await expect(page.locator('button[data-clicked]')).toHaveCount(0)
  })
}

for (const kind of ['paused', 'cancelled'] as const) {
  test(`${kind} drag does not launch momentum`, async ({ page }) => {
    await drag(page, '#vertical input', 'y', kind === 'paused', kind === 'cancelled')
    const released = await page.locator('.app-main').evaluate(el => el.scrollTop)
    await page.waitForTimeout(150)
    expect(await page.locator('.app-main').evaluate(el => el.scrollTop)).toBe(released)
  })
}

test('ordinary haptic taps still activate exactly once', async ({ page }) => {
  await page.locator('#vertical input').dispatchEvent('click')
  await expect(page.locator('#vertical')).toHaveAttribute('data-clicked', '1')
})

test('momentum reaches bounds without scrolling the containing page', async ({ page }) => {
  await page.locator('#dialog').evaluate(el => el.scrollTop = el.scrollHeight - el.clientHeight - 200)
  await drag(page, '#dialog input', 'y')
  await page.waitForTimeout(700)
  expect(await page.locator('#dialog').evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))).toBeLessThan(2)
  expect(await page.locator('.app-main').evaluate(el => el.scrollTop)).toBe(0)
})

test('a completed scroll cannot activate its starting button', async ({ page }) => {
  await drag(page, '#vertical input', 'y')
  await page.locator('#vertical input').dispatchEvent('click')
  await expect(page.locator('button[data-clicked]')).toHaveCount(0)
})

test('glide decelerates smoothly across animation frames', async ({ page }, testInfo) => {
  // Compare with idle frame cadence on the same software-rendered worker;
  // a fixed 60fps assertion would measure the host CPU, not scroll overhead.
  const idleGaps = await page.evaluate(async () => {
    const times: number[] = []
    const start = performance.now()
    await new Promise<void>(resolve => {
      const frame = (t: number) => {
        times.push(t)
        if (t - start > 500) resolve()
        else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    return times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b)
  })
  const idleP95 = idleGaps[Math.floor(idleGaps.length * .95)]
  await drag(page, '#vertical input', 'y')
  const frames = await page.evaluate(async () => {
    const el = document.querySelector('.app-main')!
    const samples: { t: number; p: number }[] = []
    const start = performance.now()
    await new Promise<void>(resolve => {
      const frame = (t: number) => {
        samples.push({ t, p: el.scrollTop })
        if (t - start > 500) resolve()
        else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    return samples
  })
  const intervals = frames.slice(1).map((frame, i) => frame.t - frames[i].t)
  const gaps = [...intervals].sort((a, b) => a - b)
  const p95 = gaps[Math.floor(gaps.length * .95)]
  expect(frames.length).toBeGreaterThan(10)
  expect(p95).toBeLessThan(idleP95 * 2 + 8)
  for (let i = 1; i < frames.length; i++) expect(frames[i].p).toBeGreaterThanOrEqual(frames[i - 1].p)
  const early = (frames[4].p - frames[0].p) / (frames[4].t - frames[0].t)
  const late = (frames.at(-1)!.p - frames.at(-5)!.p) / (frames.at(-1)!.t - frames.at(-5)!.t)
  expect(late).toBeLessThan(early)
  await testInfo.attach('scroll-frame-samples', { body: JSON.stringify({ idleP95, p95, frames }), contentType: 'application/json' })
})

test('native touch scrolling still works on ordinary content', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP trusted touch input is Chromium-only')
  const session = await page.context().newCDPSession(page)
  await page.locator('.app-main').evaluate(el => el.scrollTop = 500)
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 450 }] })
  for (let i = 1; i <= 8; i++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: 450 - 25 * i }] })
    await page.waitForTimeout(16)
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => page.locator('.app-main').evaluate(el => el.scrollTop)).toBeGreaterThan(600)
  await expect(page.locator('button[data-clicked]')).toHaveCount(0)
})
