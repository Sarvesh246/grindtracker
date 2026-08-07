'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
 *   toursSeen       — ids of scripted walkthroughs the user finished or skipped.
 *   tooltipsSeen    — ids of one-off contextual hints (e.g. ActiveWorkout) shown once.
 *   skipAll         — the user hit "Skip tour" on any scripted walkthrough. Bailing
 *                     out of one is treated as bailing out of all of them, so this
 *                     suppresses every future *scripted tour* — but NOT the
 *                     ActiveWorkout contextual tooltips, which are functional
 *                     hints, opt-in per id, and unaffected by this flag.
 *   tooltipsSkipped — the user hit "Skip tips" on any contextual hint. Mirrors
 *                     skipAll's "bail out of one, bail out of all" logic but for
 *                     the contextual-hint family instead of the scripted tours —
 *                     the two opt-outs are deliberately independent.
 *
 * The layout Server Component reads the row once per navigation and seeds
 * this as `initialState`; writes update local state immediately (so the UI
 * never waits on a round trip) and fire the Supabase update in the
 * background.
 *
 * Mirrors ThemeContext's cookie+localStorage belt-and-suspenders: the server
 * row is the source of truth, but a `grind_onboarding_{userId}` localStorage
 * mirror is written on every update too. Without it, a single failed/slow
 * Supabase write (RLS hiccup, a migration not yet applied, a flaky network
 * request racing a tab close) silently reverts "seen" back to "unseen" on
 * the very next full page load — the tour then resurfaces every single
 * time, which reads to the user as it never having been dismissed at all.
 * The localStorage mirror is read on mount and unioned into state (never
 * lets a tour un-see itself), so a lost server write degrades to "this one
 * device remembers" instead of "nothing remembers."
 */
export interface OnboardingState {
  toursSeen: string[]
  tooltipsSeen: string[]
  skipAll: boolean
  tooltipsSkipped: boolean
}

function storageKey(userId: string) {
  return `grind_onboarding_${userId}`
}

function readLocalState(userId: string): OnboardingState | null {
  if (userId === 'anon') return null
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return {
      toursSeen: Array.isArray(parsed.toursSeen) ? parsed.toursSeen : [],
      tooltipsSeen: Array.isArray(parsed.tooltipsSeen) ? parsed.tooltipsSeen : [],
      skipAll: parsed.skipAll === true,
      tooltipsSkipped: parsed.tooltipsSkipped === true,
    }
  } catch {
    return null
  }
}

function writeLocalState(userId: string, state: OnboardingState) {
  if (userId === 'anon') return
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state))
  } catch {
    // ignore — private mode / sandboxed context
  }
}

/** Union two states, never letting either side un-see something the other saw. */
function mergeOnboardingState(a: OnboardingState, b: OnboardingState): OnboardingState {
  return {
    toursSeen: Array.from(new Set([...a.toursSeen, ...b.toursSeen])),
    tooltipsSeen: Array.from(new Set([...a.tooltipsSeen, ...b.tooltipsSeen])),
    skipAll: a.skipAll || b.skipAll,
    tooltipsSkipped: a.tooltipsSkipped || b.tooltipsSkipped,
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
  /** Suppress every future contextual hint (offered on each one via "Skip tips"). */
  skipAllTooltips: () => void
  /** Replay affordance (Profile → Settings): forget every tour/tooltip and both
   *  skip opt-outs, so the full walkthrough runs again from Home. */
  resetAllTours: () => void
}

const noop = () => {}
const OnboardingContext = createContext<OnboardingContextValue>({
  hasSeenTour: () => false,
  markTourSeen: noop,
  hasSeenTooltip: () => false,
  markTooltipSeen: noop,
  skipAllTours: noop,
  skipAllTooltips: noop,
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
          onboarding_tooltips_skipped: next.tooltipsSkipped,
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
      writeLocalState(userId, next)
      pendingRef.current = next
      void persist()
    },
    [userId, persist],
  )

  // Post-mount reconciliation: adopt anything the localStorage mirror saw
  // that the server row didn't (a previously failed/slow Supabase write —
  // see the module docstring). Runs after the server-seeded first render so
  // there's no hydration mismatch, and re-fires the background persist so a
  // now-healthy connection can catch the server row up.
  useEffect(() => {
    const local = readLocalState(userId)
    if (!local) return
    const merged = mergeOnboardingState(initialState, local)
    const changed =
      merged.skipAll !== initialState.skipAll ||
      merged.toursSeen.length !== initialState.toursSeen.length ||
      merged.tooltipsSeen.length !== initialState.tooltipsSeen.length
    if (changed) {
      // Intentional post-mount sync from a browser-only store (localStorage
      // is unavailable during SSR), mirroring ThemeContext's cookie/
      // localStorage reconciliation effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      update(merged)
    }
    // Runs once on mount per user — `update`'s identity is stable enough
    // (only depends on userId/persist) that omitting it here just avoids a
    // spurious re-run when persist's supabase-client identity churns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const hasSeenTour = useCallback((id: string) => state.skipAll || state.toursSeen.includes(id), [state])
  const hasSeenTooltip = useCallback(
    (id: string) => state.tooltipsSkipped || state.tooltipsSeen.includes(id),
    [state],
  )

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
  const skipAllTooltips = useCallback(() => {
    if (state.tooltipsSkipped) return
    update({ ...state, tooltipsSkipped: true })
  }, [state, update])
  const resetAllTours = useCallback(() => {
    update({ toursSeen: [], tooltipsSeen: [], skipAll: false, tooltipsSkipped: false })
  }, [update])

  const value = useMemo(
    () => ({
      hasSeenTour,
      markTourSeen,
      hasSeenTooltip,
      markTooltipSeen,
      skipAllTours,
      skipAllTooltips,
      resetAllTours,
    }),
    [hasSeenTour, markTourSeen, hasSeenTooltip, markTooltipSeen, skipAllTours, skipAllTooltips, resetAllTours],
  )

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>
}

export function useOnboarding() {
  return useContext(OnboardingContext)
}
