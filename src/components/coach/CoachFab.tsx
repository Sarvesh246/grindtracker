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

const DRAG_THRESHOLD = 8

/** Soft Apple-sheet spring (mass = 1) */
const SPRING_K = 210
const SPRING_C = 24
const SETTLE_POS = 0.5
const SETTLE_VEL = 12

const VEL_EMA = 0.78
const STRETCH_SPEED = 1400
const STRETCH_MAX = 0.12

type Stretch = {
  sx: number
  sy: number
  angle: number
  radius: string
}

const IDENTITY_STRETCH: Stretch = {
  sx: 1,
  sy: 1,
  angle: 0,
  radius: '9999px',
}

function stretchFromVelocity(vx: number, vy: number): Stretch {
  const speed = Math.hypot(vx, vy)
  if (speed < 8) return IDENTITY_STRETCH
  const t = Math.min(1, speed / STRETCH_SPEED)
  const stretch = 1 + STRETCH_MAX * t
  const squash = 1 - STRETCH_MAX * t
  const angle = (Math.atan2(vy, vx) * 180) / Math.PI
  // Droplet: trail flatter, lead rounder — bias by velocity direction.
  const lead = Math.round(9999 - 2200 * t)
  const trail = Math.round(9999 - 4800 * t)
  // Corners: TL TR BR BL — shift which pair leads based on angle octant.
  const a = ((angle % 360) + 360) % 360
  let radius: string
  if (a >= 315 || a < 45) {
    // → right
    radius = `${trail}px ${lead}px ${lead}px ${trail}px`
  } else if (a < 135) {
    // ↓ down
    radius = `${trail}px ${trail}px ${lead}px ${lead}px`
  } else if (a < 225) {
    // ← left
    radius = `${lead}px ${trail}px ${trail}px ${lead}px`
  } else {
    // ↑ up
    radius = `${lead}px ${lead}px ${trail}px ${trail}px`
  }
  return { sx: stretch, sy: squash, angle, radius }
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
  const [settling, setSettling] = useState(false)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const [stretch, setStretch] = useState<Stretch>(IDENTITY_STRETCH)

  const pointerId = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  const lastTs = useRef(0)
  const vel = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number | null>(null)
  const springPos = useRef({ x: 0, y: 0, vx: 0, vy: 0 })
  const springTarget = useRef({ x: 0, y: 0 })
  const pendingDock = useRef<CoachDockId | null>(null)
  const stretchSpring = useRef({ sx: 1, sy: 1, angle: 0, vsx: 0, vsy: 0 })

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
        vx: vel.current.x * 0.35,
        vy: vel.current.y * 0.35,
      }
      springTarget.current = target
      const cur = stretchFromVelocity(vel.current.x, vel.current.y)
      stretchSpring.current = {
        sx: cur.sx,
        sy: cur.sy,
        angle: cur.angle,
        vsx: 0,
        vsy: 0,
      }
      setSettling(true)
      setGhost({ x: from.x, y: from.y })
      setStretch(cur)

      const finish = () => {
        cancelSpring()
        const docked = pendingDock.current
        pendingDock.current = null
        setGhost(null)
        setSettling(false)
        setStretch(IDENTITY_STRETCH)
        stretchSpring.current = { sx: 1, sy: 1, angle: 0, vsx: 0, vsy: 0 }
        if (docked) setDock(docked)
      }

      const tick = () => {
        const pos = springPos.current
        const tgt = springTarget.current
        const st = stretchSpring.current
        const dt = 1 / 60

        const ax = -SPRING_K * (pos.x - tgt.x) - SPRING_C * pos.vx
        const ay = -SPRING_K * (pos.y - tgt.y) - SPRING_C * pos.vy
        pos.vx += ax * dt
        pos.vy += ay * dt
        pos.x += pos.vx * dt
        pos.y += pos.vy * dt

        const asx = -SPRING_K * (st.sx - 1) - SPRING_C * st.vsx
        const asy = -SPRING_K * (st.sy - 1) - SPRING_C * st.vsy
        st.vsx += asx * dt
        st.vsy += asy * dt
        st.sx += st.vsx * dt
        st.sy += st.vsy * dt

        setGhost({ x: pos.x, y: pos.y })
        const nearId =
          Math.abs(st.sx - 1) < 0.01 && Math.abs(st.sy - 1) < 0.01
        setStretch(
          nearId
            ? IDENTITY_STRETCH
            : {
                sx: st.sx,
                sy: st.sy,
                angle: st.angle,
                radius: stretchFromVelocity(pos.vx, pos.vy).radius,
              },
        )

        const dist = Math.hypot(pos.x - tgt.x, pos.y - tgt.y)
        const speed = Math.hypot(pos.vx, pos.vy)
        if (dist < SETTLE_POS && speed < SETTLE_VEL && nearId) {
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
      lastPos.current = { x: e.clientX, y: e.clientY }
      lastTs.current = performance.now()
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
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
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
      if (!reduceMotion) {
        setStretch(stretchFromVelocity(vel.current.x, vel.current.y))
      }
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
          setStretch(IDENTITY_STRETCH)
          setDock(next)
          return
        }
        startSpringToDock(from, next)
        return
      }

      setGhost(null)
      setStretch(IDENTITY_STRETCH)
      if (!open) openCoach()
    },
    [open, openCoach, reduceMotion, setDock, startSpringToDock],
  )

  // Parked: CSS data-dock owns left/right/top/bottom with no position
  // transitions — settle is the RAF spring above (avoids L-shaped travel).
  // Leave style unset so `.press` can still animate tap scale.
  const live =
    (dragging || settling) && ghost
      ? {
          position: 'fixed' as const,
          left: ghost.x,
          top: ghost.y,
          right: 'auto',
          bottom: 'auto',
          transform: reduceMotion
            ? 'none'
            : `rotate(${stretch.angle}deg) scale(${stretch.sx}, ${stretch.sy})`,
          borderRadius: reduceMotion ? undefined : stretch.radius,
          transition: 'none',
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
