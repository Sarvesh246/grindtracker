'use client'

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { haptic, nearestScrollParent, startMomentum, stopMomentum } from '@/lib/utils/haptics'

/**
 * Phone-only Lifts / Recovery / Body segmented control. Tap a tab, or drag
 * anywhere on the bar: the thumb tracks the finger 1:1, the label under it
 * lights up as it crosses each third, and on release it springs to the
 * nearest tab (a quick flick carries on to the next one).
 *
 * Why touch events, not pointer events, for fingers: on iOS each tab wears
 * the haptic `<input switch>` overlay, and once a finger is on that native
 * switch WebKit can stop sending pointermove to the page while touchmove keeps
 * reporting the finger (see setupTapDragGuard). A pointer-only drag therefore
 * never saw the slide on a real iPhone, though it worked in desktop Chromium
 * where the overlay never attaches. Fingers go through touch listeners here;
 * pointer events are used only for mouse and pen.
 *
 * The switch also treats a sideways slide as "toggle me". The non-passive
 * touchmove below preventDefaults every move on the bar, which stops that, and
 * while a drag is live the overlays are disabled so a release can't tick or
 * toggle.
 *
 * The bar is `touch-action: none` and owns both axes: a vertical drag that
 * starts on it scrolls the page from here, with the same release glide the
 * haptic overlay uses elsewhere, so it behaves the same on every device.
 *
 * Page swipe: the bar carries `data-tab-slider`, which SwipeNavigator ignores,
 * so a sideways drag here never flips to another page.
 *
 * Smoothness: while dragging, the thumb's transform is written straight to
 * the DOM inside requestAnimationFrame — no React render per move. React only
 * re-renders when the highlighted third changes.
 */

const AXIS_DEADZONE = 6
const FLICK_VELOCITY = 0.45 // px per ms
const FLICK_PROJECTION_MS = 140
const RUBBER_BAND = 0.3

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
  velocity: number
  scroller: HTMLElement | null
  samples: { t: number; y: number }[]
}

type Engine = {
  begin: (id: number, x: number, y: number, t: number) => void
  /** Returns true once the gesture is ours (caller may preventDefault). */
  move: (id: number, x: number, y: number, t: number) => boolean
  end: (id: number, t: number) => void
  cancel: () => void
}

type Live = { index: number; last: number; tabs: { id: string }[]; onChange: (next: string) => void; hover: number | null }

/**
 * The gesture engine shared by the touch path (fingers) and the pointer path
 * (mouse / pen). Built once per component from its refs, so the native touch
 * listeners can be bound once and still read the latest props via `live`.
 */
