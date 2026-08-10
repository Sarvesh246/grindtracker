'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useMotionPref } from '@/lib/contexts/MotionContext'

/** Same order as BottomNav's tabs — swiping left/right steps through this list. */
const TAB_ORDER = ['/home', '/log', '/progress', '/profile', '/leaderboard']

const SWIPE_MIN_PX = 60
const SWIPE_FRACTION = 0.22
const AXIS_DEADZONE = 8
const SETTLE_MS = 220
// Safety net: if a committed swipe's router.push never lands (e.g. the target
// route errors), this forces the content back on-screen instead of leaving it
// permanently slid off. The pathname effect below normally wins the race.
const STUCK_FALLBACK_MS = 900

type Phase = 'idle' | 'dragging' | 'settling'

/**
 * Wraps `.app-main`'s children so a horizontal drag anywhere on a top-level
 * tab page steps to the next/previous tab, mirroring BottomNav. Deliberately
 * does NOT live-preview the neighboring route (each tab is a separate routed
 * page with its own server data fetch — there's no cheap way to mount two at
 * once) — instead the current page follows the finger and, past threshold,
 * finishes sliding off before the route change lands. The incoming page gets
 * no bespoke entrance transform; it just gets the existing `.page` fade-in,
 * same as any other navigation (see the "Opts-only" note on `.page` in
 * globals.css — a transform on a page-level container would make it a
 * containing block for that page's own fixed bars/modals).
 */
export default function SwipeNavigator({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { reduceMotion } = useMotionPref()

  const wrapperRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; axis: 'x' | 'y' | null } | null>(null)
  const stuckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [dragX, setDragX] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')

  const tabIndex = TAB_ORDER.indexOf(pathname)
  // Active workout owns fixed bars (rest timer, finish bar) directly in the
  // page tree — same reason BottomNav hides here. A drag-transform on this
  // page would drag those along with it, so swipe is off for the duration.
  const isActiveWorkout = pathname === '/log' && !!searchParams.get('day')
  const swipeEnabled = tabIndex !== -1 && !isActiveWorkout

  // Reset the instant the outgoing page actually swaps for the incoming one —
  // not on a timer — so there's never a frame where old content snaps back to
  // center before the new page has replaced it.
  useEffect(() => {
    if (stuckTimer.current) {
      clearTimeout(stuckTimer.current)
      stuckTimer.current = null
    }
    // Intentional: synchronizing local drag-transform state with the router's
    // pathname (an external system), not deriving it from props/state — the
    // documented exception to this rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDragX(0)
    setPhase('idle')
  }, [pathname])

  useEffect(() => () => {
    if (stuckTimer.current) clearTimeout(stuckTimer.current)
  }, [])

  function onPointerDown(e: ReactPointerEvent) {
    if (!swipeEnabled || phase === 'settling' || e.pointerType === 'mouse') return
    const target = e.target as HTMLElement
    // Text fields need native horizontal cursor/selection drag, which a
    // page-swipe would hijack. Charts need their own hold-and-drag scrub
    // across data points (Recharts' Tooltip tracks touchmove itself) — once a
    // page-swipe commits mid-scrub it navigates away instead of just moving
    // the crosshair, which is worse than the swipe being unavailable there.
    if (target.closest('input, textarea, select, [contenteditable="true"], .recharts-wrapper')) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, axis: null }
  }

  function onPointerMove(e: ReactPointerEvent) {
    const drag = dragRef.current
    if (!drag || !swipeEnabled) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (!drag.axis) {
      if (Math.abs(dx) < AXIS_DEADZONE && Math.abs(dy) < AXIS_DEADZONE) return
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (drag.axis === 'x') setPhase('dragging')
    }
    if (drag.axis !== 'x') return
    e.preventDefault()
    const atStart = tabIndex === 0 && dx > 0
    const atEnd = tabIndex === TAB_ORDER.length - 1 && dx < 0
    // Rubber-band resistance past the first/last tab instead of a hard stop.
    setDragX(atStart || atEnd ? dx * 0.35 : dx)
  }

  function onPointerUp() {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.axis !== 'x') {
      if (phase !== 'idle') setPhase('idle')
      return
    }

    const width = wrapperRef.current?.offsetWidth || window.innerWidth
    const threshold = Math.max(SWIPE_MIN_PX, width * SWIPE_FRACTION)
    if (dragX <= -threshold && tabIndex < TAB_ORDER.length - 1) {
      commit(TAB_ORDER[tabIndex + 1], -width)
    } else if (dragX >= threshold && tabIndex > 0) {
      commit(TAB_ORDER[tabIndex - 1], width)
    } else {
      settleBack()
    }
  }

  function commit(href: string, exitX: number) {
    setPhase('settling')
    setDragX(exitX)
    router.push(href)
    stuckTimer.current = setTimeout(() => {
      setDragX(0)
      setPhase('idle')
    }, STUCK_FALLBACK_MS)
  }

  function settleBack() {
    setPhase('settling')
    setDragX(0)
    window.setTimeout(() => setPhase('idle'), reduceMotion ? 0 : SETTLE_MS)
  }

  // minHeight (not height) so a page shorter than the viewport still fills
  // .app-main and can be swiped from its blank lower area, without clipping a
  // page that's taller and needs to scroll past 100%.
  const style: React.CSSProperties =
    phase === 'idle'
      ? { minHeight: '100%' }
      : {
          minHeight: '100%',
          transform: `translateX(${dragX}px)`,
          transition: phase === 'settling' && !reduceMotion
            ? `transform ${SETTLE_MS}ms cubic-bezier(0.22,1,0.36,1)`
            : 'none',
        }

  return (
    <div
      ref={wrapperRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={style}
    >
      {children}
    </div>
  )
}
