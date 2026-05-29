'use client'
import { useEffect, useRef, useState } from 'react'
import { haptic } from '@/lib/utils/haptics'

export const REST_PRESETS = [60, 90, 120, 180] as const
const STORAGE_PREFIX = 'grind.rest.'
export const DEFAULT_REST = 90

export function getExerciseRest(exerciseId: string): number {
  if (typeof window === 'undefined') return DEFAULT_REST
  const v = localStorage.getItem(STORAGE_PREFIX + exerciseId)
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REST
}

export function setExerciseRest(exerciseId: string, seconds: number) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_PREFIX + exerciseId, String(seconds))
}

interface TimerState {
  exerciseId: string | null
  startedAt: number // epoch ms
  durationMs: number
  remainingMs: number
}

const ZERO: TimerState = { exerciseId: null, startedAt: 0, durationMs: 0, remainingMs: 0 }

/**
 * Single global rest timer for the active workout.
 * Auto-fires light haptic at 10s remaining and at 0s.
 */
export function useRestTimer() {
  const [state, setState] = useState<TimerState>(ZERO)
  const tenSecFired = useRef(false)
  const zeroFired = useRef(false)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!state.exerciseId) return
    let cancelled = false

    function tick() {
      if (cancelled) return
      const elapsed = Date.now() - state.startedAt
      const remaining = Math.max(0, state.durationMs - elapsed)

      if (!tenSecFired.current && remaining <= 10_000 && remaining > 0) {
        tenSecFired.current = true
        haptic('light')
      }
      if (!zeroFired.current && remaining === 0) {
        zeroFired.current = true
        haptic('light')
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
  }, [state.exerciseId, state.startedAt, state.durationMs])

  function start(exerciseId: string, durationSec?: number) {
    const seconds = durationSec ?? getExerciseRest(exerciseId)
    tenSecFired.current = false
    zeroFired.current = false
    setState({
      exerciseId,
      startedAt: Date.now(),
      durationMs: seconds * 1000,
      remainingMs: seconds * 1000,
    })
  }

  function stop() {
    setState(ZERO)
  }

  function addSeconds(delta: number) {
    setState(s =>
      s.exerciseId
        ? { ...s, durationMs: s.durationMs + delta * 1000, remainingMs: s.remainingMs + delta * 1000 }
        : s,
    )
  }

  return {
    active: state.exerciseId !== null && state.remainingMs > 0,
    exerciseId: state.exerciseId,
    remainingMs: state.remainingMs,
    durationMs: state.durationMs,
    start,
    stop,
    addSeconds,
  }
}