function createDragEngine({
  navRef, thumbRef, dragRef, frameRef, suppressClickRef, live, setHover,
}: {
  navRef: RefObject<HTMLElement | null>
  thumbRef: RefObject<HTMLSpanElement | null>
  dragRef: RefObject<Drag | null>
  frameRef: RefObject<number>
  suppressClickRef: RefObject<boolean>
  live: RefObject<Live>
  setHover: (i: number | null) => void
}): Engine {
  const paint = () => {
    frameRef.current = 0
    const drag = dragRef.current
    const thumb = thumbRef.current
    if (!drag || !thumb) return
    thumb.style.transform = `translate3d(${drag.pos}px, 0, 0)`
  }

  // The iOS switch overlays are disabled in place, never removed: touch
  // events stay targeted at the node the finger landed on, so detaching it
  // mid-drag would send the rest of the gesture to a node outside the page.
  // Disabled, the switch can't toggle or tick on release.
  const overlays = () =>
    navRef.current?.querySelectorAll<HTMLInputElement>('[data-haptic-overlay]') ?? []
  const startLiveDrag = () => {
    overlays().forEach(o => {
      o.disabled = true
      o.style.pointerEvents = 'none'
    })
  }
  const restoreOverlays = () => {
    // After the release's click (if any) has been dispatched and swallowed.
    setTimeout(() => {
      overlays().forEach(o => {
        o.disabled = false
        o.style.pointerEvents = 'auto'
      })
    }, 0)
  }

  const settle = (next: number) => {
    const thumb = thumbRef.current
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = 0
    if (thumb) {
      // Hand the thumb back to CSS in one style change: the transition
      // animates from where the finger left it to the chosen tab.
      thumb.style.setProperty('--tab', String(next))
      thumb.style.transition = ''
      thumb.style.transform = ''
    }
    navRef.current?.removeAttribute('data-dragging')
    dragRef.current = null
    setHover(null)
    const { index: current, tabs: list, onChange: change } = live.current
    if (next !== current) change(list[next]!.id)
  }

  const releaseClickGuard = () => {
    // Any trailing click is dispatched before this timer; if none follows,
    // the flag must not swallow the next real tap.
    setTimeout(() => { suppressClickRef.current = false }, 0)
    restoreOverlays()
  }

  return {
    begin(id, x, y, t) {
      const thumb = thumbRef.current
      if (!thumb) return
      stopMomentum()
      const step = thumb.offsetWidth + 4 // thumb width + grid gap
      const origin = live.current.index * step
      dragRef.current = {
        id, startX: x, startY: y, origin, step, axis: null, pos: origin,
        lastX: x, lastY: y, lastT: t, velocity: 0, scroller: null, samples: [],
      }
    },

    /** Returns true once the gesture is ours (caller may preventDefault). */
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
        startLiveDrag()
        if (drag.axis === 'y') {
          const nav = navRef.current
          drag.scroller = (nav && nearestScrollParent(nav, 'y')) ?? (document.scrollingElement as HTMLElement | null)
          // Count the dead zone so the page doesn't lag the finger.
          if (drag.scroller) drag.scroller.scrollTop -= dy
          drag.lastY = y
          drag.samples = [{ t: performance.now(), y }]
          return true
        }
        navRef.current?.setAttribute('data-dragging', '')
        if (thumbRef.current) thumbRef.current.style.transition = 'none'
      }

      const max = live.current.last * drag.step
      let pos = drag.origin + dx
      if (pos < 0) pos *= RUBBER_BAND
      else if (pos > max) pos = max + (pos - max) * RUBBER_BAND
      drag.pos = pos

      const dt = t - drag.lastT
      if (dt > 0) drag.velocity = 0.7 * ((x - drag.lastX) / dt) + 0.3 * drag.velocity
      drag.lastX = x
      drag.lastT = t

      const over = Math.min(live.current.last, Math.max(0, Math.round(pos / drag.step)))
      if (over !== (live.current.hover ?? live.current.index)) {
        live.current.hover = over
        setHover(over)
        haptic('light')
      }
      if (!frameRef.current) frameRef.current = requestAnimationFrame(paint)
      return true
    },

    end(id, t) {
      const drag = dragRef.current
      if (!drag || id !== drag.id) return
      if (drag.axis === 'y') {
        if (drag.scroller) startMomentum(drag.scroller, 'y', drag.samples)
        dragRef.current = null
        releaseClickGuard()
        return
      }
      if (drag.axis !== 'x') {
        dragRef.current = null
        return
      }
      // Stale velocity from a drag that paused before lifting shouldn't fling.
      const velocity = t - drag.lastT > 80 ? 0 : drag.velocity
      const projected =
        Math.abs(velocity) > FLICK_VELOCITY ? drag.pos + velocity * FLICK_PROJECTION_MS : drag.pos
      settle(Math.min(live.current.last, Math.max(0, Math.round(projected / drag.step))))
      releaseClickGuard()
    },

    cancel() {
      const drag = dragRef.current
      if (!drag) return
      if (drag.axis === 'x') settle(live.current.index)
      else dragRef.current = null
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
  const frameRef = useRef(0)
  const suppressClickRef = useRef(false)
  const [hover, setHover] = useState<number | null>(null)

  const index = Math.max(0, tabs.findIndex(t => t.id === value))
  const highlighted = hover ?? index
  const last = tabs.length - 1

  // The native touch listeners are bound once; they read the latest props
  // through this ref instead of re-binding every render.
  const live = useRef<Live>({ index, last, tabs, onChange: onChange as (next: string) => void, hover })
  useLayoutEffect(() => {
    live.current = { index, last, tabs, onChange: onChange as (next: string) => void, hover }
  })

  // Built in the mount effect below (not during render) and read by the
  // pointer handlers, which only ever run after mount.
  const engineRef = useRef<Engine | null>(null)

  // Fingers: native touch listeners. touchmove must be non-passive so it can
  // preventDefault (React's onTouchMove is passive and can't).
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const api = createDragEngine({ navRef, thumbRef, dragRef, frameRef, suppressClickRef, live, setHover })
    engineRef.current = api
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
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`progress-tab-${t.id}`}
          aria-selected={value === t.id}
          data-lit={i === highlighted}
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
