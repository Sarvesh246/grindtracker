'use client'

import { useCallback, useRef, useState, type PointerEvent } from 'react'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import CoachFabIcon from './CoachFabIcon'
import { useCoach, type CoachDockId } from './CoachProvider'

const FAB_SIZE = 56
const DRAG_THRESHOLD = 8
/** Max squash/stretch while dragging — tasteful, not cartoonish. */
const STRETCH_MAX = 0.16

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export default function CoachFab() {
  const { open, openCoach, dock, setDock, fabRef, quota, quotaLoaded } =
    useCoach()
  const { reduceMotion } = useMotionPref()
  const capped =
    quotaLoaded &&
    quota != null &&
    !quota.unlimited &&
    quota.dailyRemaining <= 0

  const [dragging, setDragging] = useState(false)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const [stretch, setStretch] = useState({ x: 1, y: 1 })
  const pointerId = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)
  const lastPos = useRef<{ x: number; y: number; t: number } | null>(null)

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (open) return
      pointerId.current = e.pointerId
      start.current = { x: e.clientX, y: e.clientY }
      lastPos.current = { x: e.clientX, y: e.clientY, t: performance.now() }
      moved.current = false
      setStretch({ x: 1, y: 1 })
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

      const now = performance.now()
      const prev = lastPos.current
      lastPos.current = { x: e.clientX, y: e.clientY, t: now }

      // Soft liquid stretch from velocity + travel direction (iOS-orb feel).
      if (!reduceMotion && prev) {
        const dt = Math.max(8, now - prev.t)
        const vx = (e.clientX - prev.x) / dt
        const vy = (e.clientY - prev.y) / dt
        const travelX = clamp(dx / 140, -1, 1)
        const travelY = clamp(dy / 140, -1, 1)
        const sx = clamp(
          1 + vx * 0.045 + travelX * 0.06,
          1 - STRETCH_MAX,
          1 + STRETCH_MAX,
        )
        const sy = clamp(
          1 + vy * 0.045 + travelY * 0.06,
          1 - STRETCH_MAX,
          1 + STRETCH_MAX,
        )
        // Conserve a bit of “volume”: stretch on one axis lightly compresses the other.
        setStretch({
          x: clamp(sx * (2 - sy) * 0.5 + sx * 0.5, 1 - STRETCH_MAX, 1 + STRETCH_MAX),
          y: clamp(sy * (2 - sx) * 0.5 + sy * 0.5, 1 - STRETCH_MAX, 1 + STRETCH_MAX),
        })
      }

      setGhost({
        x: e.clientX - FAB_SIZE / 2,
        y: e.clientY - FAB_SIZE / 2,
      })
    },
    [reduceMotion],
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
      setStretch({ x: 1, y: 1 })
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      if (wasDrag && pos) {
        const next = nearestDock(pos.x, pos.y)
        if (next !== dock) setDock(next)
        if (!DOCK_ORDER.includes(next)) setDock('br')
        return
      }
      if (!open) openCoach()
    },
    [dock, open, openCoach, setDock],
  )

  const stretchTransform =
    dragging && !reduceMotion
      ? `scale(${stretch.x.toFixed(3)}, ${stretch.y.toFixed(3)})`
      : undefined

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
                transform: stretchTransform ?? 'none',
                transition: reduceMotion
                  ? 'none'
                  : dragging
                    ? 'transform 40ms linear'
                    : 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)',
                zIndex: 420,
                willChange: 'transform',
              }
            : {
                transform: stretchTransform,
                transition: reduceMotion
                  ? 'none'
                  : 'left 280ms cubic-bezier(0.2, 0.9, 0.2, 1), right 280ms cubic-bezier(0.2, 0.9, 0.2, 1), top 280ms cubic-bezier(0.2, 0.9, 0.2, 1), bottom 280ms cubic-bezier(0.2, 0.9, 0.2, 1), transform 280ms cubic-bezier(0.22, 1, 0.36, 1)',
              }
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <CoachFabIcon size={48} />
    </button>
  )
}
