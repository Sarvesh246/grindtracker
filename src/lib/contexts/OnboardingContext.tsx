'use client'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * First-time-user onboarding store. Server-authoritative (migration
 * `22-onboarding-state.sql`, columns on `user_profiles`) rather than
 * localStorage — it used to be a per-browser localStorage key, but that ties
 * "have I seen this" to one device's storage: private browsing, a cleared-
 * site-data event, or the installed PWA (a separate storage partition from
 * the website on some platforms) all read back empty, resurfacing the whole
 * walkthrough on what looks to the user like just signing back in. Every
 * other piece of account state in this app is server-authoritative; this
 * matches that.
 *
 *   toursSeen    — ids of scripted walkthroughs the user finished or skipped.
 *   tooltipsSeen — ids of one-off contextual hints (e.g. ActiveWorkout) shown once.
 *   skipAll      — the user chose "Skip all tours" on the very first coach mark.
 *                  Suppresses every future *scripted tour* but NOT the ActiveWorkout
 *                  contextual tooltips — those are functional hints, opt-in per id.
 *
 * The layout Server Component reads the row once per navigation and seeds
 * this as `initialState`; writes update local state immediately (so the UI
 * never waits on a round trip) and fire the Supabase update in the
 * background.
 */
export interface OnboardingState {
  toursSeen: string[]
  tooltipsSeen: string[]
  skipAll: boolean
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
  /** Replay affordance (Profile → Settings): forget every tour/tooltip and the
   *  skip-all opt-out, so the full walkthrough runs again from Home. */
  resetAllTours: () => void
}

const noop = () => {}
const OnboardingContext = createContext<OnboardingContextValue>({
  hasSeenTour: () => false,
  markTourSeen: noop,
  hasSeenTooltip: () => false,
  markTooltipSeen: noop,
  skipAllTours: noop,
  resetAllTours: noop,
})

export function OnboardingProvider({
  userId,
  initialState,
  children,
}: {
  userId: string
  initialState: OnboardingState
  children: React.ReactNode
}) {
  const supabase = useMemo(() => createClient(), [])
  const [state, setState] = useState(initialState)
  // Coalesce rapid-fire marks (e.g. skimming through several tooltips) into
  // whatever the state looks like when the network actually gets a turn,
  // rather than firing one UPDATE per mark.
  const pendingRef = useRef<OnboardingState | null>(null)
  const flushingRef = useRef(false)

  const persist = useCallback(async () => {
    if (userId === 'anon' || flushingRef.current) return
    flushingRef.current = true
    while (pendingRef.current) {
      const next = pendingRef.current
      pendingRef.current = null
      const { error } = await supabase
        .from('user_profiles')
        .update({
          onboarding_tours_seen: next.toursSeen,
          onboarding_tooltips_seen: next.tooltipsSeen,
          onboarding_skip_all: next.skipAll,
        })
        .eq('id', userId)
      if (error) {
        // Non-fatal: the tour already advanced locally for this session; the
        // next successful write (or the next full page load re-reading the
        // still-unset server row) will catch it up.
        console.error('Failed to persist onboarding state', error)
        break
      }
    }
    flushingRef.current = false
  }, [userId, supabase])

  const update = useCallback(
    (next: OnboardingState) => {
      setState(next)
      pendingRef.current = next
      void persist()
    },
    [persist],
  )

  const hasSeenTour = useCallback((id: string) => state.skipAll || state.toursSeen.includes(id), [state])
  const hasSeenTooltip = useCallback((id: string) => state.tooltipsSeen.includes(id), [state])

  const markTourSeen = useCallback(
    (id: string) => {
      if (state.toursSeen.includes(id)) return
      update({ ...state, toursSeen: [...state.toursSeen, id] })
    },
    [state, update],
  )
  const markTooltipSeen = useCallback(
    (id: string) => {
      if (state.tooltipsSeen.includes(id)) return
      update({ ...state, tooltipsSeen: [...state.tooltipsSeen, id] })
    },
    [state, update],
  )
  const skipAllTours = useCallback(() => {
    if (state.skipAll) return
    update({ ...state, skipAll: true })
  }, [state, update])
  const resetAllTours = useCallback(() => {
    update({ toursSeen: [], tooltipsSeen: [], skipAll: false })
  }, [update])

  const value = useMemo(
    () => ({
      hasSeenTour,
      markTourSeen,
      hasSeenTooltip,
      markTooltipSeen,
      skipAllTours,
      resetAllTours,
    }),
    [hasSeenTour, markTourSeen, hasSeenTooltip, markTooltipSeen, skipAllTours, resetAllTours],
  )

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>
}

export function useOnboarding() {
  return useContext(OnboardingContext)
}
