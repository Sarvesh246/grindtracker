'use client'
import { useEffect, useRef, useState } from 'react'
import { haptic, supportsVibrate } from '@/lib/utils/haptics'
import { resolveRestSeconds } from '@/lib/utils/restPref'

export {
  REST_PRESETS,
  DEFAULT_REST,
  getDefaultRest,
  setDefaultRest,
  getExerciseRest,
  setExerciseRest,
  getSessionRest,
  setSessionRest,
  clearSessionRest,
  resolveRestSeconds,
  getPauseRestOnExit,
  setPauseRestOnExit,
} from '@/lib/utils/restPref'

interface TimerState {
  exerciseId: string | null
  startedAt: number // epoch ms
  durationMs: number
  remainingMs: number
  paused: boolean
}

const ZERO: TimerState = { exerciseId: null, startedAt: 0, durationMs: 0, remainingMs: 0, paused: false }
const ACTIVE_TIMER_KEY = 'grind.rest.active_timer'
/** Brief "REST DONE" hold after hitting 0 before clearing active state. */
const DONE_FLASH_MS = 1250

/** Restore a persisted timer from localStorage on page remount (e.g. after navigating away and back).
 *  A RUNNING timer uses startedAt + durationMs to recompute remaining so the countdown is
 *  live-accurate even if the user spent time away. A PAUSED timer (e.g. frozen by "Save & Exit")
 *  restores its frozen remainingMs verbatim instead — it shouldn't have kept counting down while
 *  paused. An EXPIRED running timer is restored once with remainingMs=0 so the workout page can
 *  fire a single rest-end notification before clearing — returning ZERO immediately would cancel
 *  the server cron fallback without ever notifying. */
function readPersistedTimer(): TimerState {
  if (typeof window === 'undefined') return ZERO
  try {
    const raw = localStorage.getItem(ACTIVE_TIMER_KEY)
    if (!raw) return ZERO
    const saved = JSON.parse(raw) as {
      exerciseId: string
      startedAt: number
      durationMs: number
      paused?: boolean
      remainingMs?: number
    }
    if (saved.paused) {
      const remainingMs = Math.max(0, saved.remainingMs ?? 0)
      if (remainingMs <= 0) { localStorage.removeItem(ACTIVE_TIMER_KEY); return ZERO }
      return { exerciseId: saved.exerciseId, startedAt: saved.startedAt, durationMs: saved.durationMs, remainingMs, paused: true }
    }
    const elapsed = Date.now() - saved.startedAt
    const remainingMs = Math.max(0, saved.durationMs - elapsed)
    if (remainingMs <= 0) {
      // Clear persistence so a later remount doesn't re-notify; keep one expired
      // tick in memory for the consumer's rest-end path.
      localStorage.removeItem(ACTIVE_TIMER_KEY)
      return {
        exerciseId: saved.exerciseId,
        startedAt: saved.startedAt,
        durationMs: saved.durationMs,
        remainingMs: 0,
        paused: false,
      }
    }
    return { exerciseId: saved.exerciseId, startedAt: saved.startedAt, durationMs: saved.durationMs, remainingMs, paused: false }
  } catch { return ZERO }
}

/**
 * Single global rest timer for the active workout.
 * Persists the active timer to localStorage so it survives page navigations.
 * Auto-fires light haptic at 10s remaining and at 0s on Android only.
 * iOS can't fire timer haptics without a direct switch tap (26.5+/27) — rest-end
 * UI (and later push) covers that path instead.
 */
