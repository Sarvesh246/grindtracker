'use client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import { demoSafeClient } from '@/lib/demoMode/demoSafeSupabase'
import { Session, UserStats, UserRotation, CompleteSessionResult } from '@/lib/types'
import { getLevel, getXpInCurrentLevel, getXpRequiredForLevel, getXpToNextLevel } from '@/lib/utils/gamification'
import { formatHeaderDate, formatShortDate, localDateKey } from '@/lib/utils/formatting'
import { homeGreeting } from '@/lib/utils/homeGreeting'
import { advanceIndex, effectiveSequence, nextDay as nextDayFromRotation, overdueDays } from '@/lib/utils/rotation'
import { deleteIncompleteSessions } from '@/lib/utils/sessions'
import { flushQueuedOps, getQueuedOps, clearQueuedOpsForSession } from '@/lib/utils/offlineQueue'
import { checkAndAwardBadges } from '@/lib/utils/badges'
import { uncoveredDatesBetween, skipTodayState, restLeftThisWeekLabel, weekStart, sameDateKeyList, type RestDayOpts } from '@/lib/utils/restDays'
import WorkoutCalendar from '@/components/WorkoutCalendar'
import FinishUndoBanner from '@/components/FinishUndoBanner'
import ToastPill, { TOAST_SLIDE_OUT_MS } from '@/components/ToastPill'
import { useExitingValue } from '@/lib/hooks/useExitingValue'
import { useUnit } from '@/lib/contexts/UnitContext'
import { useToast } from '@/lib/contexts/ToastContext'
import { useTour, type TourStep } from '@/components/onboarding/Tour'
import FlameIcon from '@/components/FlameIcon'
import DayIcon from '@/components/DayIcon'
import { markAppDataStale } from '@/lib/cache/appDataCache'
import { reportError } from '@/lib/utils/reportError'
import {
  FINISH_UNDO_TTL_MS,
  writeFinishUndoToken,
} from '@/lib/utils/finishUndo'

