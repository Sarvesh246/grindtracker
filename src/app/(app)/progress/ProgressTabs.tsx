'use client'

import {
  startTransition,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { haptic, nearestScrollParent, startMomentum, stopMomentum } from '@/lib/utils/haptics'

/**
 * Phone-only Lifts / Recovery / Body segmented control. Tap a tab, or drag
 * anywhere on the bar.
 *
 * Feel:
 * - The thumb tracks the finger 1:1. Past either end it rubber-bands with
 *   iOS-style progressive resistance instead of a flat stop.
 * - Releasing hands the thumb to a spring seeded with the finger's speed, so
 *   motion carries straight through the release: a slow let-go eases in, a
 *   flick whips across and settles with a small natural overshoot. Taps use
 *   the same spring, so tapping and dragging feel like one control.
 * - The thumb can be caught mid-flight; a new touch picks it up where it is.
 * - Labels crossfade with the thumb's position every frame instead of flipping
 *   at the midpoint, and the thumb stretches a few percent with speed.
 * - No React render happens during a drag or a spring: positions, label blend
 *   and stretch are written straight to the DOM in requestAnimationFrame. The
 *   content swap on release runs as a transition so it can't steal the
 *   spring's frames. Reduce Motion skips the spring.
 *
 * Why touch events, not pointer events, for fingers: on iOS each tab wears
 * the haptic `<input switch>` overlay, and once a finger is on that native
 * switch WebKit can stop sending pointermove to the page while touchmove keeps
 * reporting the finger (see setupTapDragGuard). Fingers go through native
 * touch listeners; pointer events are used only for mouse and pen. The
 * non-passive touchmove preventDefaults every move on the bar, which also
 * stops the switch treating a sideways slide as a toggle, and the overlays are
 * disabled in place during a drag so a release can't tick or toggle.
 *
 * The bar is `touch-action: none` and owns both axes: a vertical drag that
 * starts on it scrolls the page from here, with the app's release glide.
 * It carries `data-tab-slider`, which SwipeNavigator ignores, so a sideways
 * drag here never flips to another page. `npm run test:tabs` exercises all of
 * this in emulated iPhone WebKit with touch-only input.
 */

const AXIS_DEADZONE = 6
const VELOCITY_WINDOW_MS = 100
const FLICK_VELOCITY = 0.45 // px per ms
/** Spring: stiff enough to feel quick, damped just under critical (ζ≈0.82)
 *  so a flick overshoots a touch and settles, a slow release doesn't. */
const SPRING_K = 520
const SPRING_C = 2 * 0.82 * Math.sqrt(SPRING_K)
const MAX_SEED_VELOCITY = 2400 // px/s — a wild flick shouldn't fling past the bar
const SETTLE_POS = 0.35
const SETTLE_VEL = 12
const MAX_STRETCH = 0.05

type Tab<T extends string> = { id: T; label: string }

type Drag = {
  id: number
  startX: number
  startY: number
  origin: number
  step: number
  axis: 'x' | 'y' | null
  pos: number
  lastX: number
  lastY: number
  lastT: number
  /** Recent finger x positions, for a release speed that matches the hand. */
  trail: { t: number; x: number }[]
  over: number
  scroller: HTMLElement | null
  samples: { t: number; y: number }[]
}

type Spring = { x: number; v: number; target: number; raf: number; last: number }

type Engine = {
  begin: (id: number, x: number, y: number, t: number) => void
  /** Returns true once the gesture is ours (caller may preventDefault). */
  move: (id: number, x: number, y: number, t: number) => boolean
  end: (id: number, t: number) => void
  cancel: () => void
  /** Animate the thumb to a tab picked by a tap / keyboard (or snap on mount). */
  animateTo: (index: number) => void
}

type Live = { index: number; last: number; tabs: { id: string }[]; onChange: (next: string) => void }

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return (
    document.documentElement.classList.contains('reduce-motion') ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  )
}

/**
 * Finger speed at release (px/ms) from the last ~100ms of real positions —
 * not a running average that starts at zero, which halved a short quick flick
 * and let it fall under the flick threshold. A finger that stopped before
 * lifting reads as 0.
 */
function releaseVelocity(drag: { trail: { t: number; x: number }[]; lastT: number }, now: number): number {
  if (now - drag.lastT > 80) return 0
  const first = drag.trail[0]
  const last = drag.trail[drag.trail.length - 1]
  if (!first || !last || last.t - first.t < 8) return 0
  return (last.x - first.x) / (last.t - first.t)
}

