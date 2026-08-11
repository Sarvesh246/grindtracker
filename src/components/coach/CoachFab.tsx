'use client'

import { useCallback, useRef, useState, type PointerEvent } from 'react'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import CoachFabIcon from './CoachFabIcon'
import { useCoach, type CoachDockId } from './CoachProvider'

const FAB_SIZE = 56
const DRAG_THRESHOLD = 8

const DOCK_ORDER: CoachDockId[] = ['tl', 'tr', 'bl', 'br']

function nearestDock(x: number, y: number): CoachDockId {
  const w = window.innerWidth
  const h = window.innerHeight
  const cx = w / 2
  const cy = h / 2
  if (x < cx && y < cy) return 'tl'
  if (x >= cx && y < cy) return 'tr'
  if (x < cx && y >= cy) return 'bl'
  return 'br'
}

export default function CoachFab() {
  const { open, openCoach, dock, setDock, fabRef, quota, quotaLoaded } =
    useCoach()
  const { reduceMotion } = useMotionPref()
  const capped = quotaLoaded && quota != null && quota.dailyRemaining <= 0

  const [dragging, setDragging] = useState(false)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const pointerId = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (open) return
      pointerId.current = e.pointerId
      start.current = { x: e.clientX, y: e.clientY }
      lastPos.current = { x: e.clientX, y: e.clientY }
      moved.current = false
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    },
    [open],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (pointerId.current !== e.pointerId || !start.current) return
      const dx = e.clientX - start.current.x
      const dy = e.clientY - start.current.y
      if (!moved.current) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        moved.current = true
        setDragging(true)
      }
      lastPos.current = { x: e.clientX, y: e.clientY }
      // Anchor ghost so finger sits at FAB center.
      setGhost({
        x: e.clientX - FAB_SIZE / 2,
        y: e.clientY - FAB_SIZE / 2,
      })
    },
    [],
  )

  const endDrag = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (pointerId.current !== e.pointerId) return
      const wasDrag = moved.current
      const pos = lastPos.current
      pointerId.current = null
      start.current = null
      moved.current = false
      setDragging(false)
      setGhost(null)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      if (wasDrag && pos) {
        const next = nearestDock(pos.x, pos.y)
        if (next !== dock) setDock(next)
        // Snap is CSS position change; ensure valid dock id.
        if (!DOCK_ORDER.includes(next)) setDock('br')
        return
      }
      // Tap → open
      if (!open) openCoach()
    },
    [dock, open, openCoach, setDock],
  )

  // Keep the FAB mounted while open so close can restore focus, but hide it
  // visually under the sheet/backdrop.
  return (
    <button
      ref={fabRef}
      type="button"
      className={`coach-fab press${dragging ? ' coach-fab--dragging' : ''}${
        capped ? ' coach-fab--capped' : ''
      }`}
      data-dock={dock}
      data-haptic={dragging || open ? undefined : 'light'}
      aria-label="Open Coach"
      aria-expanded={open}
      aria-haspopup="dialog"
      tabIndex={open ? -1 : 0}
      aria-hidden={open || undefined}
      style={
        open
          ? {
              visibility: 'hidden' as const,
              pointerEvents: 'none' as const,
            }
          : ghost
            ? {
                position: 'fixed',
                left: ghost.x,
                top: ghost.y,
                right: 'auto',
                bottom: 'auto',
                transform: 'none',
                transition: reduceMotion ? 'none' : undefined,
                zIndex: 420,
              }
            : {
                transition: reduceMotion
                  ? 'none'
                  : 'left 280ms cubic-bezier(0.2, 0.9, 0.2, 1), right 280ms cubic-bezier(0.2, 0.9, 0.2, 1), top 280ms cubic-bezier(0.2, 0.9, 0.2, 1), bottom 280ms cubic-bezier(0.2, 0.9, 0.2, 1)',
              }
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <CoachFabIcon size={32} />
    </button>
  )
}
