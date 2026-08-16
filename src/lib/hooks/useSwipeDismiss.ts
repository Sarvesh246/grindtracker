'use client'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
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
 *
 * iOS will still scroll the page under a `touch-action: none` element unless
 * `touchmove` is canceled with `{ passive: false }`. We attach that listener
 * on the host so swiping a toast never drags `.app-main`.
 *
 * Once the drag is armed, pointerup / pointercancel / lostpointercapture are
 * tracked on `window` — iOS often drops the host's pointerup when the page
 * starts scrolling (or a haptic overlay steals the target), which left the
 * pill stuck mid-swipe until a later scroll finally fired cancel.
 */
export function useSwipeDismiss(onDismiss?: () => void, disabled = false) {
  const drag = useRef<Drag | null>(null)
  const lastDelta = useRef({ x: 0, y: 0 })
  const hostRef = useRef<HTMLDivElement | null>(null)
  const detachWindow = useRef<(() => void) | null>(null)
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  const [fly, setFly] = useState<{ x: number; y: number } | null>(null)
  const [gone, setGone] = useState(false)
  const dismissed = useRef(false)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const detachWindowListeners = useCallback(() => {
    detachWindow.current?.()
    detachWindow.current = null
  }, [])

  const commit = useCallback((dx: number, dy: number) => {
    if (dismissed.current) return
    const dismiss = onDismissRef.current
    if (!dismiss) return
    dismissed.current = true
    detachWindowListeners()
    drag.current = null
    setFly(swipeFlyOff(dx, dy))
    dismiss()
  }, [detachWindowListeners])

  const finish = useCallback((dx: number, dy: number, dtMs: number) => {
    detachWindowListeners()
    const start = drag.current
    drag.current = null
    if (!start?.armed) {
      setOffset(null)
      lastDelta.current = { x: 0, y: 0 }
      return
    }
    if (swipeShouldDismiss(dx, dy, dtMs)) {
      commit(dx, dy)
    } else {
      setOffset(null)
      lastDelta.current = { x: 0, y: 0 }
    }
  }, [commit, detachWindowListeners])

  const attachWindowListeners = useCallback((pointerId: number) => {
    if (detachWindow.current) return

    const onMove = (e: PointerEvent) => {
      const start = drag.current
      if (!start || start.id !== pointerId || e.pointerId !== pointerId) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      lastDelta.current = { x: dx, y: dy }
      setOffset({ x: dx, y: dy })
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      const start = drag.current
      if (!start) {
        detachWindowListeners()
        return
      }
      const vanished = e.clientX === 0 && e.clientY === 0 && (e.type === 'pointercancel' || e.type === 'lostpointercapture')
      const dx = vanished ? lastDelta.current.x : e.clientX - start.x
      const dy = vanished ? lastDelta.current.y : e.clientY - start.y
      finish(dx, dy, e.timeStamp - start.t)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!drag.current?.armed) return
      e.preventDefault()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('lostpointercapture', onUp)
    document.addEventListener('touchmove', onTouchMove, { passive: false })

    detachWindow.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('lostpointercapture', onUp)
      document.removeEventListener('touchmove', onTouchMove)
    }
  }, [detachWindowListeners, finish])

  useEffect(() => () => detachWindowListeners(), [detachWindowListeners])

  // After the fly-off, force the pill out of the compositor so iOS can't
  // leave a stuck layer that only a page scroll would clear.
  useEffect(() => {
    if (!fly) return
    const t = window.setTimeout(() => setGone(true), SWIPE_OUT_MS)
    return () => clearTimeout(t)
  }, [fly])

  const ensureScrollLock = useCallback((el: HTMLDivElement) => {
    hostRef.current = el
    if (el.dataset.swipeScrollLock === '1') return
    el.dataset.swipeScrollLock = '1'
    el.addEventListener('touchmove', (ev) => {
      if (!drag.current) return
      ev.preventDefault()
    }, { passive: false })
  }, [])

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!onDismiss || disabled || fly || dismissed.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    ensureScrollLock(e.currentTarget)
    lastDelta.current = { x: 0, y: 0 }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, armed: false }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start || start.id !== e.pointerId || !onDismiss || fly) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    lastDelta.current = { x: dx, y: dy }
    if (!start.armed) {
      if (Math.hypot(dx, dy) < 8) return
      start.armed = true
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* already captured / unsupported */ }
      attachWindowListeners(e.pointerId)
    }
    e.preventDefault()
    setOffset({ x: dx, y: dy })
  }

  function endPointer(e: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start || start.id !== e.pointerId) return
    const vanished = e.clientX === 0 && e.clientY === 0
    const dx = vanished ? lastDelta.current.x : e.clientX - start.x
    const dy = vanished ? lastDelta.current.y : e.clientY - start.y
    finish(dx, dy, e.timeStamp - start.t)
  }

  const dragging = offset !== null && fly === null
  const swiping = dragging || fly !== null
  const tx = fly?.x ?? offset?.x ?? 0
  const ty = fly?.y ?? offset?.y ?? 0
  const dist = Math.hypot(tx, ty)
  const dragOpacity = fly ? 0 : dragging ? Math.max(0.35, 1 - dist / 220) : undefined

  const style: CSSProperties = {
    ...(onDismiss ? {
      pointerEvents: !disabled && !fly ? 'auto' : 'none',
      touchAction: 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      cursor: !disabled ? (dragging ? 'grabbing' : 'grab') : undefined,
    } : {}),
    transform: swiping ? `translate3d(${tx}px, ${ty}px, 0)` : undefined,
    opacity: gone ? 0 : dragOpacity,
    visibility: gone ? 'hidden' : undefined,
    transition: fly
      ? `transform ${SWIPE_OUT_MS}ms cubic-bezier(0.32, 0.08, 0.24, 1), opacity ${SWIPE_OUT_MS}ms ease`
      : dragging
        ? 'none'
        : offset === null
          ? 'transform 180ms ease, opacity 180ms ease'
          : undefined,
    willChange: swiping ? 'transform, opacity' : undefined,
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