/** iOS-style resistance: the further past the edge, the heavier it gets. */
function rubberBand(overshoot: number, dimension: number): number {
  const sign = Math.sign(overshoot)
  const d = Math.abs(overshoot)
  return sign * (1 - 1 / ((d * 0.55) / dimension + 1)) * dimension
}

/**
 * The gesture + spring engine shared by the touch path (fingers), the pointer
 * path (mouse / pen) and taps. Built once per component from its refs, so the
 * native touch listeners can be bound once and still read the latest props
 * via `live`.
 */
function createDragEngine({
  navRef, thumbRef, dragRef, suppressClickRef, live,
}: {
  navRef: RefObject<HTMLElement | null>
  thumbRef: RefObject<HTMLSpanElement | null>
  dragRef: RefObject<Drag | null>
  suppressClickRef: RefObject<boolean>
  live: RefObject<Live>
}): Engine {
  let restIndex: number | null = null
  let spring: Spring | null = null
  let dragFrame = 0
  // Set when the engine itself changed the tab, so the prop update that
  // follows doesn't start a second animation.
  let selfChange: number | null = null

  const stepPx = () => (thumbRef.current?.offsetWidth ?? 0) + 4 // thumb + grid gap
  const buttons = () => navRef.current?.querySelectorAll<HTMLElement>('button[role="tab"]') ?? []

  /** Position, stretch and label blend for one frame. */
  const paint = (pos: number, velocityPxPerS: number) => {
    const thumb = thumbRef.current
    if (!thumb) return
    const stretch = 1 + Math.min(MAX_STRETCH, Math.abs(velocityPxPerS) / 40000)
    thumb.style.transform = `translate3d(${pos}px, 0, 0) scaleX(${stretch.toFixed(4)})`
    const step = stepPx()
    if (!step) return
    const at = pos / step
    buttons().forEach((b, i) => {
      b.style.setProperty('--lit', Math.max(0, 1 - Math.abs(at - i)).toFixed(3))
    })
  }

  /** Back to the CSS resting state (var-driven transform, attr-driven colour). */
  const rest = (index: number) => {
    const thumb = thumbRef.current
    restIndex = index
    if (thumb) {
      thumb.style.setProperty('--tab', String(index))
      thumb.style.transform = ''
    }
    buttons().forEach(b => b.style.removeProperty('--lit'))
    navRef.current?.removeAttribute('data-moving')
  }

  const stopSpring = (): number | null => {
    if (!spring) return null
    cancelAnimationFrame(spring.raf)
    const x = spring.x
    spring = null
    return x
  }

  const runSpring = (from: number, velocityPxPerS: number, index: number) => {
    stopSpring()
    const step = stepPx()
    const target = index * step
    if (reducedMotion() || !step) {
      rest(index)
      return
    }
    navRef.current?.setAttribute('data-moving', '')
    const v0 = Math.max(-MAX_SEED_VELOCITY, Math.min(MAX_SEED_VELOCITY, velocityPxPerS))
    const s: Spring = { x: from, v: v0, target, raf: 0, last: performance.now() }
    spring = s
    const tick = (now: number) => {
      if (spring !== s) return
      // Fixed small sub-steps keep the spring stable on any refresh rate.
      let dt = Math.min(0.05, Math.max(0, (now - s.last) / 1000))
      s.last = now
      while (dt > 0) {
        const h = Math.min(dt, 1 / 240)
        const a = -SPRING_K * (s.x - s.target) - SPRING_C * s.v
        s.v += a * h
        s.x += s.v * h
        dt -= h
      }
      if (Math.abs(s.x - s.target) < SETTLE_POS && Math.abs(s.v) < SETTLE_VEL) {
        spring = null
        rest(index)
        return
      }
      paint(s.x, s.v)
      s.raf = requestAnimationFrame(tick)
    }
    paint(from, v0)
    s.raf = requestAnimationFrame(tick)
  }

  // The iOS switch overlays are disabled in place, never removed: touch
  // events stay targeted at the node the finger landed on, so detaching it
  // mid-drag would send the rest of the gesture to a node outside the page.
  const overlays = () =>
    navRef.current?.querySelectorAll<HTMLInputElement>('[data-haptic-overlay]') ?? []
  const disableOverlays = () => {
    overlays().forEach(o => {
      o.disabled = true
      o.style.pointerEvents = 'none'
    })
  }
  const releaseClickGuard = () => {
    // Any trailing click is dispatched before these timers; if none follows,
    // the flag must not swallow the next real tap.
    setTimeout(() => {
      suppressClickRef.current = false
      overlays().forEach(o => {
        o.disabled = false
        o.style.pointerEvents = 'auto'
      })
    }, 0)
  }

  const commit = (next: number) => {
    const { index: current, tabs: list, onChange: change } = live.current
    if (next === current) return
    selfChange = next
    // Low priority: the content swap mustn't take the spring's frames.
    startTransition(() => change(list[next]!.id))
  }

  return {
    animateTo(index) {
      if (selfChange === index) {
        selfChange = null
        return
      }
      selfChange = null
      if (restIndex === null) {
        rest(index) // first mount: no animation
        return
      }
      if (dragRef.current?.axis === 'x') return
      const from = spring ? spring.x : restIndex * stepPx()
      const v = spring ? spring.v : 0
      if (index === restIndex && !spring) return
      runSpring(from, v, index)
    },

    begin(id, x, y, t) {
      const thumb = thumbRef.current
      if (!thumb) return
      stopMomentum()
      const step = stepPx()
      // Catch a thumb that's still springing exactly where it is.
      const caught = stopSpring()
      const origin = caught ?? (restIndex ?? live.current.index) * step
      if (caught !== null) {
        navRef.current?.setAttribute('data-moving', '')
        paint(caught, 0)
      }
      dragRef.current = {
        id, startX: x, startY: y, origin, step, axis: null, pos: origin,
        lastX: x, lastY: y, lastT: t, trail: [{ t, x }],
        over: Math.round(origin / (step || 1)), scroller: null, samples: [],
      }
    },

    move(id, x, y, t) {
      const drag = dragRef.current
      if (!drag || id !== drag.id) return false
      const dx = x - drag.startX
      const dy = y - drag.startY

      if (drag.axis === 'y') {
        if (drag.scroller) drag.scroller.scrollTop -= y - drag.lastY
        drag.lastY = y
        drag.samples.push({ t: performance.now(), y })
        if (drag.samples.length > 12) drag.samples.shift()
        return true
      }

      if (!drag.axis) {
        if (Math.abs(dx) < AXIS_DEADZONE && Math.abs(dy) < AXIS_DEADZONE) return false
        drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        suppressClickRef.current = true
        disableOverlays()
        if (drag.axis === 'y') {
          // A thumb caught mid-spring but then scrolled: let it finish.
          if (navRef.current?.hasAttribute('data-moving')) {
            runSpring(drag.origin, 0, Math.round(drag.origin / drag.step))
          }
          const nav = navRef.current
          drag.scroller = (nav && nearestScrollParent(nav, 'y')) ?? (document.scrollingElement as HTMLElement | null)
          // Count the dead zone so the page doesn't lag the finger.
          if (drag.scroller) drag.scroller.scrollTop -= dy
          drag.lastY = y
          drag.samples = [{ t: performance.now(), y }]
          return true
        }
        navRef.current?.setAttribute('data-moving', '')
      }

      const max = live.current.last * drag.step
      const raw = drag.origin + dx
      drag.pos = raw < 0 ? rubberBand(raw, drag.step) : raw > max ? max + rubberBand(raw - max, drag.step) : raw

      drag.lastX = x
      drag.lastT = t
      drag.trail.push({ t, x })
      while (drag.trail.length > 2 && t - drag.trail[0]!.t > VELOCITY_WINDOW_MS) drag.trail.shift()

      const over = Math.min(live.current.last, Math.max(0, Math.round(drag.pos / drag.step)))
      if (over !== drag.over) {
        drag.over = over
        haptic('light') // Android tick per tab crossed; no-op on iOS
      }
      if (!dragFrame) {
        dragFrame = requestAnimationFrame(() => {
          dragFrame = 0
          const d = dragRef.current
          if (d && d.axis === 'x') paint(d.pos, releaseVelocity(d, d.lastT) * 1000)
        })
      }
      return true
    },

    end(id, t) {
      const drag = dragRef.current
      if (!drag || id !== drag.id) return
      dragRef.current = null
      if (dragFrame) cancelAnimationFrame(dragFrame)
      dragFrame = 0
      if (drag.axis === 'y') {
        if (drag.scroller) startMomentum(drag.scroller, 'y', drag.samples)
        releaseClickGuard()
        return
      }
      if (drag.axis !== 'x') {
        // A tap that caught a springing thumb: carry on to the selected tab
        // (if the tap lands on another tab, its click re-aims the spring).
        if (navRef.current?.hasAttribute('data-moving')) runSpring(drag.origin, 0, live.current.index)
        return
      }
      const velocity = releaseVelocity(drag, t)
      const at = drag.pos / drag.step
      const last = live.current.last
      // A flick picks between the two tabs the thumb is between, in the
      // direction of travel — never skips one. Otherwise: nearest tab.
      const next = Math.abs(velocity) > FLICK_VELOCITY
        ? Math.min(last, Math.max(0, velocity > 0 ? Math.ceil(at + 1e-3) : Math.floor(at - 1e-3)))
        : Math.min(last, Math.max(0, Math.round(at)))
      runSpring(drag.pos, velocity * 1000, next)
      commit(next)
      releaseClickGuard()
    },

    cancel() {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      if (dragFrame) cancelAnimationFrame(dragFrame)
      dragFrame = 0
      if (drag.axis === 'x') runSpring(drag.pos, 0, live.current.index)
      releaseClickGuard()
    },
  }
}

