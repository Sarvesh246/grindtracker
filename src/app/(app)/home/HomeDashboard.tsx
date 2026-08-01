'use client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Session, UserStats, UserRotation, CompleteSessionResult } from '@/lib/types'
import { getLevel, getXpInCurrentLevel, getXpRequiredForLevel, getXpToNextLevel } from '@/lib/utils/gamification'
import { formatHeaderDate, formatShortDate, localDateKey } from '@/lib/utils/formatting'
import { advanceIndex, effectiveSequence, overdueDays } from '@/lib/utils/rotation'
import { deleteIncompleteSessions } from '@/lib/utils/sessions'
import { checkAndAwardBadges } from '@/lib/utils/badges'
import WorkoutCalendar from '@/components/WorkoutCalendar'
import { useUnit } from '@/lib/contexts/UnitContext'
import { useTour, type TourStep } from '@/components/onboarding/Tour'

// "This week"/"this month" start in the VIEWER's local timezone — computed here
// (client) rather than on the server, whose clock/timezone is very often not
// the viewer's and would bucket a workout into the wrong week/month right
// around the boundary. Same reasoning as `overdueDays`, computed client-side below.
function getWeekStart(): Date {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) // Monday
  const monday = new Date(now)
  monday.setDate(diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}
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

function subscribeDismiss(cb: () => void): () => void {
  window.addEventListener('storage', cb)
  window.addEventListener(OVERDUE_DISMISS_EVENT, cb)
  return () => {
    window.removeEventListener('storage', cb)
    window.removeEventListener(OVERDUE_DISMISS_EVENT, cb)
  }
}
function readDismissedSig(): string | null {
  try { return localStorage.getItem(OVERDUE_DISMISS_KEY) } catch { return null }
}

interface ActiveSession {
  id: string
  day_type: string
  started_at: string
  loggedSets: number
}