export function useRestTimer() {
  const [state, setState] = useState<TimerState>(() => readPersistedTimer())
  const tenSecFired = useRef(false)
  const zeroFired = useRef(false)
  const rafRef = useRef<number | null>(null)

  // Sync a RUNNING timer's parameters to localStorage so a page remount can restore
  // the countdown. We watch exerciseId/startedAt/durationMs/paused — NOT remainingMs,
  // to avoid writing on every 250ms tick. The restore function recomputes remaining
  // from startedAt + durationMs, so the value is always live-accurate on restore.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (state.paused) return // handled by the paused-specific effect below
    if (state.exerciseId && state.remainingMs > 0) {
      localStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify({
        exerciseId: state.exerciseId,
        startedAt: state.startedAt,
        durationMs: state.durationMs,
        paused: false,
      }))
    } else {
      localStorage.removeItem(ACTIVE_TIMER_KEY)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.exerciseId, state.startedAt, state.durationMs, state.paused])

  // Sync a PAUSED timer separately, including its frozen remainingMs — this is
  // what lets "Save & Exit" freeze the rest timer where it was and have it
  // resume from there rather than losing it entirely on remount. remainingMs is
  // frozen while paused (the tick effect below doesn't run in that state), so
  // this doesn't reintroduce a write-every-tick problem.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!state.exerciseId || !state.paused) return
    if (state.remainingMs <= 0) { localStorage.removeItem(ACTIVE_TIMER_KEY); return }
    localStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify({
      exerciseId: state.exerciseId,
      startedAt: state.startedAt,
      durationMs: state.durationMs,
      paused: true,
      remainingMs: state.remainingMs,
    }))
  }, [state.exerciseId, state.paused, state.remainingMs, state.startedAt, state.durationMs])

  useEffect(() => {
    if (!state.exerciseId || state.paused) return
    let cancelled = false

    function tick() {
      if (cancelled) return
      const elapsed = Date.now() - state.startedAt
      const remaining = Math.max(0, state.durationMs - elapsed)

      if (!tenSecFired.current && remaining <= 10_000 && remaining > 0) {
        tenSecFired.current = true
        // Timer-fired: Android vibrate only. iOS imperative path is dead on 26.5+.
        if (supportsVibrate()) haptic('light')
      }
      if (!zeroFired.current && remaining === 0) {
        zeroFired.current = true
        if (supportsVibrate()) haptic('light')
      }

      setState(s => (s.exerciseId === state.exerciseId ? { ...s, remainingMs: remaining } : s))

      if (remaining > 0) {
        rafRef.current = window.setTimeout(tick, 250) as unknown as number
      }
    }

    tick()
    return () => {
      cancelled = true
      if (rafRef.current !== null) {
        clearTimeout(rafRef.current)
        rafRef.current = null
      }
    }
  }, [state.exerciseId, state.startedAt, state.durationMs, state.paused])

  // After a natural zero, keep the bar mounted briefly for "REST DONE", then clear.
  // Manual stop()/start() cancel this via cleanup. reduce-motion still gets the
  // brief label (CSS transitions are zeroed elsewhere; this is a timed unmount).
  useEffect(() => {
    if (!state.exerciseId || state.paused || state.remainingMs > 0) return
    const id = window.setTimeout(() => setState(ZERO), DONE_FLASH_MS)
    return () => clearTimeout(id)
  }, [state.exerciseId, state.remainingMs, state.paused])

  function start(exerciseId: string, durationSec?: number) {
    const seconds = durationSec ?? resolveRestSeconds(exerciseId)
    tenSecFired.current = false
    zeroFired.current = false
    setState({
      exerciseId,
      startedAt: Date.now(),
      durationMs: seconds * 1000,
      remainingMs: seconds * 1000,
      paused: false,
    })
  }

  function stop() {
    setState(ZERO)
  }

  function addSeconds(delta: number) {
    setState(s => {
      if (!s.exerciseId) return s
      // Clamp at 0 so subtracting more than what's left doesn't go negative
      // (a negative remaining would render as e.g. "-0:05" until the next tick).
      const remainingMs = Math.max(0, s.remainingMs + delta * 1000)
      const durationMs = Math.max(0, s.durationMs + delta * 1000)
      // Re-arm the 10s/0s haptics if adding time lifts us back above the threshold.
      if (remainingMs > 10_000) tenSecFired.current = false
      if (remainingMs > 0) zeroFired.current = false
      // Bumping durationMs raises the countdown by delta: while running the next
      // tick recomputes remaining = durationMs - elapsed; while paused remainingMs
      // is the source of truth (kept in sync here for the progress bar ratio).
      return { ...s, durationMs, remainingMs }
    })
  }

  function pause() {
    // Freeze the exact remaining time rather than whatever the last 250ms tick
    // left behind — otherwise each pause/resume cycle silently gifts up to a
    // quarter second of rest.
    setState(s =>
      s.exerciseId && !s.paused
        ? { ...s, paused: true, remainingMs: Math.max(0, s.durationMs - (Date.now() - s.startedAt)) }
        : s,
    )
  }

  function resume() {
    // Rebase the clock so `durationMs - elapsed` lands back on the frozen
    // remaining time. Only startedAt moves: durationMs stays the FULL rest
    // period, because the progress bar draws remainingMs/durationMs — shrinking
    // the duration to what's left (as this used to) snaps the bar back to 100%
    // on every resume.
    setState(s =>
      s.exerciseId && s.paused
        ? { ...s, paused: false, startedAt: Date.now() - (s.durationMs - s.remainingMs) }
        : s,
    )
  }

  // Stay "active" through the post-zero flash so RestTimerBar can show REST DONE
  // before unmounting. Auto-clear (above) or stop() ends the flash.
  const done = state.exerciseId !== null && !state.paused && state.remainingMs <= 0
  return {
    active: state.exerciseId !== null && (state.remainingMs > 0 || state.paused || done),
    done,
    paused: state.paused,
    exerciseId: state.exerciseId,
    remainingMs: state.remainingMs,
    durationMs: state.durationMs,
    /** Epoch ms when the current (or paused) countdown clock was anchored. */
    startedAt: state.startedAt,
    start,
    stop,
    addSeconds,
    pause,
    resume,
  }
}
