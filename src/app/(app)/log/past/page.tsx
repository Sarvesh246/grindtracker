'use client'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import { demoSafeClient } from '@/lib/demoMode/demoSafeSupabase'
import { Exercise, UserStats } from '@/lib/types'
import { checkAndAwardBadges } from '@/lib/utils/badges'
import { localDateKey } from '@/lib/utils/formatting'
import { useUnit } from '@/lib/contexts/UnitContext'

function parseDefaultReps(repsTarget: string): string {
  return repsTarget.split('-')[0].trim()
}

function getYesterdayString(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type SetInput = { weight: string; reps: string }

type ExistingSession = { id: string; day_type: string; xp_earned: number }


function LogPastContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { demoMode } = useDemoMode()
  const supabase = demoMode ? demoSafeClient(createClient()) : createClient()
  const { unitLabel, fromDisplay, fmt } = useUnit()

  const yesterday = getYesterdayString()
  const paramDate = searchParams.get('date')
  const initialDate = paramDate && paramDate <= yesterday ? paramDate : yesterday

  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [dayTypes, setDayTypes] = useState<string[]>([])
  const [selectedDayType, setSelectedDayType] = useState<string | null>(null)
  const [existingSession, setExistingSession] = useState<ExistingSession | null>(null)
  const existingSessionRef = useRef<ExistingSession | null>(null)
  // Incremented on every checkExistingSession call; async callbacks bail out if stale.
  const checkGenRef = useRef(0)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [setInputs, setSetInputs] = useState<Record<string, SetInput[]>>({})
  const [skippedExercises, setSkippedExercises] = useState<Set<string>>(new Set())
  const [loadingExercises, setLoadingExercises] = useState(false)
  const [checkingDate, setCheckingDate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState(false)
  const [done, setDone] = useState<{ xpEarned: number; prCount: number; isEdit: boolean; isDelete: boolean } | null>(null)

  // The user's actual workout days (including custom ones like "abs" or "upper"),
  // not a fixed push/pull/legs list — so a past workout can be logged for any day
  // the user trains, matching the live day picker.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('exercises')
      .select('day_type')
      .then(({ data }) => {
        if (cancelled) return
        setDayTypes(Array.from(new Set((data ?? []).map(r => r.day_type))).sort())
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Next.js router cache keeps this component alive across navigations, so
  // useState(initialDate) won't reinitialize when the URL param changes.
  // This effect re-syncs selectedDate whenever the ?date= param changes.
  useEffect(() => {
    const target = paramDate && paramDate <= yesterday ? paramDate : yesterday
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedDate(target)
    // Re-sync only when the URL param changes; `yesterday` is recomputed each
    // render and intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramDate])

  // checkExistingSession is intentionally NOT a useCallback: it depends on `fmt`
  // (which changes on unit toggle) and resets all in-progress inputs, so adding
  // it to the dep array would wipe a half-entered log when the user flips kg/lbs.
  // It only ever needs to re-run when the selected date changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    checkExistingSession(selectedDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate])

  async function checkExistingSession(date: string) {
    const gen = ++checkGenRef.current
    setCheckingDate(true)
    setSelectedDayType(null)
    setExercises([])
    setSetInputs({})
    setSkippedExercises(new Set())
    setDuplicateWarning(false)
    setConfirmDelete(false)
    existingSessionRef.current = null
    setExistingSession(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user || gen !== checkGenRef.current) { setCheckingDate(false); return }

    // Match on sessions.local_date (streak key), never UTC completed_at windows.
    const { data: existing, error: existingError } = await supabase
      .from('sessions')
      .select('id, day_type, xp_earned')
      .eq('user_id', user.id)
      .eq('local_date', date)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (gen !== checkGenRef.current) return

    if (existingError) {
      // A failed lookup must never silently present an already-logged date as
      // blank/new — saving would then fight the DB's one-completed-session-
      // per-day unique index with a confusing error, or in the worst case
      // duplicate the session rather than editing it.
      console.error('[grind] failed to check for an existing session', existingError)
      setError('Could not check this date. Check your connection and try again.')
    }

    if (existing) {
      existingSessionRef.current = existing
      setExistingSession(existing)
      setSelectedDayType(existing.day_type)
      await loadExercises(existing.day_type, existing.id)
    }

    if (gen === checkGenRef.current) setCheckingDate(false)
  }

  async function loadExercises(dayType: string, existingSessionId?: string) {
    setLoadingExercises(true)
    const { data, error: exercisesError } = await supabase
      .from('exercises')
      .select('*')
      .eq('day_type', dayType)
      .order('sort_order', { ascending: true })

    let existingLogsError = null
    let existingLogs: { exercise_id: string; set_number: number; weight: number | null; reps: number | null }[] = []
    if (existingSessionId) {
      const res = await supabase
        .from('session_logs')
        .select('exercise_id, set_number, weight, reps')
        .eq('session_id', existingSessionId)
      existingLogsError = res.error
      existingLogs = res.data ?? []
    }

    // Editing an existing session: handleSubmit replaces ALL of its logs with
    // exactly what ends up in the form below. If either fetch failed, silently
    // falling back to an empty list here would render this session as if it had
    // no exercises/sets logged — saving from that state would permanently wipe
    // the real data instead of editing it. Bail out with an error instead of
    // ever letting that half-loaded state become submittable.
    if (existingSessionId && (exercisesError || existingLogsError)) {
      console.error('[grind] failed to load exercises for an existing session edit', exercisesError, existingLogsError)
      setError('Could not load this workout. Check your connection and try again.')
      setLoadingExercises(false)
      return
    }
    if (exercisesError) {
      console.error('[grind] failed to load exercises', exercisesError)
    }

    // Disabled exercises (17-exercise-active-flag.sql) don't offer for a fresh
    // entry, matching ActiveWorkout — but if this session already has logged
    // sets for one (logged before it was disabled), it must stay in the form:
    // handleSubmit replaces ALL of the session's logs with what's here, so
    // dropping it would silently delete that exercise's data on save.
    const loggedExerciseIds = new Set(existingLogs.map(l => l.exercise_id))
    const exs = (data ?? []).filter(ex => ex.active || loggedExerciseIds.has(ex.id))
    setExercises(exs)

    // A live-logged session can have bonus sets beyond sets_target (added via
    // + ADD SET in the active workout). Size each exercise's input array to fit
    // the highest set_number actually saved — otherwise those rows are silently
    // dropped from the form, and submitting this edit (which replaces ALL of the
    // session's logs with exactly what's in setInputs) would permanently delete them.
    const maxSetByExercise = new Map<string, number>()
    for (const log of existingLogs) {
      const cur = maxSetByExercise.get(log.exercise_id) ?? 0
      if (log.set_number > cur) maxSetByExercise.set(log.exercise_id, log.set_number)
    }

    const inputs: Record<string, SetInput[]> = {}
    for (const ex of exs) {
      const length = Math.max(ex.sets_target, maxSetByExercise.get(ex.id) ?? 0)
      inputs[ex.id] = Array.from({ length }, () => ({
        weight: '',
        reps: parseDefaultReps(ex.reps_target),
      }))
    }

    for (const log of existingLogs) {
      if (inputs[log.exercise_id]?.[log.set_number - 1]) {
        inputs[log.exercise_id][log.set_number - 1] = {
          weight: log.weight !== null ? fmt(log.weight) : '',
          reps: log.reps !== null ? String(log.reps) : '',
        }
      }
    }

    setSetInputs(inputs)
    setLoadingExercises(false)
  }

  function handleDayTypeSelect(type: string) {
    setDuplicateWarning(false)
    setSkippedExercises(new Set())
    setSelectedDayType(type)
    const editId = existingSessionRef.current?.day_type === type
      ? existingSessionRef.current?.id
      : undefined
    loadExercises(type, editId)
  }

  function updateSet(exerciseId: string, setIdx: number, field: 'weight' | 'reps', value: string) {
    setSetInputs(prev => {
      const updated = prev[exerciseId].map((s, i) => i === setIdx ? { ...s, [field]: value } : s)
      return { ...prev, [exerciseId]: updated }
    })
  }

  async function handleSubmit(editExisting = false) {
    if (!selectedDayType) return
    setError(null)
    setSubmitting(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not logged in.'); setSubmitting(false); return }

    const isEditing = existingSessionRef.current?.day_type === selectedDayType
      || editExisting

    // Warn when another day-type already exists for this local_date and user is
    // logging a different day without editing that row. Uniqueness is per
    // (user, local_date, day_type) — same day-type always replaces via RPC.
    if (!isEditing) {
      const { data: existing } = await supabase
        .from('sessions')
        .select('id, day_type')
        .eq('user_id', user.id)
        .eq('local_date', selectedDate)
        .eq('day_type', selectedDayType)
        .not('completed_at', 'is', null)
        .limit(1)

      if (existing && existing.length > 0) {
        // Route to edit instead of duplicating (unique index forbids second row).
        existingSessionRef.current = {
          id: existing[0].id,
          day_type: existing[0].day_type,
          xp_earned: 0,
        }
        setExistingSession(existingSessionRef.current)
        setDuplicateWarning(true)
        setSubmitting(false)
        return
      }
    }

    const logsPayload: {
      exercise_id: string
      set_number: number
      weight: number
      reps: number
    }[] = []

    for (const ex of exercises) {
      if (skippedExercises.has(ex.id)) continue
      const sets = setInputs[ex.id] ?? []
      for (let i = 0; i < sets.length; i++) {
        const s = sets[i]
        if (s.weight === '' || s.reps === '') continue
        const weight = fromDisplay(parseFloat(s.weight))
        const reps = parseInt(s.reps)
        if (!Number.isFinite(weight) || !Number.isFinite(reps)) continue
        logsPayload.push({
          exercise_id: ex.id,
          set_number: i + 1,
          weight,
          reps,
        })
      }
    }

    if (logsPayload.length === 0) {
      setError('Log at least one set with weight and reps before saving.')
      setSubmitting(false)
      return
    }

    // One transactional RPC: create-or-replace logs + recompute stats.
    // (docs/sql/20-production-hardening.sql). Never delete-then-insert client-side.
    const sessionIdForEdit =
      existingSessionRef.current?.day_type === selectedDayType
        ? existingSessionRef.current.id
        : null

    const { data: result, error: upsertError } = await supabase.rpc(
      'upsert_past_session',
      {
        p_day_type: selectedDayType,
        p_local_date: selectedDate,
        p_logs: logsPayload,
        p_session_id: sessionIdForEdit,
        p_note: null,
      },
    )

    if (upsertError || !result) {
      const msg = String(upsertError?.message ?? '')
      if (msg.includes('NO_WORKING_SETS')) {
        setError('Log at least one set with weight and reps before saving.')
      } else {
        setError('Could not save the workout. Check your connection and try again.')
      }
      setSubmitting(false)
      return
    }

    const payload = result as {
      xp_earned?: number
      pr_count?: number
      xp_total?: number
      level?: number
      current_streak?: number
      longest_streak?: number
      last_workout_date?: string | null
      total_workouts?: number
    }

    const { data: statsData } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    await checkAndAwardBadges(
      supabase,
      user.id,
      {
        ...statsData,
        xp_total: payload.xp_total ?? statsData?.xp_total ?? 0,
        level: payload.level ?? statsData?.level ?? 1,
        current_streak: payload.current_streak ?? statsData?.current_streak ?? 0,
        longest_streak: payload.longest_streak ?? statsData?.longest_streak ?? 0,
        last_workout_date: payload.last_workout_date ?? statsData?.last_workout_date ?? null,
        total_workouts: payload.total_workouts ?? statsData?.total_workouts ?? 0,
      } as UserStats,
    )

    setDone({
      xpEarned: payload.xp_earned ?? 0,
      prCount: payload.pr_count ?? 0,
      isEdit: !!sessionIdForEdit || editExisting,
      isDelete: false,
    })
    setSubmitting(false)
  }

  async function handleDelete() {
    const session = existingSessionRef.current
    if (!session) return
    setDeleting(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not logged in.'); setDeleting(false); return }

    // One server-side call: deletes the session (logs cascade) and re-derives
    // stats from what remains. Subtracting the stored xp_earned client-side, as
    // this used to, drifted whenever that value was stale.
    const { error: deleteError } = await supabase.rpc('delete_session', {
      p_session_id: session.id,
      p_local_date: localDateKey(new Date()),
    })

    if (deleteError) {
      setError('Could not delete the workout. Try again.')
      setDeleting(false)
      return
    }

    setDone({ xpEarned: session.xp_earned, prCount: 0, isEdit: false, isDelete: true })
    setDeleting(false)
  }

  // ── Success / delete state ─────────────────────────────────────────────────
  if (done) {
    const accentColor = done.isDelete ? 'var(--danger)' : 'var(--accent)'
    return (
      <div style={{ padding: '24px 16px', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '64px', gap: '16px' }}>
        {done.isDelete ? (
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--danger)' }}>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        ) : (
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        )}
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '28px', color: 'var(--text-primary)', letterSpacing: '1px', textAlign: 'center' }}>
          {done.isDelete ? 'WORKOUT DELETED' : done.isEdit ? 'WORKOUT UPDATED' : 'WORKOUT LOGGED'}
        </div>
        <div style={{ backgroundColor: 'var(--surface)', border: `1px solid ${done.isDelete ? 'rgba(239,68,68,0.2)' : 'var(--border)'}`, borderRadius: '12px', padding: '20px 24px', textAlign: 'center', width: '100%', maxWidth: '320px' }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '40px', color: accentColor, lineHeight: 1 }}>
            {done.isDelete ? '-' : done.isEdit ? '±' : '+'}{done.xpEarned} XP
          </div>
          {!done.isDelete && done.prCount > 0 && (
            <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '6px' }}>
              {done.prCount} PR{done.prCount !== 1 ? 's' : ''} detected
            </div>
          )}
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {selectedDate} · {selectedDayType?.toUpperCase()}
          </div>
        </div>
        <button
          onClick={() => router.push('/home')}
          style={{
            marginTop: '8px',
            backgroundColor: accentColor,
            color: 'var(--on-accent)',
            border: 'none',
            borderRadius: '12px',
            padding: '14px 32px',
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '18px',
            letterSpacing: '1px',
            cursor: 'pointer',
          }}
        >
          BACK TO HOME
        </button>
      </div>
    )
  }

  const isEditing = existingSession?.day_type === selectedDayType

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div className="page page--narrow" style={{ fontFamily: "'DM Sans', sans-serif", paddingBottom: '40px' }}>

      {/* Header */}
      <div style={{ padding: '24px 16px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={() => router.back()}
          aria-label="Back"
          style={{ background: 'none', border: 'none', cursor: 'pointer', width: '44px', height: '44px', color: 'var(--text-secondary)', flexShrink: 0, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '28px',
          color: 'var(--text-primary)',
          letterSpacing: '1px',
          margin: 0,
        }}>
          {isEditing ? 'EDIT WORKOUT' : 'LOG PAST WORKOUT'}
        </h1>
      </div>

      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* Date + Day Type */}
        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Date picker */}
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
              DATE
            </div>
            <input
              type="date"
              value={selectedDate}
              max={yesterday}
              onChange={e => {
                setSelectedDate(e.target.value)
                setDuplicateWarning(false)
              }}
              style={{
                backgroundColor: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '10px 12px',
                color: 'var(--text-primary)',
                fontSize: '16px', // ≥16px — anything smaller makes iOS auto-zoom on focus
                fontFamily: "'DM Sans', sans-serif",
                outline: 'none',
              }}
            />
          </div>

          {/* Day type pills */}
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
              DAY TYPE
            </div>
            {checkingDate ? (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '8px 0' }}>Checking date...</div>
            ) : dayTypes.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '8px 0' }}>No workout days yet.</div>
            ) : (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {dayTypes.map(type => {
                  const active = selectedDayType === type
                  return (
                    <button
                      key={type}
                      onClick={() => handleDayTypeSelect(type)}
                      style={{
                        // Grow to fill, but wrap to a new row past ~3 days so custom
                        // rotations with many days stay readable on a phone.
                        flex: '1 1 80px',
                        height: '36px',
                        padding: '0 12px',
                        borderRadius: '9999px',
                        border: active ? 'none' : '1px solid var(--border)',
                        backgroundColor: active ? 'var(--accent)' : 'var(--surface-elevated)',
                        color: active ? 'var(--on-accent)' : 'var(--text-secondary)',
                        fontSize: '13px',
                        fontFamily: "'Bebas Neue', sans-serif",
                        letterSpacing: '0.5px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'background-color 150ms ease, color 150ms ease',
                      }}
                    >
                      {type.replace(/-/g, ' ').toUpperCase()}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Edit mode banner */}
        {isEditing && !confirmDelete && (
          <div style={{
            backgroundColor: 'rgba(200, 241, 53, 0.08)',
            border: '1px solid rgba(200, 241, 53, 0.25)',
            borderRadius: '10px',
            padding: '10px 14px',
            fontSize: '13px',
            color: 'var(--accent-dim)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Editing existing workout — changes will replace the saved data
            </div>
            <button
              onClick={() => setConfirmDelete(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--text-muted)', lineHeight: 1, flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              title="Delete this workout"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          </div>
        )}

        {/* Delete confirmation */}
        {isEditing && confirmDelete && (
          <div style={{
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}>
            <span style={{ fontSize: '13px', color: '#f87171', lineHeight: 1.4 }}>
              Delete this workout? This will remove {existingSession?.xp_earned ?? 0} XP.
            </span>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              <button
                data-haptic="light"
                onClick={() => setConfirmDelete(false)}
                style={{
                  position: 'relative',
                  background: 'none',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  color: 'var(--text-secondary)',
                  fontSize: '11px',
                  fontFamily: "'Bebas Neue', sans-serif",
                  letterSpacing: '0.5px',
                  cursor: 'pointer',
                }}
              >
                CANCEL
              </button>
              <button
                data-haptic="heavy"
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  position: 'relative',
                  background: 'none',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  color: 'var(--danger)',
                  fontSize: '11px',
                  fontFamily: "'Bebas Neue', sans-serif",
                  letterSpacing: '0.5px',
                  cursor: deleting ? 'default' : 'pointer',
                  opacity: deleting ? 0.5 : 1,
                }}
              >
                {deleting ? 'DELETING...' : 'DELETE'}
              </button>
            </div>
          </div>
        )}

        {/* Duplicate warning */}
        {duplicateWarning && (
          <div style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}>
            <span style={{ fontSize: '13px', color: '#f87171', lineHeight: 1.4 }}>
              A {selectedDayType} workout already exists for this date. Saving will replace it.
            </span>
            <button
              data-haptic="heavy"
              onClick={() => { setDuplicateWarning(false); handleSubmit(true) }}
              style={{
                position: 'relative',
                background: 'none',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                borderRadius: '6px',
                padding: '6px 10px',
                color: '#f87171',
                fontSize: '11px',
                fontFamily: "'Bebas Neue', sans-serif",
                letterSpacing: '0.5px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              REPLACE
            </button>
          </div>
        )}

        {/* Exercises */}
        {selectedDayType && (
          loadingExercises ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>
              Loading exercises...
            </div>
          ) : exercises.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>
              No exercises found for {selectedDayType}.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {exercises.map(ex => (
                <div
                  key={ex.id}
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: `1px solid ${skippedExercises.has(ex.id) ? 'rgba(239,68,68,0.2)' : 'var(--border)'}`,
                    borderRadius: '12px',
                    overflow: 'hidden',
                    opacity: skippedExercises.has(ex.id) ? 0.65 : 1,
                    transition: 'opacity 150ms ease, border-color 150ms ease',
                  }}
                >
                  {/* Exercise header */}
                  <div style={{
                    padding: '12px 16px',
                    borderBottom: skippedExercises.has(ex.id) ? 'none' : '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                      <span style={{
                        fontSize: '15px',
                        color: skippedExercises.has(ex.id) ? 'var(--text-muted)' : 'var(--text-primary)',
                        fontWeight: 600,
                        textDecoration: skippedExercises.has(ex.id) ? 'line-through' : 'none',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {ex.name}
                      </span>
                      {skippedExercises.has(ex.id) && (
                        <span style={{
                          fontSize: '10px', color: 'var(--danger)',
                          backgroundColor: 'rgba(239,68,68,0.1)',
                          border: '1px solid rgba(239,68,68,0.25)',
                          borderRadius: '9999px', padding: '1px 6px',
                          fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.5px',
                          flexShrink: 0,
                        }}>
                          SKIPPED
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      {!skippedExercises.has(ex.id) && (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          {ex.sets_target} × {ex.reps_target}
                        </span>
                      )}
                      <button
                        onClick={() => setSkippedExercises(prev => {
                          const next = new Set(prev)
                          if (next.has(ex.id)) next.delete(ex.id)
                          else next.add(ex.id)
                          return next
                        })}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '3px',
                          padding: '2px 4px', opacity: 0.6,
                          borderRadius: '4px',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
                      >
                        {skippedExercises.has(ex.id) ? (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
                              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.37"/>
                            </svg>
                            <span style={{ fontSize: '10px', color: 'var(--accent-text)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.5px' }}>UNDO</span>
                          </>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                              <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                            </svg>
                            <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.5px' }}>SKIP</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Set rows */}
                  {!skippedExercises.has(ex.id) && (
                    <div style={{ padding: '8px 0' }}>
                      {(setInputs[ex.id] ?? []).map((s, idx) => (
                        <div
                          key={idx}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 16px' }}
                        >
                          <span style={{
                            fontSize: '12px', color: 'var(--text-muted)',
                            width: '40px', flexShrink: 0,
                            fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.5px',
                          }}>
                            SET {idx + 1}
                          </span>

                          <div style={{ flex: 1, position: 'relative' }}>
                            <input
                              type="number"
                              inputMode="decimal"
                              placeholder="—"
                              value={s.weight}
                              onChange={e => updateSet(ex.id, idx, 'weight', e.target.value)}
                              style={{
                                width: '100%',
                                backgroundColor: 'var(--surface-elevated)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                padding: '8px 36px 8px 10px',
                                color: 'var(--text-primary)',
                                fontSize: '16px', // ≥16px — anything smaller makes iOS auto-zoom on focus
                                fontFamily: "'JetBrains Mono', monospace",
                                outline: 'none',
                                boxSizing: 'border-box',
                                textAlign: 'right',
                              }}
                              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                            />
                            <span style={{
                              position: 'absolute', right: '8px', top: '50%',
                              transform: 'translateY(-50%)', fontSize: '11px',
                              color: 'var(--text-muted)', pointerEvents: 'none',
                            }}>
                              {unitLabel}
                            </span>
                          </div>

                          <div style={{ width: '68px', flexShrink: 0, position: 'relative' }}>
                            <input
                              type="number"
                              inputMode="numeric"
                              value={s.reps}
                              onChange={e => updateSet(ex.id, idx, 'reps', e.target.value)}
                              style={{
                                width: '100%',
                                backgroundColor: 'var(--surface-elevated)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                padding: '8px 32px 8px 10px',
                                color: 'var(--text-primary)',
                                fontSize: '16px', // ≥16px — anything smaller makes iOS auto-zoom on focus
                                fontFamily: "'JetBrains Mono', monospace",
                                outline: 'none',
                                boxSizing: 'border-box',
                                textAlign: 'right',
                              }}
                              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                            />
                            <span style={{
                              position: 'absolute', right: '7px', top: '50%',
                              transform: 'translateY(-50%)', fontSize: '11px',
                              color: 'var(--text-muted)', pointerEvents: 'none',
                            }}>
                              reps
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {/* Error */}
        {error && (
          <div style={{ fontSize: '13px', color: 'var(--danger)', textAlign: 'center' }}>
            {error}
          </div>
        )}

        {/* Submit */}
        {selectedDayType && exercises.length > 0 && !loadingExercises && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
            <button
              data-haptic="heavy"
              onClick={() => handleSubmit(false)}
              disabled={submitting}
              style={{
                position: 'relative',
                width: '100%',
                height: '52px',
                backgroundColor: submitting ? 'var(--text-muted)' : 'var(--accent)',
                color: 'var(--on-accent)',
                border: 'none',
                borderRadius: '12px',
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '20px',
                letterSpacing: '1px',
                cursor: submitting ? 'default' : 'pointer',
                transition: 'opacity 150ms ease',
              }}
              onMouseDown={e => { if (!submitting) e.currentTarget.style.opacity = '0.85' }}
              onMouseUp={e => { if (!submitting) e.currentTarget.style.opacity = '1' }}
              onTouchStart={e => { if (!submitting) e.currentTarget.style.opacity = '0.85' }}
              onTouchEnd={e => { if (!submitting) e.currentTarget.style.opacity = '1' }}
            >
              {submitting ? (isEditing ? 'UPDATING...' : 'LOGGING...') : (isEditing ? 'UPDATE WORKOUT' : 'LOG WORKOUT')}
            </button>

            {isEditing && !confirmDelete && (
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
                style={{
                  width: '100%',
                  height: '44px',
                  backgroundColor: 'transparent',
                  color: 'var(--danger)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '12px',
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: '16px',
                  letterSpacing: '1px',
                  cursor: deleting ? 'default' : 'pointer',
                  transition: 'background-color 150ms ease, border-color 150ms ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.06)'
                  e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)'
                }}
              >
                DELETE WORKOUT
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function LogPastPage() {
  return (
    <Suspense fallback={
      <div style={{ padding: '24px 16px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif", fontSize: '14px' }}>
        Loading...
      </div>
    }>
      <LogPastContent />
    </Suspense>
  )
}
