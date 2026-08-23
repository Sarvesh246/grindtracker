'use client'

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

/** Same wobble tolerance as the document tap/drag guard and SwipeNavigator. */
export const TAP_GESTURE_MOVE_PX = 10

/**
 * Distinguishes a tap from a scroll that started on the control.
 * `onPointerDown` on inputs/RPE used to unlock/edit immediately, so a
 * finger that landed on a field and then scrolled still edited it.
 */
export function useTapGesture(movePx: number = TAP_GESTURE_MOVE_PX) {
  const start = useRef<{ x: number; y: number } | null>(null)
  const dragged = useRef(false)

  function onPointerDown(e: ReactPointerEvent) {
    start.current = { x: e.clientX, y: e.clientY }
    dragged.current = false
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!start.current) return
    if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > movePx) {
      dragged.current = true
    }
  }

  function onPointerEnd() {
    start.current = null
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerEnd,
    didDrag: () => dragged.current,
    wasTap: () => !dragged.current,
  }
}
