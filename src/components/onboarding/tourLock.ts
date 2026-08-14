'use client'

import { useEffect, useState } from 'react'

/**
 * At most one scripted walkthrough at a time. Page tours (home, log, …) and the
 * later Coach FAB tour share this slot so two coach-marks never stack.
 */
const EVENT = 'grind:onboarding-tour'
let runningId: string | null = null

export function getRunningTourId(): string | null {
  return runningId
}

/** True if this id now owns the slot (already-owner is ok). */
export function claimTour(id: string): boolean {
  if (runningId && runningId !== id) return false
  const changed = runningId !== id
  runningId = id
  if (changed) notify()
  return true
}

export function releaseTour(id: string): void {
  if (runningId !== id) return
  runningId = null
  notify()
}

function notify() {
  try {
    window.dispatchEvent(new Event(EVENT))
  } catch {
    /* ignore — SSR / tests without window listeners */
  }
}

export function useRunningTourId(): string | null {
  const [id, setId] = useState<string | null>(runningId)
  useEffect(() => {
    const sync = () => setId(runningId)
    sync()
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
  }, [])
  return id
}

/** Test-only: clear the module slot between cases. */
export function resetTourLockForTests(): void {
  runningId = null
}