interface Props {
  stats: UserStats | null
  activeSession: ActiveSession | null
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

// A small dumbbell/barbell glyph, reused for the welcome state and the CTA.
function BarbellIcon({ size = 24, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="12" x2="18" y2="12" />
      <rect x="2" y="9" width="4" height="6" rx="1.5" />
      <rect x="18" y="9" width="4" height="6" rx="1.5" />
    </svg>
  )
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
  activeSession,
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
}: Props) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { unitLabel, fmt } = useUnit()

  const xpTotal = stats?.xp_total ?? 0
  const level = getLevel(xpTotal)
  const xpInLevel = getXpInCurrentLevel(xpTotal)
  const levelSize = getXpRequiredForLevel(level)
  const xpToNext = getXpToNextLevel(xpTotal)
  const xpPercent = (xpInLevel / levelSize) * 100
  const longestStreak = stats?.longest_streak ?? 0
  const totalWorkouts = stats?.total_workouts ?? 0

  // Stale-streak reset, using the viewer's own local "today" (a server component
  // would otherwise use the server's clock/timezone — see getWeekStart/getMonthStart
  // above for the same reasoning). If the last workout is more than 1 local day
  // ago, the streak is broken: reflect that immediately and persist the zero once.
  const [streakOverride, setStreakOverride] = useState<number | null>(null)
  const correctedStaleStreak = useRef(false)
  useEffect(() => {
    if (correctedStaleStreak.current) return
    if (!stats || stats.current_streak <= 0 || !stats.last_workout_date) return
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const lastDate = new Date(stats.last_workout_date + 'T12:00:00')
    lastDate.setHours(0, 0, 0, 0)
    const diffDays = Math.round((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays > 1) {
      correctedStaleStreak.current = true
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStreakOverride(0)
      // The client can no longer write user_stats directly. `refresh_stats`
      // re-derives everything server-side; passing our local date is what lets
      // Postgres decide the streak has lapsed in the *user's* timezone rather
      // than UTC (see CLAUDE.md → Dates & timezones).
      supabase.rpc('refresh_stats', { p_local_date: localDateKey(new Date()) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.current_streak, stats?.last_workout_date])
  const currentStreak = streakOverride ?? stats?.current_streak ?? 0

  // ── Active-session controls (resume / save / discard) ──────────────────────
  // Only surface the in-progress session when it was started on the viewer's
  // local calendar day — the same window ActiveWorkout will actually resume into
  // (its lookup is bounded to today's `started_at`), so tapping Resume continues
  // this session rather than forking a fresh one. A stale prior-day session is
  // left alone, exactly as the rest of the app already treats it.
  const activeIsToday = useMemo(() => {
    if (!activeSession) return false
    const started = new Date(activeSession.started_at)
    started.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return started.getTime() === today.getTime()
  }, [activeSession])

  // The "is it today?" test reads the local clock, which is UTC on the server and
  // the viewer's zone in the browser — so it can disagree across the hydration
  // boundary. Defer the decision to after mount: SSR and the first client render
  // both see `mounted === false` (identical output, no mismatch), then the client
  // resolves it. A present-but-not-today session is treated as "no active session"
  // (a stale prior-day orphan), falling back to the normal start CTA / welcome.
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])
  const showResume = !!activeSession && mounted && activeIsToday
  const noActiveForUi = !activeSession || (mounted && !activeIsToday)

  const [savingActive, setSavingActive] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [exitConfirm, setExitConfirm] = useState(false)
  const [actionToast, setActionToast] = useState<string | null>(null)

  function flashToast(msg: string) {
    setActionToast(msg)
    setTimeout(() => setActionToast(null), 4000)
  }

  function handleResume() {
    if (!activeSession) return
    router.push(`/log?day=${activeSession.day_type}`)
  }

  // Quick-save from the dashboard. This is the same authoritative finish path as
  // ActiveWorkout — `complete_session` derives XP/streak/PRs server-side — plus
  // the two best-effort follow-ups a live finish also does (advance the rotation
  // pointer, award badges). It deliberately skips the celebratory modal and the
  // 10-minute undo token: this is the "just bank it" path. A completed workout
  // is still reversible from Log → past if needed.
  async function handleSaveActive() {
    if (!activeSession || savingActive) return
    // Never complete an empty session — that would mint the +100 completion XP
    // for no work. The button is disabled in this state; this is the backstop.
    if (activeSession.loggedSets === 0) return
    setSavingActive(true)
    const dayType = activeSession.day_type
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data, error } = await supabase.rpc('complete_session', {
        p_session_id: activeSession.id,
        p_local_date: localDateKey(new Date()),
        p_note: null,
      })
      if (error || !data) throw error ?? new Error('Save failed')
      const result = data as CompleteSessionResult

      // Advance the rotation so the next suggested day moves past this one.
      // Best-effort — a rotation hiccup must never make a saved workout look failed.
      try {
        const [{ data: dayTypeRows }, { data: rotationRow }, { data: flexRows }] = await Promise.all([
          supabase.from('exercises').select('day_type'),
          supabase.from('user_rotation').select('*').eq('user_id', user.id).maybeSingle(),
          supabase.from('user_flex_days').select('day_key').eq('user_id', user.id),
        ])
        const dayKeys = Array.from(new Set((dayTypeRows ?? []).map(r => r.day_type)))
        const rot = rotationRow as UserRotation | null
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

      // Award any badges this completion unlocked (e.g. first_workout). Best-effort.
      try {
        await checkAndAwardBadges(supabase, user.id, {
          user_id: user.id,
          xp_total: result.xp_total,
          level: result.level,
          current_streak: result.current_streak,
          longest_streak: result.longest_streak,
          last_workout_date: result.last_workout_date,
          total_workouts: result.total_workouts,
          updated_at: new Date().toISOString(),
        } as UserStats)
      } catch { /* non-critical */ }

      flashToast(result.xp_earned ? `Workout saved · +${result.xp_earned} XP` : 'Workout saved')
      router.refresh()
    } catch {
      flashToast('Could not save workout. Check your connection and try again.')
    } finally {
      setSavingActive(false)
    }
  }

  async function handleExitActive() {
    if (!activeSession || exiting) return
    setExiting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const result = await deleteIncompleteSessions(supabase, user.id, activeSession.day_type)
      if (!result.ok) throw new Error(result.error)
      setExitConfirm(false)
      flashToast('Workout discarded')
      router.refresh()
    } catch {
      flashToast('Could not discard. Try again.')
    } finally {
      setExiting(false)
    }
  }

  // Bucketed from the viewer's local time — see getWeekStart/getMonthStart above.
  const weeklyWorkouts = useMemo(() => {
    const start = getWeekStart().getTime()
    return completedAt.filter(iso => new Date(iso).getTime() >= start).length
  }, [completedAt])
  const monthlyWorkouts = useMemo(() => {
    const start = getMonthStart().getTime()
    return completedAt.filter(iso => new Date(iso).getTime() >= start).length
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
  const dismissedSig = useSyncExternalStore(subscribeDismiss, readDismissedSig, () => null)
  const dismissOverdue = () => {
    try { localStorage.setItem(OVERDUE_DISMISS_KEY, overdueSig) } catch {}
    window.dispatchEvent(new Event(OVERDUE_DISMISS_EVENT))
  }
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
        { target: 'home-streak', title: 'Your streak', body: 'Keep your streak alive by training on consecutive days — miss a day and it resets.' },
        { target: 'home-cta', title: 'Start a workout', body: 'Tap here to jump into your suggested next workout. GRIND rotates through your days automatically.' },
        { target: 'home-stats', title: 'Your stats', body: 'Track your volume at a glance.' },
        { target: 'home-calendar', title: 'Workout history', body: "See every day you've trained, and revisit or edit past sessions." },
      ]
  // Don't fire over the resume/exit flow; wait for mount so the active-session
  // state is real. This is the first coach mark a user ever sees, so it also
  // offers "Skip all tours".
  const homeTour = useTour('home', homeSteps, {
    active: mounted && noActiveForUi && !exitConfirm,
    firstEver: true,
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
            <BarbellIcon size={34} />
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
            onClick={() => router.push(hasDays ? `/log?day=${nextDay}` : '/log?new=1')}
            style={{
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
      <div className="home-col hg-left" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

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
          Let&apos;s get after it, {firstName}.
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
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z"/><path d="M12 12c0 2-1.5 3-1.5 4.5a1.5 1.5 0 0 0 3 0C13.5 15 12 14 12 12z"/>
              </svg>
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
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z"/><path d="M12 12c0 2-1.5 3-1.5 4.5a1.5 1.5 0 0 0 3 0C13.5 15 12 14 12 12z"/>
            </svg>
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
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
                <path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z"/><path d="M12 12c0 2-1.5 3-1.5 4.5a1.5 1.5 0 0 0 3 0C13.5 15 12 14 12 12z"/>
              </svg>
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

      {/* Resume block — takes the primary-action slot whenever a workout is in
          progress today. One tap continues it; below, a quick Save banks it (same
          server-authoritative finish as ActiveWorkout) and Exit discards it, each
          without having to re-enter the session first. */}
      {showResume && activeSession && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={handleResume}
            title={DAY_MUSCLES[activeSession.day_type]}
            style={{
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
                  In progress
                </span>
              </span>
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '28px',
                letterSpacing: '1px',
                lineHeight: 1,
              }}>
                RESUME {dayLabel(activeSession.day_type)}
              </span>
              <span style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--on-accent)',
                opacity: 0.7,
                lineHeight: 1.2,
              }}>
                {activeSession.loggedSets > 0
                  ? `${activeSession.loggedSets} set${activeSession.loggedSets === 1 ? '' : 's'} logged`
                  : 'No sets logged yet'}
              </span>
            </span>
            <span style={{ flexShrink: 0 }}><ChevronRight color="var(--on-accent)" /></span>
          </button>

          {/* Save / Exit row — collapses into a discard confirmation when Exit is
              tapped, so a logged workout can't be thrown away on a single mis-tap. */}
          {!exitConfirm ? (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={handleSaveActive}
                disabled={savingActive || exiting || activeSession.loggedSets === 0}
                title={activeSession.loggedSets === 0 ? 'Log a set before saving' : undefined}
                style={{
                  flex: 1,
                  height: '48px',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '14px',
                  color: activeSession.loggedSets === 0 ? 'var(--text-muted)' : 'var(--accent-text)',
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: (savingActive || exiting || activeSession.loggedSets === 0) ? 'default' : 'pointer',
                  opacity: (savingActive || exiting) ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  transition: 'border-color 150ms ease',
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
                </svg>
                {savingActive ? 'Saving…' : 'Save workout'}
              </button>
              <button
                onClick={() => setExitConfirm(true)}
                disabled={savingActive || exiting}
                style={{
                  flex: 1,
                  height: '48px',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: '14px',
                  color: 'var(--text-secondary)',
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: (savingActive || exiting) ? 'default' : 'pointer',
                  opacity: (savingActive || exiting) ? 0.6 : 1,
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
                  onClick={() => setExitConfirm(false)}
                  disabled={exiting}
                  style={{
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
                  onClick={handleExitActive}
                  disabled={exiting}
                  style={{
                    flex: 1, height: '44px',
                    backgroundColor: 'rgba(239,68,68,0.15)',
                    border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px',
                    color: 'var(--danger)', fontFamily: "'DM Sans', sans-serif",
                    fontSize: '14px', fontWeight: 700,
                    cursor: exiting ? 'default' : 'pointer',
                  }}
                >
                  {exiting ? 'Discarding…' : 'Discard'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Primary CTA — start the suggested day. Hidden for a zero-workout user,
          whose single primary action is the welcome hero above, and hidden while
          a workout is in progress (the resume block owns the slot). This keeps one
          clear next step instead of competing "start" affordances. */}
      {noActiveForUi && totalWorkouts > 0 && (
      <button
        data-onboard="home-cta"
        onClick={() => router.push(hasDays ? `/log?day=${nextDay}` : '/log')}
        title={hasDays ? DAY_MUSCLES[nextDay] : undefined}
        style={{
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
        <span style={{ flexShrink: 0 }}><BarbellIcon size={32} color="var(--on-accent)" /></span>
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
                  {formatShortDate(lastSession.completed_at!)}
                </span>
                <button
                  onClick={() => router.push(`/log/past?date=${localDateKey(new Date(lastSession.completed_at!))}`)}
                  title="Edit or delete this workout"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '4px 9px',
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

      <div className="home-col hg-right" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

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
      {actionToast && (
        <div
          role="status"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 'calc(84px + env(safe-area-inset-bottom))',
            transform: 'translateX(-50%)',
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
          }}
        >
          {actionToast}
        </div>
      )}

    </div>
  )
}
