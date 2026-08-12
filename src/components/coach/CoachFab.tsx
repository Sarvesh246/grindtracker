'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import CoachFabIcon from './CoachFabIcon'
import { useCoach, type CoachDockId } from './CoachProvider'
import {
  FAB_SETTLE_POS,
  FAB_SETTLE_VEL,
  FAB_SPRING_C,
  FAB_SPRING_K,
  FAB_SPRING_VEL_CARRY,
  FAB_SPRING_VEL_CARRY_FLICK,
  FLICK_VELOCITY_PX_S,
  dropletRadius,
  squashFromVelocity,
} from './coachMotion'
import {
  COACH_FAB_SIZE,
  dockFromRelease,
  dockPixelPosition,
} from './dockGeometry'

/**
 * Tap vs drag — older / clumsier taps often jitter 8–12px.
 * Require distance + a short hold, OR a clearly intentional flick.
 */
const DRAG_THRESHOLD = 16
const DRAG_ACTIVATE_MS = 120
/** Skip the hold delay once movement clearly isn't a tap */
const DRAG_FAST_THRESHOLD = 32

const VEL_EMA = 0.78
/** Softer squash recovery — matches global spring polish */
const SQUASH_SPRING_K = 200
const SQUASH_SPRING_C = 26
/** Release glow fade (ms) — sustained hold uses --pressed, not this timer */
const GLOW_RELEASE_MS = 450

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
  const [pressed, setPressed] = useState(false)
  const [glowing, setGlowing] = useState(false)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const [squash, setSquash] = useState({ sx: 1, sy: 1 })

  const pointerId = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const startTs = useRef(0)
  const moved = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  const lastTs = useRef(0)
  const vel = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number | null>(null)
  const squashRaf = useRef<number | null>(null)
  const springPos = useRef({ x: 0, y: 0, vx: 0, vy: 0 })
  const springTarget = useRef({ x: 0, y: 0 })
  const pendingDock = useRef<CoachDockId | null>(null)
  const squashRef = useRef({ sx: 1, sy: 1, vsx: 0, vsy: 0 })
  const glowTimer = useRef<number | null>(null)

  const cancelSpring = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const cancelSquashSpring = useCallback(() => {
    if (squashRaf.current != null) {
      cancelAnimationFrame(squashRaf.current)
      squashRaf.current = null
    }
  }, [])

  const clearGlowTimer = useCallback(() => {
    if (glowTimer.current != null) {
      window.clearTimeout(glowTimer.current)
      glowTimer.current = null
    }
  }, [])

  useEffect(
    () => () => {
      cancelSpring()
      cancelSquashSpring()
      clearGlowTimer()
    },
    [cancelSpring, cancelSquashSpring, clearGlowTimer],
  )

  const springSquashToRest = useCallback(() => {
    if (reduceMotion) {
      squashRef.current = { sx: 1, sy: 1, vsx: 0, vsy: 0 }
      setSquash({ sx: 1, sy: 1 })
      return
    }
    cancelSquashSpring()
    const tick = () => {
      const s = squashRef.current
      const dt = 1 / 60
      const ax = -SQUASH_SPRING_K * (s.sx - 1) - SQUASH_SPRING_C * s.vsx
      const ay = -SQUASH_SPRING_K * (s.sy - 1) - SQUASH_SPRING_C * s.vsy
      s.vsx += ax * dt
      s.vsy += ay * dt
      s.sx += s.vsx * dt
      s.sy += s.vsy * dt
      setSquash({ sx: s.sx, sy: s.sy })
      if (
        Math.abs(s.sx - 1) < 0.004 &&
        Math.abs(s.sy - 1) < 0.004 &&
        Math.hypot(s.vsx, s.vsy) < 0.08
      ) {
        squashRef.current = { sx: 1, sy: 1, vsx: 0, vsy: 0 }
        setSquash({ sx: 1, sy: 1 })
        squashRaf.current = null
        return
      }
      squashRaf.current = requestAnimationFrame(tick)
    }
    squashRaf.current = requestAnimationFrame(tick)
  }, [cancelSquashSpring, reduceMotion])

  const startSpringToDock = useCallback(
    (from: { x: number; y: number }, next: CoachDockId, flicked: boolean) => {
      cancelSpring()
      const target = dockPixelPosition(next)
      pendingDock.current = next
      // Persist dock early so sheet/open state stay in sync; inline px still win.
      setDock(next)
      const carry = flicked ? FAB_SPRING_VEL_CARRY_FLICK : FAB_SPRING_VEL_CARRY
      springPos.current = {
        x: from.x,
        y: from.y,
        vx: vel.current.x * carry,
        vy: vel.current.y * carry,
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

        const ax = -FAB_SPRING_K * (pos.x - tgt.x) - FAB_SPRING_C * pos.vx
        const ay = -FAB_SPRING_K * (pos.y - tgt.y) - FAB_SPRING_C * pos.vy
        pos.vx += ax * dt
        pos.vy += ay * dt
        pos.x += pos.vx * dt
        pos.y += pos.vy * dt

        setGhost({ x: pos.x, y: pos.y })

        const dist = Math.hypot(pos.x - tgt.x, pos.y - tgt.y)
        const speed = Math.hypot(pos.vx, pos.vy)
        if (dist < FAB_SETTLE_POS && speed < FAB_SETTLE_VEL) {
          finish()
          return
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [cancelSpring, setDock],
  )

  /** Release glow: ease out slowly after a tap (not used while held). */
  const releaseGlow = useCallback(() => {
    if (reduceMotion) {
      setGlowing(false)
      return
    }
    setGlowing(true)
    clearGlowTimer()
    glowTimer.current = window.setTimeout(() => {
      setGlowing(false)
      glowTimer.current = null
    }, GLOW_RELEASE_MS)
  }, [clearGlowTimer, reduceMotion])

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (open || settling) return
      cancelSpring()
      clearGlowTimer()
      pointerId.current = e.pointerId
      start.current = { x: e.clientX, y: e.clientY }
      const now = performance.now()
      startTs.current = now
      lastPos.current = { x: e.clientX, y: e.clientY }
      lastTs.current = now
      vel.current = { x: 0, y: 0 }
      moved.current = false
      // Sustained press/glow immediately — not a flash that dies mid-hold.
      setPressed(true)
      setGlowing(false)
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    },
    [cancelSpring, clearGlowTimer, open, settling],
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
        // Keep --pressed glow while the finger is down through the drag.
        cancelSquashSpring()
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

      if (!reduceMotion) {
        const next = squashFromVelocity(vel.current.x, vel.current.y)
        squashRef.current = { ...next, vsx: 0, vsy: 0 }
        setSquash(next)
      }

      const x = e.clientX - COACH_FAB_SIZE / 2
      const y = e.clientY - COACH_FAB_SIZE / 2
      setGhost({ x, y })
    },
    [cancelSquashSpring, reduceMotion],
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
      setPressed(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }

      // Glow fades out on release (tap or drag) — not snipped when drag starts.
      releaseGlow()

      if (wasDrag && pos) {
        const centerX = pos.x
        const centerY = pos.y
        const speed = Math.hypot(vel.current.x, vel.current.y)
        const flicked = speed >= FLICK_VELOCITY_PX_S
        const next = dockFromRelease(
          centerX,
          centerY,
          vel.current.x,
          vel.current.y,
          FLICK_VELOCITY_PX_S,
        )
        const from = {
          x: centerX - COACH_FAB_SIZE / 2,
          y: centerY - COACH_FAB_SIZE / 2,
        }
        springSquashToRest()
        if (reduceMotion) {
          setGhost(null)
          setDock(next)
          return
        }
        startSpringToDock(from, next, flicked)
        return
      }

      setGhost(null)
      springSquashToRest()
      // Tap haptic via data-haptic (iOS overlay + Android vibrate) — no extra
      // navigator.vibrate here (would double-buzz on Android).
      if (!open) openCoach()
    },
    [
      open,
      openCoach,
      reduceMotion,
      releaseGlow,
      setDock,
      springSquashToRest,
      startSpringToDock,
    ],
  )

  // Pause idle float while pressed/dragging/settling — press should feel solid.
  const alive = !open && !dragging && !settling && !ghost && !pressed
  const morphing =
    !reduceMotion && (squash.sx !== 1 || squash.sy !== 1 || dragging)

  // Parked: CSS data-dock owns left/right/top/bottom with no position
  // transitions — settle is the RAF spring above (avoids L-shaped travel).
  // Leave transform unset so float / press / grab classes can own it.
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
            : 'box-shadow 180ms ease, opacity 180ms ease',
          zIndex: 420,
        }
      : open
        ? {
            visibility: 'hidden' as const,
            pointerEvents: 'none' as const,
          }
        : undefined

  // Liquid stretch lives on the filled morph disc — the G stays upright
  // (counter-scale) so velocity squash never warps/rotates the glyph.
  const morphStyle =
    morphing
      ? {
          transform: `scale(${squash.sx}, ${squash.sy})`,
          borderRadius: dropletRadius(squash.sx, squash.sy),
        }
      : undefined
  const glyphStyle =
    morphing
      ? {
          transform: `scale(${1 / squash.sx}, ${1 / squash.sy})`,
        }
      : undefined

  return (
    <button
      ref={fabRef}
      type="button"
      className={`coach-fab press${dragging ? ' coach-fab--dragging' : ''}${
        settling ? ' coach-fab--settling' : ''
      }${pressed ? ' coach-fab--pressed' : ''}${
        alive ? ' coach-fab--alive' : ''
      }${glowing && !pressed ? ' coach-fab--glow' : ''}${
        capped ? ' coach-fab--capped' : ''
      }`}
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
      <span className="coach-fab__float">
        <span className="coach-fab__morph" style={morphStyle}>
          <span className="coach-fab__glyph" style={glyphStyle}>
            <CoachFabIcon size={48} />
          </span>
        </span>
      </span>
    </button>
  )
}