export default function ProgressTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Tab<T>[]
  value: T
  onChange: (next: T) => void
}) {
  const navRef = useRef<HTMLElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const suppressClickRef = useRef(false)

  const index = Math.max(0, tabs.findIndex(t => t.id === value))
  const last = tabs.length - 1

  // The native touch listeners are bound once; they read the latest props
  // through this ref instead of re-binding every render.
  const live = useRef<Live>({ index, last, tabs, onChange: onChange as (next: string) => void })
  useLayoutEffect(() => {
    live.current = { index, last, tabs, onChange: onChange as (next: string) => void }
  })

  // Built in the mount effect below (not during render) and read by event
  // handlers and the tab-change effect, which only ever run after mount.
  const engineRef = useRef<Engine | null>(null)

  // Fingers: native touch listeners. touchmove must be non-passive so it can
  // preventDefault (React's onTouchMove is passive and can't).
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const api = createDragEngine({ navRef, thumbRef, dragRef, suppressClickRef, live })
    engineRef.current = api
    api.animateTo(live.current.index)
    const find = (list: TouchList, id: number) => {
      for (let i = 0; i < list.length; i++) if (list[i]!.identifier === id) return list[i]!
      return null
    }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { api.cancel(); return }
      const t = e.changedTouches[0]!
      api.begin(t.identifier, t.clientX, t.clientY, e.timeStamp)
    }
    const onMove = (e: TouchEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const t = find(e.changedTouches, drag.id)
      if (!t) return
      // Claim every move on the bar: this is what stops the iOS switch's
      // slide-to-toggle and any native pan from taking the gesture.
      if (e.cancelable) e.preventDefault()
      api.move(t.identifier, t.clientX, t.clientY, e.timeStamp)
    }
    const onEnd = (e: TouchEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const t = find(e.changedTouches, drag.id)
      if (!t) return
      if (e.type === 'touchcancel') api.cancel()
      else api.end(t.identifier, e.timeStamp)
    }
    nav.addEventListener('touchstart', onStart, { passive: true })
    nav.addEventListener('touchmove', onMove, { passive: false })
    nav.addEventListener('touchend', onEnd, { passive: true })
    nav.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      nav.removeEventListener('touchstart', onStart)
      nav.removeEventListener('touchmove', onMove)
      nav.removeEventListener('touchend', onEnd)
      nav.removeEventListener('touchcancel', onEnd)
      engineRef.current = null
    }
  }, [])

  // Taps (and any other outside change of tab) ride the same spring.
  useLayoutEffect(() => {
    engineRef.current?.animateTo(index)
  }, [index])

  // Mouse / pen only — touch is handled above (and pointer events from a
  // finger on the iOS overlay aren't reliable anyway).
  const isTouch = (e: ReactPointerEvent) => e.pointerType === 'touch'
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (isTouch(e) || e.button !== 0 || !e.isPrimary) return
    engineRef.current?.begin(e.pointerId, e.clientX, e.clientY, e.timeStamp)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (isTouch(e) || !dragRef.current) return
    if (engineRef.current?.move(e.pointerId, e.clientX, e.clientY, e.timeStamp)) {
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    }
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (isTouch(e)) return
    engineRef.current?.end(e.pointerId, e.timeStamp)
  }
  const onPointerCancel = (e: ReactPointerEvent<HTMLElement>) => {
    if (isTouch(e)) return
    engineRef.current?.cancel()
  }

  return (
    <nav
      ref={navRef}
      className="progress-tabs"
      role="tablist"
      aria-label="Progress sections"
      data-onboard="progress-tabs"
      data-tab-slider=""
      data-no-touch-retarget=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClickCapture={e => {
        // The release that ends a slide can also fire a click on the tab it
        // started on; that tab mustn't win over the one the thumb landed on.
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          e.preventDefault()
          e.stopPropagation()
        }
      }}
    >
      <span
        ref={thumbRef}
        className="progress-tabs-thumb"
        aria-hidden="true"
        style={{ '--tab': index } as CSSProperties}
      />
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`progress-tab-${t.id}`}
          aria-selected={value === t.id}
          className="press"
          data-haptic="light"
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
