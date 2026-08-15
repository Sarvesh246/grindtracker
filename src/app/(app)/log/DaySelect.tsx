'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from '@/lib/contexts/ThemeContext'
import { Exercise, type DayCategory, UserRotation, CompleteSessionResult, UserStats } from '@/lib/types'
import {
  NAMED_DAY_COLORS,
  categoryColorKey,
  mapDayColorRows,
  onDayFill,
  resolveDayColor,
  resolveDayTextColor,
} from '@/lib/utils/dayColors'
import { effectiveSequence, nextDay as nextDayFromRotation, orderedDayKeys, advanceIndex } from '@/lib/utils/rotation'
import { deleteIncompleteSessions } from '@/lib/utils/sessions'
import { flushQueuedOps, getQueuedOps, clearQueuedOpsForSession } from '@/lib/utils/offlineQueue'
import { checkAndAwardBadges } from '@/lib/utils/badges'
import { formatShortDate, localDateKey } from '@/lib/utils/formatting'
import {
  FINISH_UNDO_TTL_MS,
  writeFinishUndoToken,
} from '@/lib/utils/finishUndo'
import WorkoutManager from './WorkoutManager'
import FinishUndoBanner from '@/components/FinishUndoBanner'
import DayIcon from '@/components/DayIcon'
import ToastPill, { TOAST_SLIDE_OUT_MS } from '@/components/ToastPill'
import { useExitingValue } from '@/lib/hooks/useExitingValue'
import { useTour, type TourStep } from '@/components/onboarding/Tour'
import { CACHE_KEYS, markAppDataStale } from '@/lib/cache/appDataCache'
import { useCachedQuery } from '@/lib/cache/useCachedQuery'

type OpenSession = {
  id: string
  day_type: string
  started_at: string
  loggedSets: number
}

function dayLabel(key: string): string {
  return key.replace(/-/g, ' ').toUpperCase()
}

function isStartedToday(startedAt: string): boolean {
  const started = new Date(startedAt)
  started.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return started.getTime() === today.getTime()
}

/** Resolve leaderboard category for a day key (custom days via user_day_categories). */
function categoryForDay(dayKey: string, categories: Record<string, DayCategory>): string {
  return categoryColorKey(dayKey, categories)
}

type LogCatalog = {
  exercises: Exercise[]
  rotation: UserRotation | null
  flexDays: string[]
  dayCategories: Record<string, DayCategory>
  dayColors: Record<string, string>
  openSessions: OpenSession[]
}

