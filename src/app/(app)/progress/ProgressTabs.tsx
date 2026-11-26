'use client'

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { haptic } from '@/lib/utils/haptics'

/**
 * Phone-only Lifts / Recovery / Body segmented control. Tap a tab, or drag
 * anywhere on the bar: the thumb tracks the finger 1:1, the label under it
 * lights up as it crosses each third, and on release it springs to the
 * nearest tab (a quick flick carries on to the next one).
 *
 * Smoothness: while dragging, the thumb's transform is written straight to
 * the DOM inside requestAnimationFrame — no React render per pointermove.
 * React only re-renders when the highlighted third changes.
 *
 * Page swipe: the bar carries `data-tab-slider`, which SwipeNavigator ignores,
 * so a sideways drag here never flips to another page. It is deliberately not
 * `data-swipe-ignore`: on iOS that marker also stops the haptic overlay from
 * forwarding vertical pans, and a scroll that starts on the bar should still
 * scroll the page.
 */

const AXIS_DEADZONE = 6
const FLICK_VELOCITY = 0.45 // px per ms
const FLICK_PROJECTION_MS = 140
const RUBBER_BAND = 0.3

type Tab<T extends string> = { id: T; label: string }

type Drag = {
  pointerId: number
  startX: number
  startY: number
  origin: number
  step: number
  axis: 'x' | 'y' | null
  pos: number
  lastX: number
  lastT: number
  velocity: number
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

  const paint = () => {
    frameRef.current = 0
    const drag = dragRef.current
    const thumb = thumbRef.current
    if (!drag || !thumb) return
    thumb.style.transform = `translate3d(${drag.pos}px, 0, 0)`
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
    if (next !== index) onChange(tabs[next]!.id)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !e.isPrimary) return
    const thumb = thumbRef.current
    if (!thumb) return
    const step = thumb.offsetWidth + 4 // thumb width + grid gap
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: index * step,
      step,
      axis: null,
      pos: index * step,
      lastX: e.clientX,
      lastT: e.timeStamp,
      velocity: 0,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY

    if (!drag.axis) {
      if (Math.abs(dx) < AXIS_DEADZONE && Math.abs(dy) < AXIS_DEADZONE) return
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (drag.axis === 'y') {
        // A scroll that happened to start on the bar: let the page have it.
        dragRef.current = null
        return
      }
      navRef.current?.setAttribute('data-dragging', '')
      if (thumbRef.current) thumbRef.current.style.transition = 'none'
      suppressClickRef.current = true
      // Keep receiving moves when the finger drifts off the bar. Capture can
      // throw if the pointer is already gone; the drag still works without it.
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    }

    const max = last * drag.step
    let pos = drag.origin + dx
    if (pos < 0) pos *= RUBBER_BAND
    else if (pos > max) pos = max + (pos - max) * RUBBER_BAND
    drag.pos = pos

    const dt = e.timeStamp - drag.lastT
    if (dt > 0) drag.velocity = 0.7 * ((e.clientX - drag.lastX) / dt) + 0.3 * drag.velocity
    drag.lastX = e.clientX
    drag.lastT = e.timeStamp

    const over = Math.min(last, Math.max(0, Math.round(pos / drag.step)))
    if (over !== (hover ?? index)) {
      setHover(over)
      haptic('light')
    }
    if (!frameRef.current) frameRef.current = requestAnimationFrame(paint)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    if (drag.axis !== 'x') {
      dragRef.current = null
      return
    }
    // Stale velocity from a drag that stopped before lifting shouldn't fling.
    const velocity = e.timeStamp - drag.lastT > 80 ? 0 : drag.velocity
    const projected =
      Math.abs(velocity) > FLICK_VELOCITY ? drag.pos + velocity * FLICK_PROJECTION_MS : drag.pos
    settle(Math.min(last, Math.max(0, Math.round(projected / drag.step))))
    // The trailing click (if any) is dispatched before this timer runs; if no
    // click follows, the flag must not swallow the next real tap.
    setTimeout(() => { suppressClickRef.current = false }, 0)
  }

  const onPointerCancel = () => {
    if (!dragRef.current) return
    settle(index)
    setTimeout(() => { suppressClickRef.current = false }, 0)
  }

  return (
    <nav
      ref={navRef}
      className="progress-tabs"
      role="tablist"
      aria-label="Progress sections"
      data-onboard="progress-tabs"
      data-tab-slider=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onClickCapture={e => {
        // The pointerup that ends a slide also fires a click on the tab it
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