// "This week"/"this month" start in the VIEWER's local timezone — computed here
// (client) rather than on the server, whose clock/timezone is very often not
// the viewer's and would bucket a workout into the wrong week/month right
// around the boundary. Same reasoning as `overdueDays`, computed client-side below.
// Week is Sunday–Saturday (`weekStart` in restDays.ts, SQL `grind_week_start`).
function getMonthStart(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

// The dismissed-overdue signature lives in localStorage and is read via
// useSyncExternalStore so hydration stays clean (server snapshot = null, client
// reads the real value). A custom event lets our own writes trigger a re-render,
// since the native 'storage' event doesn't fire in the document that wrote it.
const OVERDUE_DISMISS_KEY = 'grind_overdue_dismissed'
const OVERDUE_DISMISS_EVENT = 'grind:overdue-dismissed'
// Same pattern, second signature — the "missed a day?" rest-day banner below.
const REST_DISMISS_KEY = 'grind_restday_dismissed'
const REST_DISMISS_EVENT = 'grind:restday-dismissed'

function makeDismissStore(storageKey: string, eventName: string) {
  return {
    subscribe(cb: () => void): () => void {
      window.addEventListener('storage', cb)
      window.addEventListener(eventName, cb)
      return () => {
        window.removeEventListener('storage', cb)
        window.removeEventListener(eventName, cb)
      }
    },
    read(): string | null {
      try { return localStorage.getItem(storageKey) } catch { return null }
    },
    dismiss(sig: string) {
      try { localStorage.setItem(storageKey, sig) } catch {}
      window.dispatchEvent(new Event(eventName))
    },
  }
}
const overdueDismissStore = makeDismissStore(OVERDUE_DISMISS_KEY, OVERDUE_DISMISS_EVENT)
const restDismissStore = makeDismissStore(REST_DISMISS_KEY, REST_DISMISS_EVENT)

function restBudgetError(err: unknown): boolean {
  const msg = err && typeof err === 'object' && 'message' in err
    ? String((err as { message: unknown }).message)
    : err instanceof Error ? err.message : String(err ?? '')
  return msg.includes('REST_BUDGET_EXCEEDED')
}

interface ActiveSession {
  id: string
  day_type: string
  started_at: string
  loggedSets: number
}

interface Props {
  stats: UserStats | null
  activeSessions: ActiveSession[]
  lastSession: Session | null
  lastSessionLogs: { exercise_name: string; weight: number | null; sets: number; reps: number | null }[]
  nextDay: string
  nextDayExercises: string[]
  hasDays: boolean
  rotationSeq: string[]
  rotationIndex: number
  lastTrainedByDay: Record<string, string | null>
  firstName: string
  completedAt: string[]
  totalPRs: number
  recurringRestDays: number[]
  restDates: string[]
  restCancels?: string[]
  /** Active + soft-ended recurring intervals (43). */
  restIntervals?: { dayOfWeek: number; effectiveFrom: string; effectiveUntil: string | null }[]
}

const DAY_LABELS: Record<string, string> = {
  push: 'PUSH DAY',
  pull: 'PULL DAY',
  legs: 'LEGS DAY',
}

const DAY_MUSCLES: Record<string, string> = {
  push: 'Chest, Shoulders, Triceps',
  pull: 'Back, Biceps, Rear Delts',
  legs: 'Quads, Hamstrings, Glutes',
}

// Standard days read "PUSH DAY"; custom days (abs, cardio, …) just use the name.
function dayLabel(key: string): string {
  return DAY_LABELS[key] ?? key.replace(/-/g, ' ').toUpperCase()
}

// Just the day's name (no "DAY" suffix) for the overdue nudge.
function dayName(key: string): string {
  return key.replace(/-/g, ' ').toUpperCase()
}

function ChevronRight({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export default function HomeDashboard({
  // `userId` is gone: the stale-streak reset now calls the `refresh_stats` RPC,
  // which resolves the caller from the session rather than a passed-in id.
  stats,
  activeSessions,
  lastSession,
  lastSessionLogs,
  nextDay,
  nextDayExercises,
  hasDays,
  rotationSeq,
  rotationIndex,
  lastTrainedByDay,
  firstName,
  completedAt,
  totalPRs,
  recurringRestDays,
  restDates,
  restCancels = [],
  restIntervals = [],
}: Props) {
  const router = useRouter()
  const { demoMode } = useDemoMode()
  // Every write this component makes (rotation skip, rest-day confirm,
  // stale-streak refresh_stats) becomes a local no-op in Demo Mode — see
  // src/lib/demoMode/demoSafeSupabase.ts. The resume-active-session banner
  // (handleSaveActive/handleExitActive) never even renders in Demo Mode since
  // home/page.tsx always passes activeSessions={[]} there.
  const supabase = useMemo(
    () => (demoMode ? demoSafeClient(createClient()) : createClient()),
    [demoMode],
  )
  const { unitLabel, fmt } = useUnit()
  const toast = useToast()
  const recurringRestSet = useMemo(() => new Set(recurringRestDays), [recurringRestDays])
  const restOpts = useMemo<RestDayOpts>(() => ({
    cancels: new Set(restCancels),
    intervals: restIntervals,
    trainedDates: new Set(completedAt),
  }), [restCancels, restIntervals, completedAt])

  const xpTotal = stats?.xp_total ?? 0
  const level = getLevel(xpTotal)
  const xpInLevel = getXpInCurrentLevel(xpTotal)
  const levelSize = getXpRequiredForLevel(level)
  const xpToNext = getXpToNextLevel(xpTotal)
  const xpPercent = (xpInLevel / levelSize) * 100
  const longestStreak = stats?.longest_streak ?? 0
  const totalWorkouts = stats?.total_workouts ?? 0

  // Stale-streak reset, using the viewer's own local "today" (a server component
  // would otherwise use the server's clock/timezone — see getMonthStart
  // above for the same reasoning). A gap since the last workout only breaks the
  // streak if it ISN'T fully covered by rest days (recurring or one-off
  // confirmed — see CLAUDE.md → Rest days); a plain adjacent-day gap has no
  // days strictly between the endpoints, so uncoveredDates is empty either way.
  const [todayKey, setTodayKey] = useState(() => localDateKey())
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    const sync = () => {
      const next = localDateKey()
      setTodayKey(prev => (prev === next ? prev : next))
      const nextHour = new Date().getHours()
      setHour(prev => (prev === nextHour ? prev : nextHour))
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') sync()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', sync)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', sync)
    }
  }, [])
  const lastWorkoutKey = stats?.last_workout_date ?? null
  const [streakOverride, setStreakOverride] = useState<number | null>(null)
  const [restBannerBusy, setRestBannerBusy] = useState(false)
  const [restTodayBusy, setRestTodayBusy] = useState(false)
  const [restDatesOverride, setRestDatesOverride] = useState<string[] | null>(null)
  const effectiveRestDates = restDatesOverride ?? restDates
  const effectiveRestDateSet = useMemo(() => new Set(effectiveRestDates), [effectiveRestDates])
  const skipState = useMemo(
    () => skipTodayState(todayKey, recurringRestSet, effectiveRestDateSet, restOpts),
    [todayKey, recurringRestSet, effectiveRestDateSet, restOpts],
  )
  // Budget spent: tapping Rest today can't save the streak. Show that on the
  // card itself (red) instead of a confirm toast — tap again to dismiss.
  const [restStreakWarn, setRestStreakWarn] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestStreakWarn(false)
  }, [todayKey])
  // Rapid Rest today → undo must not wait on restTodayBusy (that dropped the
  // second tap) and must not fire overlapping toggle RPCs (unique violation /
  // permission-denied on steal-row cleanup). Optimistic UI flips immediately;
  // RPCs drain in order; extra taps coalesce as extra toggles.
  const pendingRestToggles = useRef(0)
  const restFlushing = useRef(false)
  const restTodayOnRef = useRef(skipState.todayIsOneOff)
  const restDatesRef = useRef(effectiveRestDates)

  useEffect(() => {
    if (restDatesOverride === null) {
      restDatesRef.current = restDates
      restTodayOnRef.current = restDates.includes(todayKey)
      return
    }
    if (sameDateKeyList(restDatesOverride, restDates)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRestDatesOverride(null)
    }
  }, [restDates, restDatesOverride, todayKey])
  const trainedToday = completedAt.includes(todayKey)
  const greeting = useMemo(
    () => homeGreeting({
      hour,
      firstName,
      trainedToday,
      inProgress: activeSessions.length > 0,
      isRestDay: skipState.todayIsRest,
      nextDay,
      dateKey: todayKey,
    }),
    [
      hour,
      firstName,
      trainedToday,
      activeSessions.length,
      skipState.todayIsRest,
      nextDay,
      todayKey,
    ],
  )
  const gapUncoveredDates = useMemo(
    () => lastWorkoutKey ? uncoveredDatesBetween(lastWorkoutKey, todayKey, recurringRestSet, effectiveRestDateSet, restOpts) : [],
    [lastWorkoutKey, todayKey, recurringRestSet, effectiveRestDateSet, restOpts],
  )
  // Confirming a missed-day gap spends the same weekly rest budget as Rest today.
  // Remaining slots = N minus rest days already used this week (on or before today).
  const restRemaining = Math.max(0, skipState.budget - skipState.used)
  const gapEligibleForPrompt =
    gapUncoveredDates.length > 0 && gapUncoveredDates.length <= restRemaining
  const restBannerSig = gapUncoveredDates.join(',')
  const restBannerDismissedSig = useSyncExternalStore(restDismissStore.subscribe, restDismissStore.read, () => null)
  const showRestBanner =
    (stats?.current_streak ?? 0) > 0 && gapEligibleForPrompt && restBannerDismissedSig !== restBannerSig
  const correctedStaleStreak = useRef(false)
  useEffect(() => {
    if (correctedStaleStreak.current) return
    if (!stats || stats.current_streak <= 0 || !stats.last_workout_date) return
    if (gapUncoveredDates.length === 0) return // no real gap, or fully rest-day-covered — nothing to correct
    // A small, plausibly-a-rest-day gap gets the banner instead of an
    // immediate correction — wait for the user's Yes/No before settling.
    if (gapEligibleForPrompt && restBannerDismissedSig !== restBannerSig) return
    correctedStaleStreak.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStreakOverride(0)
    // The client can no longer write user_stats directly. `refresh_stats`
    // re-derives everything server-side; passing our local date is what lets
    // Postgres decide the streak has lapsed in the *user's* timezone rather
    // than UTC (see CLAUDE.md → Dates & timezones). Fire-and-forget by design
    // (this effect can't await), but a failure here means the optimistic
    // local override (0) and the server's still-stale streak silently
    // disagree until the next full reload — at least log it.
    supabase.rpc('refresh_stats', { p_local_date: todayKey }).then(({ error }) => {
      if (error) console.error('[grind] refresh_stats failed (stale streak correction)', error)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.current_streak, stats?.last_workout_date, gapUncoveredDates, gapEligibleForPrompt, restBannerDismissedSig])
  const currentStreak = streakOverride ?? stats?.current_streak ?? 0

  async function confirmRestBanner() {
    if (restBannerBusy) return
    setRestBannerBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const rows = gapUncoveredDates.map(rest_date => ({ user_id: user.id, rest_date }))
      const { error } = await supabase.from('user_rest_dates').insert(rows)
      if (error) throw error
      await supabase.rpc('refresh_stats', { p_local_date: todayKey })
      restDismissStore.dismiss(restBannerSig)
      toast.show('Streak saved')
      markAppDataStale('/home')
      router.refresh()
    } catch (err) {
      flashToast(restBudgetError(err) ? 'No rest days left this week' : 'Could not save. Try again.')
    } finally {
      setRestBannerBusy(false)
    }
  }

  function declineRestBanner() {
    restDismissStore.dismiss(restBannerSig)
    correctedStaleStreak.current = true
    setStreakOverride(0)
    markAppDataStale('/home')
    supabase.rpc('refresh_stats', { p_local_date: todayKey }).then(({ error }) => {
      if (error) console.error('[grind] refresh_stats failed (decline rest banner)', error)
    })
  }

  async function drainRestToggles() {
    if (restFlushing.current) return
    restFlushing.current = true
    setRestTodayBusy(true)
    try {
      while (pendingRestToggles.current > 0) {
        pendingRestToggles.current -= 1
        const { error } = await supabase.rpc('toggle_rest_today', { p_local_date: todayKey })
        if (error) throw error
      }
      toast.show(restTodayOnRef.current ? 'Rest day' : 'Rest day undone')
      markAppDataStale('/home')
      router.refresh()
    } catch (err) {
      pendingRestToggles.current = 0
      setRestDatesOverride(null)
      reportError(err, { operation: 'toggle_rest_today', route: '/home' })
      toast.show(
        restBudgetError(err) ? 'No rest days left this week' : 'Could not save. Try again.',
        'error',
      )
      markAppDataStale('/home')
      router.refresh()
    } finally {
      restFlushing.current = false
      setRestTodayBusy(false)
      if (pendingRestToggles.current > 0) void drainRestToggles()
    }
  }

  function handleToggleRestToday() {
    if (skipState.todayIsScheduled && !restTodayOnRef.current) return
    if (!restTodayOnRef.current && !skipState.canSkip) {
      setRestStreakWarn(on => !on)
      return
    }
    setRestStreakWarn(false)
    const turningOn = !restTodayOnRef.current
    restTodayOnRef.current = turningOn
    const current = restDatesRef.current
    const nextDates = turningOn
      ? (current.includes(todayKey) ? current : [...current, todayKey])
      : current.filter(d => d !== todayKey)
    restDatesRef.current = nextDates
    setRestDatesOverride(nextDates)
    pendingRestToggles.current += 1
    void drainRestToggles()
  }

  // ── Active-session controls (resume / save / discard) ──────────────────────
  // Surface EVERY in-progress session — today's and prior-day orphans. Multiple
  // day-types can be open at once; hiding all but the newest left orphans
  // unreachable from Home.
  function sessionIsToday(startedAt: string): boolean {
    const started = new Date(startedAt)
    started.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return started.getTime() === today.getTime()
  }

  // Defer resume chrome to after mount so local-clock "today?" labels don't
  // disagree across the SSR/client hydration boundary.
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])
  const showResume = activeSessions.length > 0 && mounted
  // Hide start/welcome CTAs whenever an open session exists (even before mount).
  const noActiveForUi = activeSessions.length === 0

  const [busySessionId, setBusySessionId] = useState<string | null>(null)
  const busySessionIdRef = useRef<string | null>(null)
  const [discardConfirmId, setDiscardConfirmId] = useState<string | null>(null)
  const [actionToast, setActionToast] = useState<string | null>(null)
  const actionToastExit = useExitingValue(actionToast, TOAST_SLIDE_OUT_MS)
  const actionToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [skippingDay, setSkippingDay] = useState(false)
  const skippingDayRef = useRef(false)

  function flashToast(msg: string) {
    setActionToast(msg)
    if (actionToastTimer.current) clearTimeout(actionToastTimer.current)
    actionToastTimer.current = setTimeout(() => setActionToast(null), 4000)
  }

  useEffect(() => () => {
    if (actionToastTimer.current) clearTimeout(actionToastTimer.current)
  }, [])

  function handleResume(session: ActiveSession) {
    router.push(`/log?day=${session.day_type}`)
  }

  // Quick-save from the dashboard. Same authoritative finish path as
  // ActiveWorkout, without the celebratory modal — still writes the 10-minute
  // undo token for FinishUndoBanner.
  async function handleSaveActive(session: ActiveSession) {
    if (busySessionIdRef.current || session.loggedSets === 0) return
    busySessionIdRef.current = session.id
    setBusySessionId(session.id)
    const dayType = session.day_type
    const sessionId = session.id
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      await flushQueuedOps(sessionId, supabase)
      if (getQueuedOps(sessionId).length > 0) {
        flashToast('Still syncing sets — check your connection and try again.')
        return
      }

      const { data, error } = await supabase.rpc('complete_session', {
        p_session_id: sessionId,
        p_local_date: localDateKey(new Date()),
        p_note: null,
        p_start_hour: new Date(session.started_at).getHours(),
      })
      if (error || !data) throw error ?? new Error('Save failed')
      const result = data as CompleteSessionResult

      let prevRotationIndex = -1
      try {
        const [{ data: dayTypeRows }, { data: rotationRow }, { data: flexRows }] = await Promise.all([
          supabase.from('exercises').select('day_type'),
          supabase.from('user_rotation').select('*').eq('user_id', user.id).maybeSingle(),
          supabase.from('user_flex_days').select('day_key').eq('user_id', user.id),
        ])
        const dayKeys = Array.from(new Set((dayTypeRows ?? []).map(r => r.day_type)))
        const rot = rotationRow as UserRotation | null
        prevRotationIndex = rot?.current_index ?? -1
        const flex = new Set((flexRows ?? []).map((r: { day_key: string }) => r.day_key))
        const seq = effectiveSequence(rot, dayKeys, flex)
        const newIndex = advanceIndex(seq, rot?.current_index ?? -1, dayType)
        await supabase.from('user_rotation').upsert(
          {
            user_id: user.id,
            mode: rot?.mode ?? 'auto',
            sequence: rot?.sequence ?? [],
            current_index: newIndex,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        )
      } catch { /* non-critical */ }

      writeFinishUndoToken({
        sessionId,
        day: dayType,
        userId: user.id,
        xpEarned: result.xp_earned ?? 0,
        prevRotationIndex,
        expiresAt: Date.now() + FINISH_UNDO_TTL_MS,
      })

      try {
        await checkAndAwardBadges(
          supabase,
          user.id,
          {
            user_id: user.id,
            xp_total: result.xp_total,
            level: result.level,
            current_streak: result.current_streak,
            longest_streak: result.longest_streak,
            last_workout_date: result.last_workout_date,
            total_workouts: result.total_workouts,
            updated_at: new Date().toISOString(),
          } as UserStats,
        )
      } catch { /* non-critical */ }

      setDiscardConfirmId(null)
      flashToast('Workout saved')
      markAppDataStale('/home')
      router.refresh()
    } catch {
      flashToast('Could not save workout. Check your connection and try again.')
    } finally {
      busySessionIdRef.current = null
      setBusySessionId(null)
    }
  }

  async function handleExitActive(session: ActiveSession) {
    if (busySessionIdRef.current) return
    busySessionIdRef.current = session.id
    setBusySessionId(session.id)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const result = await deleteIncompleteSessions(supabase, user.id, session.day_type)
      if (!result.ok) throw new Error(result.error)
      clearQueuedOpsForSession(session.id)
      setDiscardConfirmId(null)
      flashToast('Workout discarded')
      markAppDataStale('/home')
      router.refresh()
    } catch {
      flashToast('Could not discard. Try again.')
    } finally {
      busySessionIdRef.current = null
      setBusySessionId(null)
    }
  }

  // Skip the suggested day without logging anything — advances the rotation
  // pointer exactly one slot, the same "current_index" move a completed
  // workout makes (handleSaveActive above), just without a session behind it.
  // Re-reads days/rotation/flex fresh rather than trusting the `nextDay` prop,
  // matching the save flow's own defense against a stale server-rendered prop.
  async function handleSkipDay() {
    if (!hasDays || skippingDayRef.current) return
    skippingDayRef.current = true
    setSkippingDay(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const [{ data: dayTypeRows }, { data: rotationRow }, { data: flexRows }] = await Promise.all([
        supabase.from('exercises').select('day_type'),
        supabase.from('user_rotation').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('user_flex_days').select('day_key').eq('user_id', user.id),
      ])
      const dayKeys = Array.from(new Set((dayTypeRows ?? []).map(r => r.day_type)))
      const rot = rotationRow as UserRotation | null
      const flex = new Set((flexRows ?? []).map((r: { day_key: string }) => r.day_key))
      const seq = effectiveSequence(rot, dayKeys, flex)
      if (seq.length === 0) return
      const currentIndex = rot?.current_index ?? -1
      const skipped = nextDayFromRotation(seq, currentIndex)
      if (!skipped) return
      const newIndex = advanceIndex(seq, currentIndex, skipped)
      const { error } = await supabase.from('user_rotation').upsert(
        {
          user_id: user.id,
          mode: rot?.mode ?? 'auto',
          sequence: rot?.sequence ?? [],
          current_index: newIndex,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      if (error) throw error
      flashToast(`Skipped ${dayLabel(skipped)}`)
      markAppDataStale('/home')
      router.refresh()
    } catch {
      flashToast('Could not skip. Check your connection and try again.')
    } finally {
      skippingDayRef.current = false
      setSkippingDay(false)
    }
  }

  // Bucketed from the viewer's local calendar — completedAt is local_date keys
  // (YYYY-MM-DD) from grind_home_history, not UTC timestamps.
  const weeklyWorkouts = useMemo(() => {
    const startKey = weekStart(todayKey)
    return completedAt.filter(d => {
      const key = d.includes('T') ? localDateKey(new Date(d)) : d
      return key >= startKey
    }).length
  }, [completedAt, todayKey])
  const monthlyWorkouts = useMemo(() => {
    const start = getMonthStart()
    const startKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
    return completedAt.filter(d => {
      const key = d.includes('T') ? localDateKey(new Date(d)) : d
      return key >= startKey
    }).length
  }, [completedAt])

  const exercisePreview = nextDayExercises.length <= 2
    ? nextDayExercises.join(', ')
    : `${nextDayExercises.slice(0, 2).join(', ')} +${nextDayExercises.length - 2} more`

  // Days the rotation pointer skipped past — a subtle, dismissible nudge so a day
  // you jumped over isn't lost. Computed client-side so daysSince uses the viewer's
  // timezone. The position system still picks `nextDay`; this never surfaces the
  // merely-next/earliest day, only one trained out of order and left behind.
  const overdue = totalWorkouts > 0 ? overdueDays(rotationSeq, rotationIndex, lastTrainedByDay) : []
  const overdueSig = overdue.map(d => d.dayType).join(',')

  // Dismissal is keyed to the overdue set, so hiding it sticks across reloads but
  // returns if a *different* day later gets skipped.
  const dismissedSig = useSyncExternalStore(overdueDismissStore.subscribe, overdueDismissStore.read, () => null)
  const dismissOverdue = () => overdueDismissStore.dismiss(overdueSig)
  const showOverdue = overdue.length > 0 && dismissedSig !== overdueSig
  const overdueNames = overdue.map(d => dayName(d.dayType))

  // Shared card surface — one radius (20px) and one padding (24px) across the
  // whole dashboard so every card edge aligns to the same grid.
  const card: React.CSSProperties = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '20px',
    padding: '24px',
  }

  // First-run walkthrough. Empty-state users (no workouts yet) get only the two
  // meaningful steps — the primary CTA (anchored to the welcome hero) and the
  // history calendar; level/streak/stats aren't meaningful with zero data.
  const homeSteps: TourStep[] = totalWorkouts === 0
    ? [
        { target: 'home-welcome-cta', title: 'Start a workout', body: 'Tap here to jump into your suggested next workout. GRIND rotates through your days automatically.' },
        { target: 'home-calendar', title: 'Workout history', body: "See every day you've trained, and revisit or edit past sessions." },
      ]
    : [
        { target: 'home-level', title: 'Your level', body: 'This is your level. Every completed workout and PR earns XP toward the next one.' },
        { target: 'home-streak', title: 'Your streak', body: 'Train on consecutive days to keep it going. Rest days you configure don’t break the streak.' },
        { target: 'home-cta', title: 'Start a workout', body: 'Tap here to jump into your suggested next workout. GRIND rotates through your days automatically.' },
        { target: 'home-stats', title: 'Your stats', body: 'Track your volume at a glance.' },
        { target: 'home-calendar', title: 'Workout history', body: "See every day you've trained, and revisit or edit past sessions." },
      ]
  // Don't fire over the resume/exit flow; wait for mount so the active-session
  // state is real.
  const homeTour = useTour('home', homeSteps, {
    active: mounted && noActiveForUi && !discardConfirmId,
  })

  return (
    <div className="page page--dashboard" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {homeTour}

      {/* Mobile-only wordmark — desktop carries the brand in the fixed TopNav. */}
      <h1 className="home-brand" style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: '28px',
        color: 'var(--accent-text)',
        letterSpacing: '1px',
        fontWeight: 'normal',
        paddingTop: '24px',
      }}>
        GRIND
      </h1>

      {/* First-run welcome — two honest states. A brand-new user with no plan
          yet is guided to BUILD one ("set up your first day"); a user who has
          days but hasn't trained is invited to START their first session. The
          hero is the single primary action for a zero-workout user, so the
          duplicate CTA + streak button below are suppressed while it shows.
          Yields entirely to the resume block when a workout is mid-flight — a
          user picking up an interrupted session isn't "brand new" anymore. */}
      {totalWorkouts === 0 && noActiveForUi && (
        <div
          style={{
            ...card,
            padding: '36px 24px',
            marginBottom: '24px',
            marginTop: '16px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            alignItems: 'center',
          }}
        >
          <span style={{
            width: '72px',
            height: '72px',
            borderRadius: '9999px',
            backgroundColor: 'var(--accent-wash)',
            color: 'var(--accent-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <DayIcon kind="default" size={34} />
          </span>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '28px',
              color: 'var(--text-primary)',
              letterSpacing: '1px',
              fontWeight: 'normal',
              lineHeight: 1,
            }}
          >
            WELCOME TO GRIND
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', maxWidth: '300px', lineHeight: 1.45 }}>
            {hasDays
              ? "Your plan's ready. Log your first session to start your streak."
              : "Let's build your first workout. Create a day, add your exercises, and you're ready to train."}
          </p>
          <button
            data-onboard="home-welcome-cta"
            data-haptic="medium"
            onClick={() => router.push(hasDays ? `/log?day=${nextDay}` : '/log?new=1')}
            style={{
              position: 'relative',
              marginTop: '4px',
              height: '48px',
              padding: '0 28px',
              backgroundColor: 'var(--accent)',
              color: 'var(--on-accent)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-display)',
              fontSize: '18px',
              letterSpacing: '1px',
              fontWeight: 'normal',
              cursor: 'pointer',
            }}
          >
            {hasDays ? `START ${dayLabel(nextDay)}` : 'SET UP YOUR FIRST DAY'}
          </button>
        </div>
      )}

      <div className="home-grid">
      <div className="home-col hg-left stagger-auto" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Greeting — the visual starting point of the dashboard. */}
      <div>
        <div style={{
          fontSize: '13px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          marginBottom: '10px',
        }}>
          {formatHeaderDate()}
        </div>
        <h2 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '34px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.5px',
          lineHeight: 1.1,
        }}>
          {greeting}
        </h2>
      </div>

      {/* Level + XP Card */}
      <div style={card} data-onboard="home-level">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>
              LEVEL
            </div>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '68px',
              color: 'var(--accent-text)',
              lineHeight: 1,
            }}>
              {level}
            </div>
          </div>
          <div style={{ textAlign: 'right', paddingTop: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              → LVL {level + 1}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {xpToNext} XP away
            </div>
          </div>
        </div>
        {/* XP Bar */}
        <div style={{
          width: '100%',
          height: '8px',
          backgroundColor: 'var(--border)',
          borderRadius: '9999px',
          overflow: 'hidden',
          marginBottom: '6px',
        }}>
          <div style={{
            height: '100%',
            width: `${xpPercent}%`,
            backgroundColor: 'var(--accent)',
            borderRadius: '9999px',
            transition: 'width 600ms ease',
          }} />
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {xpInLevel} / {levelSize} XP
        </div>
      </div>

      {/* Streak Card. Three states:
          • brand-new (no workouts) → a calm, non-clickable "starts here" card,
            so it doesn't compete with the welcome hero's single CTA;
          • lapsed (has history, streak reset to 0) → a clickable re-engagement
            nudge back into the next workout;
          • active → the live streak + best. */}
      {currentStreak === 0 ? (
        totalWorkouts === 0 ? (
          <div
            style={{
              ...card,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
            }}
          >
            <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              <FlameIcon size={28} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                Your streak starts here
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Finish a workout to light it up.
              </div>
            </div>
          </div>
        ) : (
        <button
          data-onboard="home-streak"
          onClick={() => router.push(hasDays ? `/log?day=${nextDay}` : '/log')}
          style={{
            ...card,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ color: 'var(--accent-text)', flexShrink: 0 }}>
            <FlameIcon size={28} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
              Start your streak today
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Consistency is the key to progress.
            </div>
          </div>
          <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}><ChevronRight /></span>
        </button>
        )
      ) : (
        <div data-onboard="home-streak" style={{
          ...card,
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FlameIcon size={28} color="var(--accent-text)" />
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '52px',
                color: 'var(--text-primary)',
                lineHeight: 1,
              }}>
                {currentStreak}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '2px' }}>
              DAY STREAK
            </div>
          </div>
          <div style={{ width: '1px', height: '48px', backgroundColor: 'var(--border)' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>
              BEST
            </div>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '36px',
              color: 'var(--text-secondary)',
              lineHeight: 1,
            }}>
              {longestStreak}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>DAYS</div>
          </div>
        </div>
      )}

      {/* Rest-day banner — offered only for a small, plausibly-a-rest-day gap
          (see gapEligibleForPrompt above); a bigger gap is just a broken
          streak and gets no prompt. Confirming marks each missed day a
          one-off rest date and resettles stats; declining treats the gap as
          genuinely broken, matching what would've happened anyway. */}
      {showRestBanner && (
        <div style={{
          ...card,
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <span style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: '1px' }} aria-hidden>
              <FlameIcon size={18} />
            </span>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Missed {gapUncoveredDates.length === 1 ? formatShortDate(gapUncoveredDates[0]) : `${gapUncoveredDates.length} days`}?
              {' '}Mark {gapUncoveredDates.length === 1 ? 'it' : 'them'} as a rest day to keep your{' '}
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{currentStreak}-day streak</span>.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={confirmRestBanner}
              disabled={restBannerBusy}
              style={{
                flex: 1, height: '38px',
                backgroundColor: 'var(--accent)',
                color: 'var(--on-accent)',
                border: 'none', borderRadius: '10px',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '13px', fontWeight: 700,
                cursor: restBannerBusy ? 'default' : 'pointer',
                opacity: restBannerBusy ? 0.7 : 1,
              }}
            >
              {restBannerBusy ? 'Saving…' : 'Yes, keep my streak'}
            </button>
            <button
              onClick={declineRestBanner}
              disabled={restBannerBusy}
              style={{
                flex: 1, height: '38px',
                backgroundColor: 'transparent',
                border: '1px solid var(--border)', borderRadius: '10px',
                color: 'var(--text-secondary)',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '13px', fontWeight: 600,
                cursor: restBannerBusy ? 'default' : 'pointer',
              }}
            >
              No, that&apos;s fine
            </button>
          </div>
        </div>
      )}

      {/* Resume blocks — one card per open session (today + overnight orphans). */}
      {showResume && activeSessions.map(session => {
        const today = sessionIsToday(session.started_at)
        const busy = busySessionId === session.id
        const confirming = discardConfirmId === session.id
        return (
        <div key={session.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
          <button
            data-haptic="medium"
            onClick={() => handleResume(session)}
            title={DAY_MUSCLES[session.day_type]}
            style={{
              position: 'relative',
              width: '100%',
              minHeight: '96px',
              padding: '0 24px',
              backgroundColor: 'var(--accent)',
              color: 'var(--on-accent)',
              border: 'none',
              borderRadius: '20px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '18px',
              transition: 'opacity 150ms ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            onMouseDown={e => (e.currentTarget.style.opacity = '0.75')}
            onMouseUp={e => (e.currentTarget.style.opacity = '0.88')}
            onTouchStart={e => (e.currentTarget.style.opacity = '0.85')}
            onTouchEnd={e => (e.currentTarget.style.opacity = '1')}
          >
            <span style={{ flexShrink: 0, display: 'flex' }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" fill="var(--on-accent)" stroke="none" />
              </svg>
            </span>
            <span style={{ flex: 1, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span style={{
                  width: '7px', height: '7px', borderRadius: '9999px',
                  backgroundColor: 'var(--on-accent)', opacity: 0.85, flexShrink: 0,
                }} />
                <span style={{
                  fontSize: '10px', fontWeight: 700, letterSpacing: '1.5px',
                  textTransform: 'uppercase', color: 'var(--on-accent)', opacity: 0.75,
                }}>
                  {today ? 'In progress' : 'Incomplete'}
                </span>
              </span>
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '28px',
                letterSpacing: '1px',
                lineHeight: 1,
              }}>
                RESUME {dayLabel(session.day_type)}
              </span>
              <span style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--on-accent)',
                opacity: 0.7,
                lineHeight: 1.2,
              }}>
                {today
                  ? (session.loggedSets > 0
                    ? `${session.loggedSets} set${session.loggedSets === 1 ? '' : 's'} logged`
                    : 'No sets logged yet')
                  : `${formatShortDate(session.started_at)}${
                      session.loggedSets > 0
                        ? ` · ${session.loggedSets} set${session.loggedSets === 1 ? '' : 's'}`
                        : ' · no sets yet'
                    }`}
              </span>
            </span>
            <span style={{ flexShrink: 0 }}><ChevronRight color="var(--on-accent)" /></span>
          </button>

          {!confirming ? (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                data-haptic="medium"
                onClick={() => handleSaveActive(session)}
                disabled={busy || session.loggedSets === 0}
                title={session.loggedSets === 0 ? 'Log a set before saving' : undefined}
                style={{
                  position: 'relative',
                  flex: 1,
                  height: '48px',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '14px',
                  color: session.loggedSets === 0 ? 'var(--text-muted)' : 'var(--accent-text)',
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: (busy || session.loggedSets === 0) ? 'default' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  transition: 'border-color 150ms ease',
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
                </svg>
                {busy && busySessionId === session.id ? 'Saving…' : 'Save workout'}
              </button>
              <button
                data-haptic="light"
                onClick={() => setDiscardConfirmId(session.id)}
                disabled={busy}
                style={{
                  position: 'relative',
                  flex: 1,
                  height: '48px',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: '14px',
                  color: 'var(--text-secondary)',
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: busy ? 'default' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                Exit without saving
              </button>
            </div>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '10px',
              padding: '14px 16px',
              backgroundColor: 'var(--surface)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '14px',
            }}>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Discard this workout? Your logged sets will be permanently deleted.
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  data-haptic="light"
                  onClick={() => setDiscardConfirmId(null)}
                  disabled={busy}
                  style={{
                    position: 'relative',
                    flex: 1, height: '44px',
                    backgroundColor: 'var(--surface-elevated)',
                    border: '1px solid var(--border)', borderRadius: '10px',
                    color: 'var(--text-primary)', fontFamily: "'DM Sans', sans-serif",
                    fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Keep
                </button>
                <button
                  data-haptic="heavy"
                  onClick={() => handleExitActive(session)}
                  disabled={busy}
                  style={{
                    position: 'relative',
                    flex: 1, height: '44px',
                    backgroundColor: 'rgba(239,68,68,0.15)',
                    border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px',
                    color: 'var(--danger)', fontFamily: "'DM Sans', sans-serif",
                    fontSize: '14px', fontWeight: 700,
                    cursor: busy ? 'default' : 'pointer',
                  }}
                >
                  {busy ? 'Discarding…' : 'Discard'}
                </button>
              </div>
            </div>
          )}
        </div>
        )
      })}

      {/* Primary CTA — start the suggested day. Hidden for a zero-workout user,
          whose single primary action is the welcome hero above, and hidden while
          a workout is in progress (the resume block owns the slot). This keeps one
          clear next step instead of competing "start" affordances. */}
      {noActiveForUi && totalWorkouts > 0 && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <button
        data-onboard="home-cta"
        data-haptic="medium"
        onClick={() => router.push(hasDays ? `/log?day=${nextDay}` : '/log')}
        title={hasDays ? DAY_MUSCLES[nextDay] : undefined}
        style={{
          position: 'relative',
          width: '100%',
          minHeight: '96px',
          padding: '0 24px',
          backgroundColor: 'var(--accent)',
          color: 'var(--on-accent)',
          border: 'none',
          borderRadius: '20px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '18px',
          transition: 'opacity 150ms ease',
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        onMouseDown={e => (e.currentTarget.style.opacity = '0.75')}
        onMouseUp={e => (e.currentTarget.style.opacity = '0.88')}
        onTouchStart={e => (e.currentTarget.style.opacity = '0.85')}
        onTouchEnd={e => (e.currentTarget.style.opacity = '1')}
      >
        <span style={{ flexShrink: 0 }}>
          <DayIcon
            dayKey={hasDays ? nextDay : undefined}
            kind={hasDays ? undefined : 'default'}
            size={32}
            color="var(--on-accent)"
          />
        </span>
        <span style={{ flex: 1, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '28px',
            letterSpacing: '1px',
            lineHeight: 1,
          }}>
            {hasDays ? `START ${dayLabel(nextDay)}` : 'CREATE YOUR FIRST DAY'}
          </span>
          <span style={{
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--on-accent)',
            opacity: 0.7,
            lineHeight: 1.2,
          }}>
            {hasDays ? exercisePreview : 'Set up your workout days to get started'}
          </span>
        </span>
        <span style={{ flexShrink: 0 }}><ChevronRight color="var(--on-accent)" /></span>
      </button>

      {/* Skip — advances the rotation pointer past today's suggested day
          without logging anything (e.g. already did legs off-app, or just
          taking a planned day off). Only meaningful with more than one day
          in the loop; a single-day rotation would just suggest itself again. */}
      {hasDays && rotationSeq.length > 1 && (
        <button
          className="press"
          data-haptic="light"
          onClick={handleSkipDay}
          disabled={skippingDay}
          style={{
            position: 'relative',
            alignSelf: 'center',
            height: '40px',
            padding: '0 14px',
            background: 'none',
            border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            cursor: skippingDay ? 'default' : 'pointer',
            color: 'var(--text-muted)',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '13px',
            fontWeight: 600,
            opacity: skippingDay ? 0.6 : 1,
          }}
          onMouseEnter={e => { if (!skippingDay) e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" />
          </svg>
          {skippingDay ? 'Skipping…' : `Skip ${dayLabel(nextDay)}`}
        </button>
      )}
      </div>
      )}

      {/* Rest today — secondary to Start. One-off skip that spends a configured
          rest-day slot this week. Tap again to undo. Scheduled weekdays
          (Settings) are shown but not undone here. Hidden until rest days
          are configured. Remaining count is always on the card; tapping with
          none left turns it red (no confirm toast) so it’s obvious the streak
          would break. */}
      {currentStreak > 0 && (skipState.budget > 0 || skipState.todayIsOneOff) && (!trainedToday || skipState.todayIsOneOff) && (
        <button
          type="button"
          className="press"
          data-haptic={restStreakWarn || (!skipState.canSkip && !skipState.todayIsRest) ? 'heavy' : 'medium'}
          onClick={() => handleToggleRestToday()}
          disabled={skipState.todayIsScheduled}
          aria-pressed={skipState.todayIsRest}
          style={{
            ...card,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            cursor: skipState.todayIsScheduled ? 'default' : 'pointer',
            opacity: restTodayBusy ? 0.7 : 1,
            backgroundColor: restStreakWarn ? 'var(--danger-bg)' : card.backgroundColor,
            borderColor: restStreakWarn
              ? 'var(--danger)'
              : skipState.todayIsRest ? 'var(--accent)' : 'var(--border)',
            transition: 'border-color 150ms ease, background-color 150ms ease',
          }}
        >
          <div style={{ textAlign: 'left' }}>
            <div style={{
              fontSize: '15px',
              fontWeight: 600,
              color: restStreakWarn ? 'var(--danger)' : 'var(--text-primary)',
            }}>
              {skipState.todayIsRest ? 'Rest day' : 'Rest today'}
            </div>
            <div style={{
              fontSize: '13px',
              color: restStreakWarn ? 'var(--danger)' : 'var(--text-secondary)',
              marginTop: '2px',
            }} aria-live={restStreakWarn ? 'polite' : undefined}>
              {skipState.todayIsOneOff
                ? 'Tap again to undo'
                : skipState.todayIsScheduled
                  ? 'Scheduled in Settings'
                  : restStreakWarn
                    ? `${restLeftThisWeekLabel(restRemaining)} — this will break your streak`
                    : restLeftThisWeekLabel(restRemaining)}
            </div>
          </div>
          {restStreakWarn ? (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--danger)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{ flexShrink: 0 }}
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          ) : (
            <div
              aria-hidden
              style={{
                width: '22px',
                height: '22px',
                borderRadius: '9999px',
                border: `2px solid ${skipState.todayIsRest ? 'var(--accent)' : 'var(--border-strong)'}`,
                backgroundColor: skipState.todayIsRest ? 'var(--accent)' : 'transparent',
                flexShrink: 0,
              }}
            />
          )}
        </button>
      )}

      {/* Overdue nudge — a slim, dismissible line that surfaces a day the rotation
          skipped past (trained out of order and left behind), so you don't have to
          scan the calendar. Tap to start it; × hides it until a new day is skipped. */}
      {showOverdue && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 12px',
          borderRadius: '12px',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
        }}>
          <span style={{ color: 'var(--danger)', flexShrink: 0, display: 'flex' }} aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <button
            onClick={() => router.push(`/log?day=${overdue[0].dayType}`)}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'none',
              border: 'none',
              padding: 0,
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: 1.3,
            }}
          >
            You&apos;re overdue for{' '}
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {overdueNames.join(', ')}
            </span>
            {overdue[0].daysSince !== null && overdueNames.length === 1 && (
              <span style={{ color: 'var(--text-muted)' }}> · {overdue[0].daysSince}d ago</span>
            )}
          </button>
          <button
            onClick={dismissOverdue}
            aria-label="Dismiss"
            style={{
              flexShrink: 0,
              background: 'none',
              border: 'none',
              // ~32px touch target without growing the row's visual height.
              padding: '8px',
              margin: '-6px -4px',
              borderRadius: '8px',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              transition: 'color 150ms ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      </div>{/* end left column */}

      {/* Last Workout — full-width band beneath both columns on desktop */}
      <div className="hg-last">
        <div style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          marginBottom: '12px',
        }}>
          LAST WORKOUT
        </div>

        {!lastSession ? (
          <div style={{
            ...card,
            color: 'var(--text-muted)',
            fontSize: '14px',
            textAlign: 'center',
          }}>
            No workouts logged yet. Hit that first session!
          </div>
        ) : (
          <div className="lw-card" style={{
            backgroundColor: 'var(--surface)',
            borderRadius: '20px',
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}>
            <div className="lw-main">
            <div className="lw-header" style={{
              padding: '18px 24px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '14px',
            }}>
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '18px',
                color: 'var(--text-primary)',
              }}>
                {dayLabel(lastSession.day_type)}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {formatShortDate(
                    (lastSession as { local_date?: string | null }).local_date
                      ?? lastSession.completed_at!,
                  )}
                </span>
                <button
                  data-haptic="light"
                  className="press"
                  onClick={() => {
                    const date =
                      (lastSession as { local_date?: string | null }).local_date
                      ?? localDateKey(new Date(lastSession.completed_at!))
                    router.push(`/log/past?date=${date}`)
                  }}
                  title="Edit or delete this workout"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '4px 9px',
                    minHeight: '44px',
                    color: 'var(--text-secondary)',
                    fontSize: '11px',
                    fontFamily: "'Bebas Neue', sans-serif",
                    letterSpacing: '0.5px',
                    cursor: 'pointer',
                    transition: 'color 150ms ease, border-color 150ms ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.color = 'var(--text-primary)'
                    e.currentTarget.style.borderColor = 'var(--border-strong)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.color = 'var(--text-secondary)'
                    e.currentTarget.style.borderColor = 'var(--border)'
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  EDIT
                </button>
              </div>
            </div>
            <div style={{ padding: '12px 0' }}>
              {lastSessionLogs.map((log, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '9px 24px',
                  }}
                >
                  <span style={{ fontSize: '14px', color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.exercise_name}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '14px',
                    color: log.weight !== null ? 'var(--accent-text)' : 'var(--text-muted)',
                    textAlign: 'right',
                    minWidth: '78px',
                  }}>
                    {log.weight !== null ? `${fmt(log.weight)} ${unitLabel}` : '—'}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '13px',
                    color: 'var(--text-muted)',
                    textAlign: 'right',
                    minWidth: '54px',
                  }}>
                    {log.sets > 0 && log.reps !== null ? `${log.sets} × ${log.reps}` : ''}
                  </span>
                </div>
              ))}
            </div>
            </div>{/* end lw-main */}
            {/* Notes panel — always rendered on desktop so the card keeps its
                two-region balance; falls back to a muted placeholder, and stays
                hidden on mobile when there's nothing to show. */}
            <div className={`lw-notes${lastSession.note ? '' : ' lw-notes--empty'}`} style={{ padding: '20px 24px' }}>
              <div style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '4px',
              }}>
                NOTES
              </div>
              <div style={{
                fontSize: '13px',
                color: lastSession.note ? 'var(--text-secondary)' : 'var(--text-muted)',
                fontStyle: lastSession.note ? 'normal' : 'italic',
                lineHeight: 1.4,
              }}>
                {lastSession.note || 'No notes for this session.'}
              </div>
            </div>
          </div>
        )}
      </div>{/* end last-workout band */}

      <div className="home-col hg-right stagger-auto" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Stats Row — three equal-width, equal-height cards. */}
      <div data-onboard="home-stats" style={{ display: 'flex', gap: '20px', alignItems: 'stretch' }}>
        {[
          { value: weeklyWorkouts, label: 'WORKOUTS', sub: 'This Week' },
          { value: monthlyWorkouts, label: 'WORKOUTS', sub: 'This Month' },
          { value: totalPRs, label: 'TOTAL PRS', sub: 'All Time' },
        ].map((stat, i) => (
          <div
            key={i}
            style={{
              ...card,
              flex: 1,
              padding: '22px 12px',
              textAlign: 'center',
            }}
          >
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '52px',
              color: 'var(--text-primary)',
              lineHeight: 1,
              marginBottom: '8px',
            }}>
              {stat.value}
            </div>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              fontWeight: 600,
            }}>
              {stat.label}
            </div>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              marginTop: '2px',
            }}>
              {stat.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Workout History Calendar — the dominant element of the right column.
          flex-fills so the card bottom aligns with the left column's CTA. */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          marginBottom: '12px',
        }}>
          WORKOUT HISTORY
        </div>
        <div style={{ flex: 1, minHeight: 0 }} data-onboard="home-calendar">
          <WorkoutCalendar />
        </div>
      </div>

      </div>{/* end right column */}
      </div>{/* end home-grid */}

      {/* Passive confirmation for the resume-block actions (save / discard). */}
      {actionToastExit.data && (
        <ToastPill
          key={actionToastExit.data}
          edge="bottom"
          exiting={actionToastExit.closing}
          role="status"
          style={{
            bottom: 'calc(84px + env(safe-area-inset-bottom))',
            zIndex: 60,
            maxWidth: 'calc(100% - 32px)',
            padding: '11px 18px',
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: '9999px',
            color: 'var(--text-primary)',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '13px',
            fontWeight: 600,
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          {actionToastExit.data}
        </ToastPill>
      )}

      <FinishUndoBanner />

    </div>
  )
}
