'use client'
import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { swipeFlyOff, swipeShouldDismiss } from '@/lib/utils/swipeDismiss'

/** Keep in sync with `.toast-slide` / tooltip fly-off. */
export const SWIPE_OUT_MS = 480

type Drag = {
  id: number
  x: number
  y: number
  t: number
  armed: boolean
}

/**
 * Pointer-follow swipe that dismisses on left / right / up / down past a
 * short threshold (or a quicker flick). Taps on buttons inside the host still
 * fire — a drag only arms after a few pixels of movement.
 */
export function useSwipeDismiss(onDismiss?: () => void, disabled = false) {
  const drag = useRef<Drag | null>(null)
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  const [fly, setFly] = useState<{ x: number; y: number } | null>(null)
  const dismissed = useRef(false)

  const commit = useCallback((dx: number, dy: number) => {
    if (dismissed.current || !onDismiss) return
    dismissed.current = true
    setFly(swipeFlyOff(dx, dy))
    onDismiss()
  }, [onDismiss])

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!onDismiss || disabled || fly || dismissed.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, armed: false }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start || start.id !== e.pointerId || !onDismiss || fly) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (!start.armed) {
      if (Math.hypot(dx, dy) < 8) return
      start.armed = true
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* already captured / unsupported */ }
    }
    e.preventDefault()
    setOffset({ x: dx, y: dy })
  }

  function endPointer(e: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current
    drag.current = null
    if (!start || start.id !== e.pointerId) return
    if (!start.armed) {
      setOffset(null)
      return
    }
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (swipeShouldDismiss(dx, dy, e.timeStamp - start.t)) {
      commit(dx, dy)
    } else {
      setOffset(null)
    }
  }

  const dragging = offset !== null && fly === null
  const swiping = dragging || fly !== null
  const tx = fly?.x ?? offset?.x ?? 0
  const ty = fly?.y ?? offset?.y ?? 0
  const dist = Math.hypot(tx, ty)
  const dragOpacity = fly ? 0 : dragging ? Math.max(0.35, 1 - dist / 220) : undefined

  const style: CSSProperties = {
    pointerEvents: onDismiss && !disabled && !fly ? 'auto' : 'none',
    touchAction: onDismiss ? 'none' : undefined,
    userSelect: onDismiss ? 'none' : undefined,
    WebkitUserSelect: onDismiss ? 'none' : undefined,
    cursor: onDismiss && !disabled ? (dragging ? 'grabbing' : 'grab') : undefined,
    transform: swiping ? `translate(${tx}px, ${ty}px)` : undefined,
    opacity: dragOpacity,
    transition: fly
      ? `transform ${SWIPE_OUT_MS}ms cubic-bezier(0.32, 0.08, 0.24, 1), opacity ${SWIPE_OUT_MS}ms ease`
      : dragging
        ? 'none'
        : offset === null
          ? 'transform 180ms ease, opacity 180ms ease'
          : undefined,
  }

  return {
    dragging,
    flying: fly !== null,
    style,
    handlers: onDismiss && !disabled ? {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
    } : undefined,
  }
}