export default function DaySelect() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const [showManager, setShowManager] = useState(false)
  // When true, the manager opens straight into the "new day" form — used by the
  // blank-slate hero and the `?new=1` deep link from Home, so "create a day" is
  // a single tap rather than a hunt for the gear icon.
  const [managerNewDay, setManagerNewDay] = useState(false)

  const openCreateDay = useCallback(() => {
    setManagerNewDay(true)
    setShowManager(true)
  }, [])

  const closeManager = useCallback(() => {
    setShowManager(false)
    setManagerNewDay(false)
  }, [])

  // Deep link from the first-run CTAs (`/log?new=1`) opens the create-day form
  // once, then strips the param so a refresh or back-nav doesn't reopen it.
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpened.current) return
    if (searchParams.get('new')) {
      autoOpened.current = true
      // Syncing a one-shot URL intent into local state on mount — the same
      // "read from an external system once" case the login page handles this way.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      openCreateDay()
      router.replace('/log')
    }
  }, [searchParams, router, openCreateDay])

  const { data: catalog, loading, error, refetch } = useCachedQuery<LogCatalog>(
    CACHE_KEYS.logCatalog,
    async () => {
      const { data: { user } } = await supabase.auth.getUser()
      const [exRes, rotRes, flexRes, catRes, colorRes, openRes] = await Promise.all([
        supabase.from('exercises').select('*')
          .order('day_type', { ascending: true })
          .order('sort_order', { ascending: true }),
        user
          ? supabase.from('user_rotation').select('*').eq('user_id', user.id).maybeSingle()
          : Promise.resolve({ data: null }),
        user
          ? supabase.from('user_flex_days').select('day_key').eq('user_id', user.id)
          : Promise.resolve({ data: [] as { day_key: string }[] }),
        user
          ? supabase.from('user_day_categories').select('day_key, category').eq('user_id', user.id)
          : Promise.resolve({ data: [] as { day_key: string; category: DayCategory }[] }),
        user
          ? supabase.from('user_day_colors').select('day_key, color').eq('user_id', user.id)
          : Promise.resolve({ data: [] as { day_key: string; color: string }[], error: null }),
        user
          ? supabase
              .from('sessions')
              .select('id, day_type, started_at')
              .eq('user_id', user.id)
              .is('completed_at', null)
              .order('started_at', { ascending: false })
          : Promise.resolve({ data: [] as { id: string; day_type: string; started_at: string }[] }),
      ])
      if (exRes.error) {
        console.error('[grind] failed to load exercises', exRes.error)
        throw new Error(exRes.error.message)
      }
      const catMap: Record<string, DayCategory> = {}
      for (const r of catRes.data ?? []) catMap[r.day_key] = r.category as DayCategory

      const openSessions: OpenSession[] = []
      for (const row of openRes.data ?? []) {
        const { count } = await supabase
          .from('session_logs')
          .select('id', { count: 'exact', head: true })
          .eq('session_id', row.id)
          .eq('is_skipped', false)
          .eq('is_warmup', false)
          .not('weight', 'is', null)
        openSessions.push({
          id: row.id,
          day_type: row.day_type,
          started_at: row.started_at,
          loggedSets: count ?? 0,
        })
      }

      return {
        exercises: exRes.data ?? [],
        rotation: (rotRes.data as UserRotation | null) ?? null,
        flexDays: (flexRes.data ?? []).map(r => r.day_key),
        dayCategories: catMap,
        dayColors: colorRes.error ? {} : mapDayColorRows(colorRes.data),
        openSessions,
      }
    },
  )
  const exercises = catalog?.exercises ?? []
  const rotation = catalog?.rotation ?? null
  const flexDays = useMemo(() => new Set(catalog?.flexDays ?? []), [catalog])
  const dayCategories = catalog?.dayCategories ?? {}
  const dayColors = catalog?.dayColors ?? {}
  // Set only when the exercises fetch itself fails — an existing user must
  // never see the blank-slate "SET UP YOUR FIRST DAY" hero over a transient
  // network/RLS blip; that reads as their days having vanished.
  const loadError = !!error && !catalog

  const load = useCallback(() => refetch(), [refetch])

  // Open incomplete sessions (incl. prior-day orphans) from the catalog.
  // Local override lets Save/Discard update the banner immediately; clear it
  // once a fresh catalog arrives so we don't shadow server truth forever.
  // Adjusted during render (React's blessed pattern for "reset derived state
  // when a prop/value changes") rather than in an effect, so a fresh catalog
  // can't paint through a stale override for even one frame.
  const [openSessionsOverride, setOpenSessionsOverride] = useState<OpenSession[] | null>(null)
  const [prevCatalogOpenSessions, setPrevCatalogOpenSessions] = useState(catalog?.openSessions)
  if (catalog?.openSessions !== prevCatalogOpenSessions) {
    setPrevCatalogOpenSessions(catalog?.openSessions)
    setOpenSessionsOverride(null)
  }
  const openSessions = useMemo(
    () => openSessionsOverride ?? catalog?.openSessions ?? [],
    [openSessionsOverride, catalog?.openSessions],
  )
  const [openBusyId, setOpenBusyId] = useState<string | null>(null)
  const [discardConfirmId, setDiscardConfirmId] = useState<string | null>(null)
  const [actionToast, setActionToast] = useState<string | null>(null)
  const actionToastExit = useExitingValue(actionToast, TOAST_SLIDE_OUT_MS)
  const actionToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flashToast = useCallback((msg: string) => {
    setActionToast(msg)
    if (actionToastTimer.current) clearTimeout(actionToastTimer.current)
    actionToastTimer.current = setTimeout(() => setActionToast(null), 4000)
  }, [setActionToast])

  useEffect(() => () => {
    if (actionToastTimer.current) clearTimeout(actionToastTimer.current)
  }, [])

  const openByDay = useMemo(() => {
    const map: Record<string, OpenSession> = {}
    for (const s of openSessions) map[s.day_type] = s
    return map
  }, [openSessions])

  async function handleSaveOpen(session: OpenSession) {
    if (openBusyId || session.loggedSets === 0) return
    setOpenBusyId(session.id)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      await flushQueuedOps(session.id, supabase)
      if (getQueuedOps(session.id).length > 0) {
        flashToast('Still syncing sets — check your connection and try again.')
        return
      }

      const { data, error } = await supabase.rpc('complete_session', {
        p_session_id: session.id,
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
        const newIndex = advanceIndex(seq, rot?.current_index ?? -1, session.day_type)
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
        sessionId: session.id,
        day: session.day_type,
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
      setOpenSessionsOverride(prev => (prev ?? openSessions).filter(s => s.id !== session.id))
      markAppDataStale()
      void load()
    } catch {
      flashToast('Could not save workout. Check your connection and try again.')
    } finally {
      setOpenBusyId(null)
    }
  }

  async function handleDiscardOpen(session: OpenSession) {
    if (openBusyId) return
    setOpenBusyId(session.id)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const result = await deleteIncompleteSessions(supabase, user.id, session.day_type)
      if (!result.ok) throw new Error(result.error)
      clearQueuedOpsForSession(session.id)
      setDiscardConfirmId(null)
      setOpenSessionsOverride(prev => (prev ?? openSessions).filter(s => s.id !== session.id))
      flashToast('Workout discarded')
      markAppDataStale()
      void load()
    } catch {
      flashToast('Could not discard. Try again.')
    } finally {
      setOpenBusyId(null)
    }
  }

  const grouped: Record<string, Exercise[]> = {}
  for (const ex of exercises) {
    if (!grouped[ex.day_type]) grouped[ex.day_type] = []
    grouped[ex.day_type].push(ex)
  }
  // Displayed in the user's chosen "workout order" (WorkoutManager → Edit
  // workout order), not alphabetically — a manual sequence is otherwise
  // invisible everywhere except the rotation editor itself.
  const effectiveSeq = effectiveSequence(rotation, Object.keys(grouped), flexDays)
  const dayKeys = orderedDayKeys(Object.keys(grouped), effectiveSeq)

  // Non-binding hint: the day the rotation suggests next (flex days excluded).
  const upNext = nextDayFromRotation(effectiveSeq, rotation?.current_index ?? -1)

  // Color keys for DaySelect cards = leaderboard categories (not raw day_keys),
  // so a custom "chest" day mapped to push gets lime like the calendar's push.
  const colorKeys = dayKeys.map(k => categoryForDay(k, dayCategories))
  const extraTypes = [...new Set(colorKeys.filter(t => !NAMED_DAY_COLORS[t]))]

  // Walkthrough only applies once the user actually has days (the MANAGE button
  // and "log a past workout" link that steps 2/3 point at don't exist on the
  // blank slate). Paused while the manager sheet is open.
  const daySteps: TourStep[] = [
    { target: 'dayselect-days', title: 'Pick a day', body: 'Tap a day to start logging. UP NEXT highlights what GRIND suggests based on your rotation.' },
    { target: 'dayselect-manage', title: 'Manage days', body: 'Add, edit, reorder, or mark a day as flex (skip the rotation — do it whenever) here.' },
    { target: 'dayselect-past', title: 'Log a past workout', body: 'Forgot to log a session live? Add it retroactively here.' },
  ]
  const dayTour = useTour('log-dayselect', daySteps, {
    active: !loading && dayKeys.length > 0 && !showManager,
  })

  return (
    <>
      {dayTour}
      <div className="page page--wide" style={{ padding: '24px 16px', fontFamily: "'DM Sans', sans-serif" }}>
        {/* Header row — hidden on the blank slate so the setup hero owns the
            screen (there's nothing to "choose" yet, and the hero carries its own
            create button, so the gear would just be visual noise). */}
        {(loading || dayKeys.length > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h1 style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '32px',
            color: 'var(--text-primary)',
            letterSpacing: '1px',
            margin: 0,
          }}>
            CHOOSE YOUR DAY
          </h1>
          <button
            data-onboard="dayselect-manage"
            onClick={() => setShowManager(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '8px 12px',
              cursor: 'pointer',
              transition: 'border-color 150ms ease',
              flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
              MANAGE
            </span>
          </button>
        </div>
        )}

        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading...</div>
        ) : loadError ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            textAlign: 'center', gap: '12px', padding: '56px 24px 40px',
          }}>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              Couldn&apos;t load your workout days. Check your connection and try again.
            </p>
            <button
              onClick={() => load()}
              style={{
                height: '44px', padding: '0 24px',
                backgroundColor: 'var(--surface-elevated)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', borderRadius: '10px',
                fontFamily: "'DM Sans', sans-serif", fontSize: '14px', fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        ) : dayKeys.length === 0 ? (
          /* Blank-slate hero — the direct continuation of Home's "SET UP YOUR
             FIRST DAY". Same visual language (accent icon badge, Bebas title,
             lime button) so the CTA the user tapped simply grows into this
             screen, and one obvious button opens the create-day form. */
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '16px',
            padding: '56px 24px 40px',
          }}>
            <span style={{
              width: '76px', height: '76px', borderRadius: '9999px',
              backgroundColor: 'var(--accent-wash)', color: 'var(--accent-text)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <DayIcon kind="default" size={28} />
            </span>
            <h2 style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: '28px',
              color: 'var(--text-primary)', letterSpacing: '1px', lineHeight: 1, margin: 0,
            }}>
              SET UP YOUR FIRST DAY
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', maxWidth: '320px', lineHeight: 1.5 }}>
              Create a workout day — like Push, Pull, or Legs — add your exercises,
              and you&apos;re ready to train. Takes about a minute.
            </p>
            <button
              onClick={openCreateDay}
              style={{
                marginTop: '4px', height: '52px', padding: '0 32px',
                backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: 'none',
                borderRadius: '12px', fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '20px', letterSpacing: '1px', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '10px',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              CREATE A DAY
            </button>
          </div>
        ) : (
          <>
          {openSessions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              {openSessions.map(session => {
                const today = isStartedToday(session.started_at)
                const busy = openBusyId === session.id
                return (
                  <div
                    key={session.id}
                    style={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: '12px',
                      padding: '14px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          fontSize: '10px', fontWeight: 700, letterSpacing: '1.2px',
                          textTransform: 'uppercase', color: 'var(--accent-text)', marginBottom: '4px',
                        }}>
                          {today ? 'In progress' : 'Incomplete session'}
                        </div>
                        <div style={{
                          fontFamily: "'Bebas Neue', sans-serif",
                          fontSize: '22px', letterSpacing: '1px',
                          color: 'var(--text-primary)', lineHeight: 1,
                        }}>
                          {dayLabel(session.day_type)}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {today
                            ? (session.loggedSets > 0
                              ? `${session.loggedSets} set${session.loggedSets === 1 ? '' : 's'} logged`
                              : 'No sets logged yet')
                            : `${formatShortDate(session.started_at)}${
                                session.loggedSets > 0
                                  ? ` · ${session.loggedSets} set${session.loggedSets === 1 ? '' : 's'}`
                                  : ' · no sets yet'
                              }`}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-haptic="medium"
                        className="press"
                        disabled={busy}
                        onClick={() => router.push(`/log?day=${session.day_type}`)}
                        style={{
                          position: 'relative',
                          height: '40px', padding: '0 16px', flexShrink: 0,
                          backgroundColor: 'var(--accent)', color: 'var(--on-accent)',
                          border: 'none', borderRadius: '10px',
                          fontFamily: "'Bebas Neue', sans-serif",
                          fontSize: '16px', letterSpacing: '0.5px',
                          cursor: busy ? 'default' : 'pointer',
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        RESUME
                      </button>
                    </div>

                    {discardConfirmId !== session.id ? (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          data-haptic="medium"
                          className="press"
                          disabled={busy || session.loggedSets === 0}
                          title={session.loggedSets === 0 ? 'Log a set before saving' : undefined}
                          onClick={() => void handleSaveOpen(session)}
                          style={{
                            position: 'relative',
                            flex: 1, height: '40px',
                            backgroundColor: 'var(--surface-elevated)',
                            border: '1px solid var(--border)', borderRadius: '10px',
                            color: session.loggedSets === 0 ? 'var(--text-muted)' : 'var(--accent-text)',
                            fontFamily: "'DM Sans', sans-serif",
                            fontSize: '13px', fontWeight: 700,
                            cursor: (busy || session.loggedSets === 0) ? 'default' : 'pointer',
                            opacity: busy ? 0.6 : 1,
                          }}
                        >
                          {busy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          data-haptic="light"
                          className="press"
                          disabled={busy}
                          onClick={() => setDiscardConfirmId(session.id)}
                          style={{
                            position: 'relative',
                            flex: 1, height: '40px',
                            backgroundColor: 'transparent',
                            border: '1px solid var(--border)', borderRadius: '10px',
                            color: 'var(--text-secondary)',
                            fontFamily: "'DM Sans', sans-serif",
                            fontSize: '13px', fontWeight: 600,
                            cursor: busy ? 'default' : 'pointer',
                            opacity: busy ? 0.6 : 1,
                          }}
                        >
                          Discard
                        </button>
                      </div>
                    ) : (
                      <div style={{
                        display: 'flex', flexDirection: 'column', gap: '8px',
                        padding: '12px',
                        backgroundColor: 'var(--surface-elevated)',
                        border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: '10px',
                      }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          Discard this workout? Logged sets will be permanently deleted.
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            data-haptic="light"
                            className="press"
                            disabled={busy}
                            onClick={() => setDiscardConfirmId(null)}
                            style={{
                              position: 'relative', flex: 1, height: '40px',
                              backgroundColor: 'var(--surface)', border: '1px solid var(--border)',
                              borderRadius: '8px', color: 'var(--text-primary)',
                              fontFamily: "'DM Sans', sans-serif", fontSize: '13px', fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Keep
                          </button>
                          <button
                            type="button"
                            data-haptic="heavy"
                            className="press"
                            disabled={busy}
                            onClick={() => void handleDiscardOpen(session)}
                            style={{
                              position: 'relative', flex: 1, height: '40px',
                              backgroundColor: 'rgba(239,68,68,0.15)',
                              border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px',
                              color: 'var(--danger)',
                              fontFamily: "'DM Sans', sans-serif", fontSize: '13px', fontWeight: 700,
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
            </div>
          )}

          <div className="day-grid stagger">
            {dayKeys.map((key, idx) => {
              const exs = grouped[key]
              // Preview only active exercises so it matches what the live
              // workout will actually offer (17-exercise-active-flag.sql).
              const activeExs = exs.filter(e => e.active)
              const description = activeExs.map(e => e.name).join(', ')
              const isUpNext = key === upNext
              const openSession = openByDay[key]
              const colorKey = categoryForDay(key, dayCategories)
              const fillColor = resolveDayColor(colorKey, extraTypes, isLight, dayColors[key])
              const labelColor = resolveDayTextColor(colorKey, extraTypes, isLight, dayColors[key])
              const dayCategory = dayCategories[key] ?? null
              // Category color accents the title/icon + UP NEXT chrome only —
              // cards stay on the normal surface so the grid isn't a rainbow.
              // UP NEXT uses a 2px category outline so it reads clearly vs the
              // thin neutral border on every other day.
              const idleBorder = isUpNext
                ? `2px solid ${fillColor}`
                : '1px solid var(--border)'
              return (
                <button
                  key={key}
                  className="press-card"
                  data-onboard={idx === 0 ? 'dayselect-days' : undefined}
                  data-haptic="heavy"
                  onClick={() => {
                    router.push(`/log?day=${key}`)
                  }}
                  style={{
                    '--i': idx,
                    position: 'relative',
                    backgroundColor: 'var(--surface)',
                    border: idleBorder,
                    borderRadius: '12px',
                    padding: '20px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    width: '100%',
                    transition: 'border-color 150ms ease, background-color 150ms ease',
                  } as CSSProperties}
                  onMouseEnter={e => {
                    if (!isUpNext) e.currentTarget.style.borderColor = fillColor
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.border = idleBorder
                  }}
                  onTouchStart={e => {
                    if (!isUpNext) e.currentTarget.style.borderColor = fillColor
                  }}
                  onTouchEnd={e => {
                    e.currentTarget.style.border = idleBorder
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: labelColor }}>
                      <DayIcon dayKey={key} category={dayCategory} size={28} />
                      <span style={{
                        fontFamily: "'Bebas Neue', sans-serif",
                        fontSize: '28px',
                        color: labelColor,
                        letterSpacing: '1px',
                      }}>
                        {key.replace(/-/g, ' ').toUpperCase()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {flexDays.has(key) && (
                        <span style={{
                          fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border)',
                          padding: '2px 7px', borderRadius: '9999px',
                          fontFamily: "'DM Sans', sans-serif",
                        }}>
                          FLEX
                        </span>
                      )}
                      {openSession ? (
                        <span style={{
                          fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
                          color: 'var(--on-accent)', backgroundColor: 'var(--accent)',
                          padding: '3px 8px', borderRadius: '9999px',
                          fontFamily: "'DM Sans', sans-serif",
                        }}>
                          {isStartedToday(openSession.started_at) ? 'IN PROGRESS' : 'INCOMPLETE'}
                        </span>
                      ) : isUpNext ? (
                        <span style={{
                          fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
                          color: onDayFill(fillColor), backgroundColor: fillColor,
                          padding: '3px 8px', borderRadius: '9999px',
                          fontFamily: "'DM Sans', sans-serif",
                        }}>
                          UP NEXT
                        </span>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          {activeExs.length} exercise{activeExs.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    {description}
                  </div>
                </button>
              )
            })}
          </div>
          </>
        )}

        {/* "Log a past workout" is a power feature — only surface it once the
            user actually has days/history. On the blank slate it would just pull
            focus away from the one thing that matters: creating a day. */}
        {!loading && dayKeys.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button
              data-onboard="dayselect-past"
              onClick={() => router.push('/log/past')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                color: 'var(--text-muted)',
                fontFamily: "'DM Sans', sans-serif",
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                padding: '4px 8px',
                transition: 'color 150ms ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              Log a past workout
            </button>
          </div>
        )}
      </div>

      {showManager && (
        <WorkoutManager
          onClose={closeManager}
          onChanged={() => {
            markAppDataStale()
            setOpenSessionsOverride(null)
            void load()
          }}
          initialNewDay={managerNewDay}
        />
      )}

      {actionToastExit.data && (
        <ToastPill
          key={actionToastExit.data}
          edge="bottom"
          exiting={actionToastExit.closing}
          onDismiss={() => {
            if (actionToastTimer.current) clearTimeout(actionToastTimer.current)
            setActionToast(null)
          }}
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
          }}
        >
          {actionToastExit.data}
        </ToastPill>
      )}

      <FinishUndoBanner />
    </>
  )
}
