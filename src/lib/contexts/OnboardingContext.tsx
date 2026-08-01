'use client'
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react'

/**
 * First-time-user onboarding store. Same pattern as the other client prefs
 * (`grind_theme_pref`, `grind_unit_pref`, `grind_overdue_dismissed`): a
 * localStorage key scoped per user, read via `useSyncExternalStore` so hydration
 * stays clean (server snapshot is always the EMPTY default; the client reads the
 * real value after mount) and a custom event reflects a write in one component
 * (or tab) into every subscriber.
 *
 *   toursSeen    — ids of scripted walkthroughs the user finished or skipped.
 *   tooltipsSeen — ids of one-off contextual hints (e.g. ActiveWorkout) shown once.
 *   skipAll      — the user chose "Skip all tours" on the very first coach mark.
 *                  Suppresses every future *scripted tour* but NOT the ActiveWorkout
 *                  contextual tooltips — those are functional hints, opt-in per id.
 */
export interface OnboardingState {
  toursSeen: string[]
  tooltipsSeen: string[]
  skipAll: boolean
}

const EMPTY: OnboardingState = { toursSeen: [], tooltipsSeen: [], skipAll: false }

const EVENT = 'grind:onboarding-changed'
const keyFor = (userId: string) => `grind_onboarding_${userId}`

// Referentially-stable snapshot cache, keyed by storage key. `useSyncExternalStore`
// requires getSnapshot to return the SAME reference until the value truly changes,
// or it loops forever — so we parse localStorage once and hand back the cached
// object until a write (this tab) or a `storage` event (another tab) invalidates it.
const snapshots = new Map<string, OnboardingState>()

function read(key: string): OnboardingState {
  const cached = snapshots.get(key)
  if (cached) return cached
  let val: OnboardingState = EMPTY
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<OnboardingState>
      val = {
        toursSeen: Array.isArray(parsed.toursSeen) ? parsed.toursSeen : [],
        tooltipsSeen: Array.isArray(parsed.tooltipsSeen) ? parsed.tooltipsSeen : [],
        skipAll: !!parsed.skipAll,
      }
    }
  } catch {
    val = EMPTY
  }
  snapshots.set(key, val)
  return val
}

function write(key: string, next: OnboardingState) {
  snapshots.set(key, next)
  try {
    localStorage.setItem(key, JSON.stringify(next))
  } catch {
    // ignore — private mode / sandboxed context
  }
  // Native 'storage' doesn't fire in the tab that wrote it, so nudge our own
  // subscribers with a custom event (mirrors HomeDashboard's overdue-dismiss).
  try {
    window.dispatchEvent(new Event(EVENT))
  } catch {
    // ignore — non-browser context
  }
}

function subscribe(key: string, cb: () => void): () => void {
  const onEvent = () => cb()
  const onStorage = (e: StorageEvent) => {
    // Another tab wrote our key — drop the stale snapshot so read() re-parses.
    if (e.key === key) {
      snapshots.delete(key)
      cb()
    }
  }
  window.addEventListener(EVENT, onEvent)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, onEvent)
    window.removeEventListener('storage', onStorage)
  }
}

interface OnboardingContextValue {
  /** True once the tour was finished/skipped, or the user opted out of all tours. */
  hasSeenTour: (id: string) => boolean
  markTourSeen: (id: string) => void
  /** Contextual tooltips ignore `skipAll` — they're functional, not onboarding fluff. */
  hasSeenTooltip: (id: string) => boolean
  markTooltipSeen: (id: string) => void
  /** Suppress every future scripted tour (offered once, on the first coach mark). */
  skipAllTours: () => void
  /** Replay affordance: forget a tour (and clear the global opt-out) so it fires again. */
  resetTour: (id: string) => void
}

const noop = () => {}
const OnboardingContext = createContext<OnboardingContextValue>({
  hasSeenTour: () => false,
  markTourSeen: noop,
  hasSeenTooltip: () => false,
  markTooltipSeen: noop,
  skipAllTours: noop,
  resetTour: noop,
})

export function OnboardingProvider({
  userId,
  children,
}: {
  userId: string
  children: React.ReactNode
}) {
  const key = useMemo(() => keyFor(userId), [userId])

  const state = useSyncExternalStore(
    useCallback(cb => subscribe(key, cb), [key]),
    () => read(key),
    () => EMPTY,
  )

  const hasSeenTour = useCallback(
    (id: string) => state.skipAll || state.toursSeen.includes(id),
    [state],
  )
  const hasSeenTooltip = useCallback((id: string) => state.tooltipsSeen.includes(id), [state])

  const markTourSeen = useCallback(
    (id: string) => {
      const cur = read(key)
      if (cur.toursSeen.includes(id)) return
      write(key, { ...cur, toursSeen: [...cur.toursSeen, id] })
    },
    [key],
  )
  const markTooltipSeen = useCallback(
    (id: string) => {
      const cur = read(key)
      if (cur.tooltipsSeen.includes(id)) return
      write(key, { ...cur, tooltipsSeen: [...cur.tooltipsSeen, id] })
    },
    [key],
  )
  const skipAllTours = useCallback(() => {
    const cur = read(key)
    if (cur.skipAll) return
    write(key, { ...cur, skipAll: true })
  }, [key])
  const resetTour = useCallback(
    (id: string) => {
      const cur = read(key)
      write(key, { ...cur, skipAll: false, toursSeen: cur.toursSeen.filter(t => t !== id) })
    },
    [key],
  )

  const value = useMemo(
    () => ({
      hasSeenTour,
      markTourSeen,
      hasSeenTooltip,
      markTooltipSeen,
      skipAllTours,
      resetTour,
    }),
    [hasSeenTour, markTourSeen, hasSeenTooltip, markTooltipSeen, skipAllTours, resetTour],
  )

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>
}

export function useOnboarding() {
  return useContext(OnboardingContext)
}
