'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import CoachFabIcon from './CoachFabIcon'
import { useCoach, type CoachDockId } from './CoachProvider'
import {
  COACH_FAB_SIZE,
  dockPixelPosition,
  nearestDock,
} from './dockGeometry'

/**
 * Tap vs drag — older / clumsier taps often jitter 8–12px.
 * Require distance + a short hold, OR a clearly intentional flick.
 */
const DRAG_THRESHOLD = 16
const DRAG_ACTIVATE_MS = 120
/** Skip the hold delay once movement clearly isn't a tap */
const DRAG_FAST_THRESHOLD = 32

/** Soft magnetic spring to corner docks (mass = 1), slightly underdamped */
const SPRING_K = 280
const SPRING_C = 26
const SETTLE_POS = 0.4
const SETTLE_VEL = 10
/** How much release velocity feeds the spring (magnetic fling) */
const SPRING_VEL_CARRY = 0.45

const VEL_EMA = 0.78

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
  const [settling, setSettling] = useState(false)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)

  const pointerId = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const startTs = useRef(0)
  const moved = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  const lastTs = useRef(0)
  const vel = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number | null>(null)
  const springPos = useRef({ x: 0, y: 0, vx: 0, vy: 0 })
  const springTarget = useRef({ x: 0, y: 0 })
  const pendingDock = useRef<CoachDockId | null>(null)

  const cancelSpring = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  useEffect(() => () => cancelSpring(), [cancelSpring])

  const startSpringToDock = useCallback(
    (from: { x: number; y: number }, next: CoachDockId) => {
      cancelSpring()
      const target = dockPixelPosition(next)
      pendingDock.current = next
      // Persist dock early so sheet/open state stay in sync; inline px still win.
      setDock(next)
      springPos.current = {
        x: from.x,
        y: from.y,
        vx: vel.current.x * SPRING_VEL_CARRY,
        vy: vel.current.y * SPRING_VEL_CARRY,
      }
      springTarget.current = target
      setSettling(true)
      setGhost({ x: from.x, y: from.y })

      const finish = () => {
        cancelSpring()
        const docked = pendingDock.current
        pendingDock.current = null
        setGhost(null)
        setSettling(false)
        if (docked) setDock(docked)
      }

      const tick = () => {
        const pos = springPos.current
        const tgt = springTarget.current
        const dt = 1 / 60

        const ax = -SPRING_K * (pos.x - tgt.x) - SPRING_C * pos.vx
        const ay = -SPRING_K * (pos.y - tgt.y) - SPRING_C * pos.vy
        pos.vx += ax * dt
        pos.vy += ay * dt
        pos.x += pos.vx * dt
        pos.y += pos.vy * dt

        setGhost({ x: pos.x, y: pos.y })

        const dist = Math.hypot(pos.x - tgt.x, pos.y - tgt.y)
        const speed = Math.hypot(pos.vx, pos.vy)
        if (dist < SETTLE_POS && speed < SETTLE_VEL) {
          finish()
          return
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [cancelSpring, setDock],
  )

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (open || settling) return
      cancelSpring()
      pointerId.current = e.pointerId
      start.current = { x: e.clientX, y: e.clientY }
      const now = performance.now()
      startTs.current = now
      lastPos.current = { x: e.clientX, y: e.clientY }
      lastTs.current = now
      vel.current = { x: 0, y: 0 }
      moved.current = false
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    },
    [cancelSpring, open, settling],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (pointerId.current !== e.pointerId || !start.current) return
      const dx = e.clientX - start.current.x
      const dy = e.clientY - start.current.y
      if (!moved.current) {
        const dist = Math.hypot(dx, dy)
        if (dist < DRAG_THRESHOLD) return
        const held = performance.now() - startTs.current
        // Distance alone isn't enough for short shaky taps; a clear flick
        // (≥ fast threshold) activates immediately so intentional drags
        // don't feel sticky.
        if (held < DRAG_ACTIVATE_MS && dist < DRAG_FAST_THRESHOLD) return
        moved.current = true
        setDragging(true)
      }

      const now = performance.now()
      const dtMs = Math.max(1, now - lastTs.current)
      const last = lastPos.current
      if (last) {
        const ivx = ((e.clientX - last.x) / dtMs) * 1000
        const ivy = ((e.clientY - last.y) / dtMs) * 1000
        vel.current = {
          x: vel.current.x * VEL_EMA + ivx * (1 - VEL_EMA),
          y: vel.current.y * VEL_EMA + ivy * (1 - VEL_EMA),
        }
      }
      lastTs.current = now
      lastPos.current = { x: e.clientX, y: e.clientY }

      const x = e.clientX - COACH_FAB_SIZE / 2
      const y = e.clientY - COACH_FAB_SIZE / 2
      setGhost({ x, y })
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
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }

      if (wasDrag && pos) {
        const centerX = pos.x
        const centerY = pos.y
        const next = nearestDock(centerX, centerY)
        const from = {
          x: centerX - COACH_FAB_SIZE / 2,
          y: centerY - COACH_FAB_SIZE / 2,
        }
        if (reduceMotion) {
          setGhost(null)
          setDock(next)
          return
        }
        startSpringToDock(from, next)
        return
      }

      setGhost(null)
      if (!open) openCoach()
    },
    [open, openCoach, reduceMotion, setDock, startSpringToDock],
  )

  // Parked: CSS data-dock owns left/right/top/bottom with no position
  // transitions — settle is the RAF spring above (avoids L-shaped travel).
  // Leave transform unset so `.press` can still animate tap scale.
  const live =
    (dragging || settling) && ghost
      ? {
          position: 'fixed' as const,
          left: ghost.x,
          top: ghost.y,
          right: 'auto',
          bottom: 'auto',
          // left/top update every frame with no transition; keep CSS lift
          // (scale/shadow) on `.coach-fab--dragging` smooth.
          transition: reduceMotion
            ? 'none'
            : 'transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease',
          zIndex: 420,
        }
      : open
        ? {
            visibility: 'hidden' as const,
            pointerEvents: 'none' as const,
          }
        : undefined

  return (
    <button
      ref={fabRef}
      type="button"
      className={`coach-fab press${dragging ? ' coach-fab--dragging' : ''}${
        settling ? ' coach-fab--settling' : ''
      }${capped ? ' coach-fab--capped' : ''}`}
      data-dock={dock}
      data-haptic={dragging || settling || open ? undefined : 'light'}
      aria-label="Open Coach"
      aria-expanded={open}
      aria-haspopup="dialog"
      tabIndex={open ? -1 : 0}
      aria-hidden={open || undefined}
      style={live}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <CoachFabIcon size={48} />
    </button>
  )
}
