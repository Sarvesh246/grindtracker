'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Exercise } from '@/lib/types'
import { checkAndAwardBadges } from '@/lib/utils/badges'
import { getLevel } from '@/lib/utils/gamification'
import { localDateKey } from '@/lib/utils/formatting'
import { haptic } from '@/lib/utils/haptics'
import { useUnit } from '@/lib/contexts/UnitContext'
import { deleteIncompleteSessions } from '@/lib/utils/sessions'
import { useRestTimer } from '@/lib/hooks/useRestTimer'
import RestTimerBar from '@/components/RestTimerBar'
import PlateCalculator from '@/components/PlateCalculator'
import CompletionModal from './CompletionModal'

interface SetState {
  weight: string
  reps: string
  checked: boolean
  skipped: boolean
  isPR: boolean
  isWarmup: boolean
  note: string
  logId?: string
}

interface UndoState {
  key: string
  exerciseId: string
  setNumber: number
  expiresAt: number
}

type LogMap = Record<string, SetState>

interface PreviousBest {
  [exerciseId: string]: number | null
}

interface CompletionData {
  xpEarned: number
  leveledUp: boolean
  newLevel: number
  prCount: number
  prExercises: { name: string; weight: number }[]
  newBadges: string[]
  duration: number
  setsCompleted: number
}

function dayLabel(day: string): string {
  return day.replace(/-/g, ' ').toUpperCase() + ' DAY'
}

export default function ActiveWorkout({ day }: { day: string }) {
  const router = useRouter()
  const supabase = createClient()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [logs, setLogs] = useState<LogMap>({})
  // `previousBests` is the live "bar to beat" for PR detection. It starts
  // as the prior-session best (from DB) and advances within this workout
  // as PRs are logged. `baselineBests` keeps the original DB value so we
  // can recompute the live best when sets are edited or undone.
  const [previousBests, setPreviousBests] = useState<PreviousBest>({})
  const [baselineBests, setBaselineBests] = useState<PreviousBest>({})
  const [startedAt, setStartedAt] = useState<Date>(new Date())
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [completionData, setCompletionData] = useState<CompletionData | null>(null)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [allExercises, setAllExercises] = useState<Exercise[]>([])
  const [swapTarget, setSwapTarget] = useState<string | null>(null)
  const [extraSets, setExtraSets] = useState<Record<string, number>>({})
  const [workoutNote, setWorkoutNote] = useState('')
  const [undoState, setUndoState] = useState<UndoState | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [resumeToast, setResumeToast] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [plateCalcTarget, setPlateCalcTarget] = useState<{ key: string; current: number } | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const restTimer = useRestTimer()

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000))
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [startedAt])

  useEffect(() => {
    initSession()
  }, [day])

  // Auto-clear undo state when the 5s window expires.
  useEffect(() => {
    if (!undoState) return
    const remaining = undoState.expiresAt - Date.now()
    if (remaining <= 0) {
      setUndoState(null)
      return
    }
    const id = setTimeout(() => setUndoState(null), remaining)
    return () => clearTimeout(id)
  }, [undoState])

  // Persist workout note on blur (debounced via effect dependency).
  useEffect(() => {
    if (!sessionId) return
    const id = setTimeout(() => {
      supabase.from('sessions').update({ note: workoutNote || null }).eq('id', sessionId)
    }, 600)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutNote])

  async function initSession() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: exs } = await supabase
      .from('exercises')
      .select('*')
      .eq('day_type', day)
      .order('sort_order', { ascending: true })

    if (!exs || exs.length === 0) { setLoading(false); return }
    setExercises(exs)

    const { data: allExsData } = await supabase
      .from('exercises')
      .select('*')
      .order('day_type', { ascending: true })
      .order('sort_order', { ascending: true })
    setAllExercises(allExsData ?? [])

    const bests: PreviousBest = {}
    for (const ex of exs) {
      const { data } = await supabase
        .from('session_logs')
        .select('weight, is_warmup, sessions!inner(user_id, completed_at)')
        .eq('exercise_id', ex.id)
        .eq('is_warmup', false)
        .eq('sessions.user_id', user.id)
        .not('sessions.completed_at', 'is', null)
        .order('weight', { ascending: false })
        .limit(1)
        .maybeSingle()
      bests[ex.id] = data?.weight ?? null
    }
    setPreviousBests(bests)
    setBaselineBests(bests)

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const { data: existing } = await supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('day_type', day)
      .is('completed_at', null)
      .gte('started_at', todayStart.toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let sid: string
    let sessionStart: Date

    if (existing) {
      sid = existing.id
      sessionStart = new Date(existing.started_at)
      if (existing.note) setWorkoutNote(existing.note)

      const { data: existingLogs } = await supabase
        .from('session_logs')
        .select('*')
        .eq('session_id', existing.id)

      // Count extras per exercise from highest set_number seen.
      const extras: Record<string, number> = {}
      for (const log of existingLogs ?? []) {
        const ex = exs.find(e => e.id === log.exercise_id)
        if (!ex) continue
        if (log.set_number > ex.sets_target) {
          extras[ex.id] = Math.max(extras[ex.id] ?? 0, log.set_number - ex.sets_target)
        }
      }
      setExtraSets(extras)

      const restored: LogMap = {}
      for (const ex of exs) {
        const total = ex.sets_target + (extras[ex.id] ?? 0)
        for (let s = 1; s <= total; s++) {
          const key = `${ex.id}-${s}`
          restored[key] = {
            weight: bests[ex.id] !== null ? String(bests[ex.id]) : '',
            reps: '',
            checked: false,
            skipped: false,
            isPR: false,
            isWarmup: false,
            note: '',
          }
        }
      }
      for (const log of (existingLogs ?? [])) {
        const key = `${log.exercise_id}-${log.set_number}`
        restored[key] = {
          weight: log.weight !== null ? String(log.weight) : '',
          reps: log.reps !== null ? String(log.reps) : '',
          checked: true,
          skipped: false,
          isPR: log.is_pr,
          isWarmup: !!log.is_warmup,
          note: log.note ?? '',
          logId: log.id,
        }
      }
      setLogs(restored)

      const ageMs = Date.now() - sessionStart.getTime()
      if (ageMs > 60_000) {
        const mins = Math.round(ageMs / 60_000)
        setResumeToast(`Resumed workout from ${mins} min ago`)
        setTimeout(() => setResumeToast(null), 4000)
      }
    } else {
      const { data: newSession } = await supabase
        .from('sessions')
        .insert({ user_id: user.id, day_type: day })
        .select()
        .maybeSingle()

      if (!newSession) { setLoading(false); return }
      sid = newSession.id
      sessionStart = new Date(newSession.started_at)

      const prefilled: LogMap = {}
      for (const ex of exs) {
        for (let s = 1; s <= ex.sets_target; s++) {
          const key = `${ex.id}-${s}`
          prefilled[key] = {
            weight: bests[ex.id] !== null ? String(bests[ex.id]) : '',
            reps: '',
            checked: false,
            skipped: false,
            isPR: false,
            isWarmup: false,
            note: '',
          }
        }
      }
      setLogs(prefilled)
    }

    setSessionId(sid)
    setStartedAt(sessionStart)
    setElapsed(Math.floor((Date.now() - sessionStart.getTime()) / 1000))
    setLoading(false)
  }

  /**
   * Recompute the live "best" for an exercise from a candidate logs map.
   * Used after edits and undos so subsequent PR comparisons stay accurate.
   * Warm-ups and unchecked/skipped sets don't count.
   */
  function bestFromLogs(exerciseId: string, logsMap: LogMap): number | null {
    let best = baselineBests[exerciseId] ?? null
    for (const key of Object.keys(logsMap)) {
      if (!key.startsWith(`${exerciseId}-`)) continue
      const e = logsMap[key]
      if (!e.checked || e.isWarmup || e.skipped) continue
      if (e.weight === '') continue
      const w = parseFloat(e.weight)
      if (!Number.isFinite(w)) continue
      if (best === null || w > best) best = w
    }
    return best
  }

  function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  function totalSets(): number {
    return exercises.reduce((sum, ex) => sum + ex.sets_target, 0)
  }

  function checkedSets(): number {
    return Object.values(logs).filter(l => l.checked).length
  }

  function skippedSets(): number {
    return Object.values(logs).filter(l => l.skipped).length
  }

  function allProcessed(): boolean {
    if (totalSets() === 0) return false
    return Object.values(logs).every(l => l.checked || l.skipped)
  }

  function progressPercent(): number {
    if (totalSets() === 0) return 0
    const processed = Object.values(logs).filter(l => l.checked || l.skipped).length
    return (processed / totalSets()) * 100
  }

  function updateLog(key: string, field: 'weight' | 'reps' | 'note', value: string) {
    setLogs(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }))
  }

  function toggleWarmup(exerciseId: string, setNumber: number) {
    const key = `${exerciseId}-${setNumber}`
    setLogs(prev => {
      const cur = prev[key]
      if (!cur || cur.checked) return prev
      return { ...prev, [key]: { ...cur, isWarmup: !cur.isWarmup } }
    })
  }

  async function handleCheck(exerciseId: string, setNumber: number) {
    const key = `${exerciseId}-${setNumber}`
    const logEntry = logs[key]
    if (!logEntry || !sessionId || logEntry.checked) return

    const weight = logEntry.weight !== '' ? parseFloat(logEntry.weight) : null
    const reps = logEntry.reps !== '' ? parseInt(logEntry.reps) : null

    const prevBest = previousBests[exerciseId]
    const isPR =
      !logEntry.isWarmup &&
      weight !== null &&
      prevBest !== null &&
      weight > prevBest

    const { data: saved } = await supabase
      .from('session_logs')
      .upsert(
        {
          session_id: sessionId,
          exercise_id: exerciseId,
          set_number: setNumber,
          weight,
          reps,
          is_pr: isPR,
          is_warmup: logEntry.isWarmup,
          note: logEntry.note || null,
        },
        { onConflict: 'session_id,exercise_id,set_number' },
      )
      .select('id')
      .maybeSingle()

    setLogs(prev => ({
      ...prev,
      [key]: { ...prev[key], checked: true, skipped: false, isPR, logId: saved?.id },
    }))

    if (isPR && weight !== null) {
      setPreviousBests(prev => ({ ...prev, [exerciseId]: weight }))
      haptic('success')
    } else {
      haptic('light')
    }

    setUndoState({ key, exerciseId, setNumber, expiresAt: Date.now() + 5000 })
    if (!logEntry.isWarmup) {
      restTimer.start(exerciseId)
    }
  }

  async function handleUndo() {
    if (!undoState || !sessionId) return
    const { key, exerciseId, setNumber } = undoState
    setUndoState(null)
    restTimer.stop()

    await supabase
      .from('session_logs')
      .delete()
      .eq('session_id', sessionId)
      .eq('exercise_id', exerciseId)
      .eq('set_number', setNumber)

    setLogs(prev => {
      const cur = prev[key]
      if (!cur) return prev
      const next = { ...prev, [key]: { ...cur, checked: false, isPR: false, logId: undefined } }
      // The undone set may have been the live PR. Recompute the best so
      // future sets in this workout compare against the correct value.
      setPreviousBests(pb => ({ ...pb, [exerciseId]: bestFromLogs(exerciseId, next) }))
      return next
    })
  }

  function handleStartEdit(key: string) {
    if (!logs[key]?.checked) return
    setEditingKey(key)
  }

  async function handleSaveEdit(exerciseId: string, setNumber: number) {
    const key = `${exerciseId}-${setNumber}`
    const logEntry = logs[key]
    if (!logEntry || !sessionId) return

    const weight = logEntry.weight !== '' ? parseFloat(logEntry.weight) : null
    const reps = logEntry.reps !== '' ? parseInt(logEntry.reps) : null

    const prevBest = previousBests[exerciseId]
    const isPR =
      !logEntry.isWarmup &&
      weight !== null &&
      prevBest !== null &&
      weight > prevBest

    await supabase.from('session_logs').upsert(
      {
        session_id: sessionId,
        exercise_id: exerciseId,
        set_number: setNumber,
        weight,
        reps,
        is_pr: isPR,
        is_warmup: logEntry.isWarmup,
        note: logEntry.note || null,
      },
      { onConflict: 'session_id,exercise_id,set_number' },
    )

    setLogs(prev => {
      const next = { ...prev, [key]: { ...prev[key], isPR } }
      // Editing may have raised or lowered this exercise's best. Recompute
      // so subsequent PR comparisons in this workout are correct.
      setPreviousBests(pb => ({ ...pb, [exerciseId]: bestFromLogs(exerciseId, next) }))
      return next
    })
    setEditingKey(null)
    haptic('medium')
  }

  /**
   * Persist a note edit on an already-saved set. Called on blur from SetRow
   * when the row is checked and not in editing mode — without this the typed
   * note lives only in local state and is lost on refresh/resume.
   */
  async function persistSetNote(exerciseId: string, setNumber: number) {
    if (!sessionId) return
    const key = `${exerciseId}-${setNumber}`
    const logEntry = logs[key]
    if (!logEntry || !logEntry.checked) return
    await supabase
      .from('session_logs')
      .update({ note: logEntry.note || null })
      .eq('session_id', sessionId)
      .eq('exercise_id', exerciseId)
      .eq('set_number', setNumber)
  }

  function handleAddSet(exerciseId: string) {
    const ex = exercises.find(e => e.id === exerciseId)
    if (!ex) return
    const currentExtras = extraSets[exerciseId] ?? 0
    const newSetNum = ex.sets_target + currentExtras + 1
    setExtraSets(prev => ({ ...prev, [exerciseId]: currentExtras + 1 }))
    setLogs(prev => ({
      ...prev,
      [`${exerciseId}-${newSetNum}`]: {
        weight: previousBests[exerciseId] !== null ? String(previousBests[exerciseId]) : '',
        reps: '',
        checked: false,
        skipped: false,
        isPR: false,
        isWarmup: false,
        note: '',
      },
    }))
  }

  function handleSkipSet(exerciseId: string, setNumber: number) {
    const key = `${exerciseId}-${setNumber}`
    setLogs(prev => ({
      ...prev,
      [key]: { ...prev[key], skipped: true, checked: false },
    }))
  }

  function handleUnskipSet(exerciseId: string, setNumber: number) {
    const key = `${exerciseId}-${setNumber}`
    setLogs(prev => ({
      ...prev,
      [key]: { ...prev[key], skipped: false },
    }))
  }

  function handleSkipExercise(exerciseId: string) {
    const ex = exercises.find(e => e.id === exerciseId)
    if (!ex) return
    setLogs(prev => {
      const next = { ...prev }
      for (let s = 1; s <= ex.sets_target; s++) {
        const key = `${exerciseId}-${s}`
        if (!next[key]?.checked) {
          next[key] = { ...next[key], skipped: true, checked: false }
        }
      }
      return next
    })
  }

  function handleUnskipExercise(exerciseId: string) {
    const ex = exercises.find(e => e.id === exerciseId)
    if (!ex) return
    setLogs(prev => {
      const next = { ...prev }
      for (let s = 1; s <= ex.sets_target; s++) {
        const key = `${exerciseId}-${s}`
        if (next[key]?.skipped) {
          next[key] = { ...next[key], skipped: false }
        }
      }
      return next
    })
  }

  async function handleSwapExercise(newExercise: Exercise) {
    if (!swapTarget || !sessionId) return
    const oldExercise = exercises.find(e => e.id === swapTarget)

    await supabase
      .from('session_logs')
      .delete()
      .eq('session_id', sessionId)
      .eq('exercise_id', swapTarget)

    let prevBest: number | null = previousBests[newExercise.id] !== undefined
      ? previousBests[newExercise.id]
      : null

    if (previousBests[newExercise.id] === undefined) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from('session_logs')
          .select('weight, sessions!inner(user_id, completed_at)')
          .eq('exercise_id', newExercise.id)
          .eq('sessions.user_id', user.id)
          .not('sessions.completed_at', 'is', null)
          .order('weight', { ascending: false })
          .limit(1)
          .maybeSingle()
        prevBest = data?.weight ?? null
        setPreviousBests(prev => ({ ...prev, [newExercise.id]: prevBest }))
      }
    }

    setExercises(prev => {
      const idx = prev.findIndex(e => e.id === swapTarget)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = newExercise
      return next
    })

    setLogs(prev => {
      const next = { ...prev }
      if (oldExercise) {
        for (let s = 1; s <= oldExercise.sets_target; s++) {
          delete next[`${swapTarget}-${s}`]
        }
      }
      for (let s = 1; s <= newExercise.sets_target; s++) {
        next[`${newExercise.id}-${s}`] = {
          weight: prevBest !== null ? String(prevBest) : '',
          reps: '',
          checked: false,
          skipped: false,
          isPR: false,
          isWarmup: false,
          note: '',
        }
      }
      return next
    })

    setSwapTarget(null)
  }

  async function handleDiscard() {
    if (discarding) return
    setDiscarding(true)
    setShowExitConfirm(false)
    restTimer.stop()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setDiscarding(false)
      router.replace('/login')
      return
    }

    const result = await deleteIncompleteSessions(supabase, user.id, day)
    if (!result.ok) {
      setDiscarding(false)
      setResumeToast('Could not discard workout. Try again.')
      setTimeout(() => setResumeToast(null), 4000)
      return
    }

    setSessionId(null)
    setDiscarding(false)
    router.replace('/log')
  }

  async function handleFinish() {
    if (!sessionId || finishing) return
    if (checkedSets() === 0) {
      // Nothing to save — guard against an empty completion.
      return
    }
    setFinishing(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setFinishing(false); router.push('/login'); return }

    const prSets = Object.values(logs).filter(l => l.isPR && !l.skipped && !l.isWarmup)
    const prCount = prSets.length

    const prExercises: { name: string; weight: number }[] = []
    for (const ex of exercises) {
      const total = ex.sets_target + (extraSets[ex.id] ?? 0)
      for (let s = 1; s <= total; s++) {
        const key = `${ex.id}-${s}`
        const log = logs[key]
        if (log?.isPR && !log.skipped && !log.isWarmup && log.weight !== '') {
          if (!prExercises.find(p => p.name === ex.name)) {
            prExercises.push({ name: ex.name, weight: parseFloat(log.weight) })
          }
        }
      }
    }

    let xpEarned = 100 + (prCount * 25)

    let { data: currentStats } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!currentStats) {
      const { data: created } = await supabase
        .from('user_stats')
        .insert({ user_id: user.id })
        .select()
        .maybeSingle()
      currentStats = created
    }
    if (!currentStats) { setFinishing(false); return }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // Parse the stored date key at local noon so the comparison stays in the
    // user's timezone (avoids the UTC-midnight off-by-one that breaks streaks).
    const lastDate = currentStats.last_workout_date
      ? new Date(currentStats.last_workout_date + 'T12:00:00')
      : null

    let newStreak = 1
    if (lastDate) {
      lastDate.setHours(0, 0, 0, 0)
      const diffDays = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays === 0) {
        newStreak = currentStats.current_streak
      } else if (diffDays === 1) {
        newStreak = currentStats.current_streak + 1
      } else {
        newStreak = 1
      }
    }

    if (newStreak % 7 === 0) {
      xpEarned += 50
    }

    const newXpTotal = currentStats.xp_total + xpEarned
    const oldLevel = getLevel(currentStats.xp_total)
    const newLevel = getLevel(newXpTotal)
    const leveledUp = newLevel > oldLevel

    const newLongest = Math.max(currentStats.longest_streak, newStreak)

    await supabase
      .from('sessions')
      .update({
        completed_at: new Date().toISOString(),
        xp_earned: xpEarned,
        note: workoutNote || null,
      })
      .eq('id', sessionId)

    haptic('medium')

    const updatedStats = {
      xp_total: newXpTotal,
      level: newLevel,
      current_streak: newStreak,
      longest_streak: newLongest,
      last_workout_date: localDateKey(today),
      total_workouts: currentStats.total_workouts + 1,
      updated_at: new Date().toISOString(),
    }
    await supabase
      .from('user_stats')
      .update(updatedStats)
      .eq('user_id', user.id)

    const newBadges = await checkAndAwardBadges(
      supabase,
      user.id,
      { ...currentStats, ...updatedStats },
      prCount,
    )

    setCompletionData({
      xpEarned,
      leveledUp,
      newLevel,
      prCount,
      prExercises,
      newBadges,
      duration: elapsed,
      setsCompleted: checkedSets(),
    })
    setFinishing(false)
  }

  if (loading) {
    return (
      <div style={{ padding: '24px 16px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif", fontSize: '14px' }}>
        Loading workout...
      </div>
    )
  }

  if (exercises.length === 0) {
    return (
      <div style={{
        padding: '64px 24px',
        fontFamily: "'DM Sans', sans-serif",
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
      }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--border-strong)' }}>
          <line x1="6" y1="12" x2="18" y2="12" />
          <rect x="2" y="9" width="4" height="6" rx="1.5" />
          <rect x="18" y="9" width="4" height="6" rx="1.5" />
        </svg>
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '24px', color: 'var(--text-primary)', letterSpacing: '1px',
        }}>
          NO EXERCISES FOR THIS DAY
        </div>
        <div style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: '280px' }}>
          Add some exercises to <span style={{ color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{day.replace(/-/g, ' ')}</span> from the workout manager.
        </div>
        <button
          onClick={() => router.push('/log')}
          style={{
            marginTop: '8px', height: '48px', padding: '0 28px',
            backgroundColor: 'var(--accent)', color: 'var(--bg)', border: 'none',
            borderRadius: '12px', fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '18px', letterSpacing: '1px', cursor: 'pointer',
          }}
        >
          BACK TO DAYS
        </button>
      </div>
    )
  }

  const skipped = skippedSets()
  const checked = checkedSets()
  const total = totalSets()

  return (
    <>
      {completionData && (
        <CompletionModal
          data={completionData}
          onDone={() => router.push('/home')}
        />
      )}

      {swapTarget && (
        <ExerciseSwapModal
          currentExerciseId={swapTarget}
          allExercises={allExercises}
          currentExercises={exercises}
          onSelect={handleSwapExercise}
          onClose={() => setSwapTarget(null)}
        />
      )}

      {showExitConfirm && (
        <div
          onClick={() => setShowExitConfirm(false)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-label="Exit workout"
            style={{
              backgroundColor: 'var(--surface)', borderRadius: '12px',
              border: '1px solid var(--border)', padding: '24px', width: '100%', maxWidth: '320px',
            }}
          >
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: 'var(--text-primary)', marginBottom: '8px' }}>
              END WORKOUT?
            </div>
            <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              Save &amp; Exit keeps your progress so you can resume later. Discard permanently deletes this workout.
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <button
                onClick={() => setShowExitConfirm(false)}
                style={{
                  flex: 1, height: '44px', backgroundColor: 'var(--surface-elevated)',
                  border: '1px solid var(--border)', borderRadius: '8px',
                  color: 'var(--text-primary)', fontFamily: "'DM Sans', sans-serif",
                  fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowExitConfirm(false)
                  router.replace('/log')
                }}
                style={{
                  flex: 1, height: '44px', backgroundColor: 'var(--surface-elevated)',
                  border: '1px solid var(--border)', borderRadius: '8px',
                  color: 'var(--text-primary)', fontFamily: "'DM Sans', sans-serif",
                  fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Save &amp; Exit
              </button>
            </div>
            <button
              onClick={handleDiscard}
              disabled={discarding}
              style={{
                width: '100%', height: '44px', backgroundColor: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px',
                color: 'var(--danger)', fontFamily: "'DM Sans', sans-serif",
                fontSize: '14px', fontWeight: 600,
                cursor: discarding ? 'not-allowed' : 'pointer',
                opacity: discarding ? 0.6 : 1,
              }}
            >
              {discarding ? 'Discarding…' : 'Discard Workout'}
            </button>
          </div>
        </div>
      )}

      {/* Resume toast */}
      {resumeToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 'calc(env(safe-area-inset-top) + 12px)',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--accent)',
            color: 'var(--accent)',
            padding: '10px 16px',
            borderRadius: 'var(--radius-pill, 9999px)',
            fontSize: '13px',
            fontWeight: 500,
            zIndex: 300,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {resumeToast}
        </div>
      )}

      {/* Undo toast */}
      {undoState && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 'calc(160px + env(safe-area-inset-bottom))',
            left: '16px',
            right: '16px',
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 95,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            maxWidth: '480px',
            margin: '0 auto',
          }}
        >
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Logged set {undoState.setNumber}
          </span>
          <button
            onClick={handleUndo}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 700,
              fontSize: '13px',
              letterSpacing: '1px',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            UNDO
          </button>
        </div>
      )}

      {/* Plate calculator */}
      {plateCalcTarget && (
        <PlateCalculator
          initialTarget={plateCalcTarget.current}
          onClose={() => setPlateCalcTarget(null)}
          onApply={w => {
            updateLog(plateCalcTarget.key, 'weight', String(w))
            setPlateCalcTarget(null)
          }}
        />
      )}

      {/* Rest timer */}
      {restTimer.active && restTimer.exerciseId && (
        <RestTimerBar
          exerciseId={restTimer.exerciseId}
          exerciseName={exercises.find(e => e.id === restTimer.exerciseId)?.name ?? ''}
          remainingMs={restTimer.remainingMs}
          durationMs={restTimer.durationMs}
          bottomOffsetPx={92}
          onStop={restTimer.stop}
          onAdd={restTimer.addSeconds}
        />
      )}

      <div className="page page--narrow" style={{ paddingBottom: 'calc(140px + env(safe-area-inset-bottom))', fontFamily: "'DM Sans', sans-serif" }}>

        {/* Header */}
        <div className="wo-sticky-header" style={{
          position: 'sticky', zIndex: 10,
          backgroundColor: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
          padding: '0 16px',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            height: '56px',
          }}>
            <button
              onClick={() => setShowExitConfirm(true)}
              aria-label="Exit workout"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px', marginLeft: '-8px', minWidth: '44px', minHeight: '44px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <h1 style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '22px', color: 'var(--text-primary)', letterSpacing: '1px',
              fontWeight: 'normal',
            }}>
              {dayLabel(day)}
            </h1>

            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '14px', color: 'var(--text-secondary)', minWidth: '50px', textAlign: 'right',
            }}>
              {formatElapsed(elapsed)}
            </span>
          </div>

          {/* Progress bar */}
          <div style={{ height: '4px', backgroundColor: 'var(--border)', marginLeft: '-16px', marginRight: '-16px' }}>
            <div style={{
              height: '100%',
              width: `${progressPercent()}%`,
              backgroundColor: 'var(--accent)',
              transition: 'width 300ms ease',
            }} />
          </div>
        </div>

        {/* Exercise cards */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {exercises.map((ex) => (
            <ExerciseCard
              key={ex.id}
              exercise={ex}
              extraSets={extraSets[ex.id] ?? 0}
              logs={logs}
              previousBest={previousBests[ex.id] ?? null}
              editingKey={editingKey}
              onCheck={handleCheck}
              onUpdate={updateLog}
              onSwap={() => setSwapTarget(ex.id)}
              onSkipSet={handleSkipSet}
              onUnskipSet={handleUnskipSet}
              onSkipExercise={handleSkipExercise}
              onUnskipExercise={handleUnskipExercise}
              onToggleWarmup={toggleWarmup}
              onAddSet={() => handleAddSet(ex.id)}
              onStartEdit={handleStartEdit}
              onSaveEdit={handleSaveEdit}
              onPersistNote={persistSetNote}
              onOpenPlateCalc={(key, current) => setPlateCalcTarget({ key, current })}
            />
          ))}

          {/* Workout note */}
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <label
              htmlFor="workout-note"
              style={{
                fontSize: '10px',
                letterSpacing: 'var(--tracking-label)',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                fontWeight: 500,
              }}
            >
              Workout note
            </label>
            <textarea
              id="workout-note"
              value={workoutNote}
              onChange={e => setWorkoutNote(e.target.value)}
              placeholder="Felt heavy, shoulder tweaked, form notes..."
              rows={2}
              style={{
                backgroundColor: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)',
                fontSize: '14px',
                padding: '10px 12px',
                resize: 'vertical',
                minHeight: '54px',
              }}
            />
          </div>
        </div>
      </div>

      {/* Finish button */}
      <div className="wo-fixed-bar" style={{
        position: 'fixed',
        bottom: 0,
        paddingTop: '12px',
        paddingLeft: '16px',
        paddingRight: '16px',
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
        backgroundColor: 'var(--bg)',
        borderTop: '1px solid var(--border)',
        zIndex: 50,
      }}>
        {(() => {
          const canFinish = checked > 0 && !finishing
          return (
            <button
              onClick={handleFinish}
              disabled={!canFinish}
              style={{
                width: '100%', height: '56px',
                backgroundColor: canFinish ? 'var(--accent)' : 'var(--border)',
                color: canFinish ? 'var(--bg)' : 'var(--text-muted)',
                border: 'none', borderRadius: '12px',
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '22px', letterSpacing: '1px',
                cursor: canFinish ? 'pointer' : 'default',
                transition: 'background-color 150ms ease, color 150ms ease',
              }}
            >
              {finishing ? 'SAVING...' : 'FINISH WORKOUT'}
            </button>
          )
        })()}
        <div style={{ textAlign: 'center', marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
          {skipped > 0
            ? `${checked} done · ${skipped} skipped · ${total} total`
            : `${checked} / ${total} sets`}
        </div>
      </div>
    </>
  )
}

// ─── Exercise Card ─────────────────────────────────────────────────────────────

interface ExerciseCardProps {
  exercise: Exercise
  extraSets: number
  logs: LogMap
  previousBest: number | null
  editingKey: string | null
  onCheck: (exerciseId: string, setNumber: number) => void
  onUpdate: (key: string, field: 'weight' | 'reps' | 'note', value: string) => void
  onSwap: () => void
  onSkipSet: (exerciseId: string, setNumber: number) => void
  onUnskipSet: (exerciseId: string, setNumber: number) => void
  onSkipExercise: (exerciseId: string) => void
  onUnskipExercise: (exerciseId: string) => void
  onToggleWarmup: (exerciseId: string, setNumber: number) => void
  onAddSet: () => void
  onStartEdit: (key: string) => void
  onSaveEdit: (exerciseId: string, setNumber: number) => void
  onPersistNote: (exerciseId: string, setNumber: number) => void
  onOpenPlateCalc: (key: string, current: number) => void
}

function ExerciseCard({
  exercise, extraSets, logs, previousBest, editingKey,
  onCheck, onUpdate, onSwap,
  onSkipSet, onUnskipSet,
  onSkipExercise, onUnskipExercise,
  onToggleWarmup, onAddSet, onStartEdit, onSaveEdit, onPersistNote,
  onOpenPlateCalc,
}: ExerciseCardProps) {
  const { unitLabel, fmt, toDisplay } = useUnit()
  const totalSets = exercise.sets_target + extraSets
  const setNumbers = Array.from({ length: totalSets }, (_, i) => i + 1)
  const anySkipped = setNumbers.some(s => logs[`${exercise.id}-${s}`]?.skipped)
  const allSkipped = setNumbers.every(s => logs[`${exercise.id}-${s}`]?.skipped)

  return (
    <div style={{
      backgroundColor: 'var(--surface)',
      border: `1px solid ${anySkipped ? 'rgba(239,68,68,0.2)' : 'var(--border)'}`,
      borderRadius: '12px',
      overflow: 'hidden',
      opacity: allSkipped ? 0.65 : 1,
      transition: 'opacity 150ms ease, border-color 150ms ease',
    }}>
      <div style={{ padding: '14px 16px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '16px', fontWeight: 700,
              color: allSkipped ? 'var(--text-muted)' : 'var(--text-primary)',
              textDecoration: allSkipped ? 'line-through' : 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {exercise.name}
            </div>
            {allSkipped && (
              <span style={{
                fontSize: '10px',
                color: 'var(--danger)',
                backgroundColor: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: '9999px',
                padding: '1px 6px',
                fontFamily: "'Bebas Neue', sans-serif",
                letterSpacing: '0.5px',
                flexShrink: 0,
              }}>
                SKIPPED
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            {/* Skip/Undo exercise button */}
            <button
              onClick={() => allSkipped ? onUnskipExercise(exercise.id) : onSkipExercise(exercise.id)}
              title={allSkipped ? 'Undo skip' : 'Skip exercise'}
              aria-label={allSkipped ? `Undo skip on ${exercise.name}` : `Skip ${exercise.name}`}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '2px 6px', opacity: 0.5,
                display: 'flex', alignItems: 'center', gap: '3px',
                borderRadius: '4px',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
            >
              {allSkipped ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
                  <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.37"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                  <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                </svg>
              )}
              <span style={{
                fontSize: '10px',
                color: allSkipped ? 'var(--accent)' : 'var(--text-secondary)',
                fontFamily: "'Bebas Neue', sans-serif",
                letterSpacing: '0.5px',
              }}>
                {allSkipped ? 'UNDO' : 'SKIP'}
              </span>
            </button>

            {/* Swap button */}
            <button
              onClick={onSwap}
              title="Swap exercise"
              aria-label={`Swap ${exercise.name} for another exercise`}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '2px', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: 0.5,
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {exercise.sets_target} sets × {exercise.reps_target} reps
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
            {previousBest !== null ? `prev: ${fmt(previousBest)} ${unitLabel}` : 'no previous data'}
          </span>
        </div>
      </div>

      <div style={{ height: '1px', backgroundColor: 'var(--border)' }} />

      <div style={{ padding: '8px 0' }}>
        {setNumbers.map((setNum) => {
          const key = `${exercise.id}-${setNum}`
          const logEntry = logs[key] ?? {
            weight: '', reps: '', checked: false, skipped: false, isPR: false,
            isWarmup: false, note: '',
          }
          const isBonus = setNum > exercise.sets_target
          const editing = editingKey === key
          return (
            <SetRow
              key={key}
              setNumber={setNum}
              isBonus={isBonus}
              editing={editing}
              logEntry={logEntry}
              onCheck={() => onCheck(exercise.id, setNum)}
              onSaveEdit={() => onSaveEdit(exercise.id, setNum)}
              onStartEdit={() => onStartEdit(key)}
              onWeightChange={(v) => onUpdate(key, 'weight', v)}
              onRepsChange={(v) => onUpdate(key, 'reps', v)}
              onNoteChange={(v) => onUpdate(key, 'note', v)}
              onNoteBlur={() => onPersistNote(exercise.id, setNum)}
              onToggleWarmup={() => onToggleWarmup(exercise.id, setNum)}
              onSkip={() => onSkipSet(exercise.id, setNum)}
              onUnskip={() => onUnskipSet(exercise.id, setNum)}
              onOpenPlateCalc={() => {
                // logEntry.weight is canonical lbs; open the calculator on the displayed value.
                const cur = logEntry.weight !== '' ? parseFloat(logEntry.weight) : NaN
                onOpenPlateCalc(key, Number.isFinite(cur) ? toDisplay(cur) : 0)
              }}
            />
          )
        })}

        <div style={{ padding: '6px 16px 4px' }}>
          <button
            onClick={onAddSet}
            aria-label={`Add another set to ${exercise.name}`}
            style={{
              width: '100%',
              height: '40px',
              backgroundColor: 'transparent',
              border: '1px dashed var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-sans)',
              fontSize: '13px',
              fontWeight: 600,
              letterSpacing: '0.5px',
              cursor: 'pointer',
              transition: 'border-color 150ms ease, color 150ms ease',
            }}
          >
            + ADD SET
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Exercise Swap Modal ───────────────────────────────────────────────────────

interface ExerciseSwapModalProps {
  currentExerciseId: string
  allExercises: Exercise[]
  currentExercises: Exercise[]
  onSelect: (exercise: Exercise) => void
  onClose: () => void
}

function ExerciseSwapModal({ currentExerciseId, allExercises, currentExercises, onSelect, onClose }: ExerciseSwapModalProps) {
  const [query, setQuery] = useState('')

  const available = allExercises.filter(
    ex => ex.id === currentExerciseId || !currentExercises.find(ce => ce.id === ex.id)
  )
  const q = query.trim().toLowerCase()
  const filtered = q ? available.filter(ex => ex.name.toLowerCase().includes(q)) : available

  const dayTypes = [...new Set(filtered.map(e => e.day_type))].sort()
  const grouped: Record<string, Exercise[]> = {}
  for (const dt of dayTypes) {
    grouped[dt] = filtered.filter(e => e.day_type === dt)
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)',
        zIndex: 300, display: 'flex', alignItems: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', backgroundColor: 'var(--surface)',
          borderRadius: '16px 16px 0 0',
          maxHeight: '72vh', display: 'flex', flexDirection: 'column',
          border: '1px solid var(--border)', borderBottom: 'none',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 16px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: 'var(--text-primary)', letterSpacing: '1px', fontWeight: 'normal' }}>
            SWAP EXERCISE
          </h2>
          <button
            onClick={onClose}
            aria-label="Close swap dialog"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              width: '44px', height: '44px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search exercises..."
            aria-label="Search exercises"
            autoFocus
            style={{
              width: '100%',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
              fontSize: '14px',
              padding: '10px 12px',
              outline: 'none',
            }}
          />
        </div>

        {/* List */}
        <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {dayTypes.length === 0 && (
            <div style={{ padding: '24px 16px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
              No matches.
            </div>
          )}
          {dayTypes.map(dayType => {
            const exs = grouped[dayType]
            if (!exs || exs.length === 0) return null
            return (
              <div key={dayType}>
                <div style={{
                  padding: '12px 16px 6px',
                  fontSize: '10px', color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '1.5px',
                }}>
                  {dayType.replace(/-/g, ' ').toUpperCase()}
                </div>
                {exs.map(ex => {
                  const isCurrent = ex.id === currentExerciseId
                  return (
                    <button
                      key={ex.id}
                      onClick={() => !isCurrent && onSelect(ex)}
                      style={{
                        width: '100%', textAlign: 'left',
                        background: isCurrent ? 'rgba(200, 241, 53, 0.05)' : 'none',
                        border: 'none',
                        borderBottom: '1px solid var(--border)',
                        padding: '14px 16px',
                        cursor: isCurrent ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: '12px',
                      }}
                    >
                      <div>
                        <div style={{
                          fontSize: '15px', fontWeight: 600,
                          color: isCurrent ? 'var(--accent)' : 'var(--text-primary)',
                          fontFamily: "'DM Sans', sans-serif",
                          marginBottom: '2px',
                        }}>
                          {ex.name}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>
                          {ex.sets_target} sets × {ex.reps_target} reps
                        </div>
                      </div>
                      {isCurrent && (
                        <span style={{
                          fontSize: '10px', color: 'var(--accent)',
                          backgroundColor: 'rgba(200, 241, 53, 0.1)',
                          border: '1px solid rgba(200, 241, 53, 0.25)',
                          borderRadius: '9999px', padding: '2px 8px',
                          fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                          flexShrink: 0,
                        }}>
                          CURRENT
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Set Row ───────────────────────────────────────────────────────────────────

interface SetRowProps {
  setNumber: number
  isBonus: boolean
  editing: boolean
  logEntry: SetState
  onCheck: () => void
  onSaveEdit: () => void
  onStartEdit: () => void
  onWeightChange: (v: string) => void
  onRepsChange: (v: string) => void
  onNoteChange: (v: string) => void
  onNoteBlur: () => void
  onToggleWarmup: () => void
  onSkip: () => void
  onUnskip: () => void
  onOpenPlateCalc: () => void
}

function SetRow({
  setNumber, isBonus, editing,
  logEntry,
  onCheck, onSaveEdit, onStartEdit,
  onWeightChange, onRepsChange, onNoteChange, onNoteBlur,
  onToggleWarmup, onSkip, onUnskip, onOpenPlateCalc,
}: SetRowProps) {
  const { toDisplay, fromDisplay, fmt } = useUnit()
  const [justChecked, setJustChecked] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  // logEntry.weight is stored canonically in lbs. We show it in the active display unit.
  // While the field is focused we keep the raw typed string in `rawWeight` so the user can
  // type freely (decimals, partial entries) without conversion fighting the keystrokes; on
  // blur we drop the buffer and the field re-derives from canonical state.
  const [rawWeight, setRawWeight] = useState<string | null>(null)
  const weightRef = useRef<HTMLInputElement>(null)
  const repsRef = useRef<HTMLInputElement>(null)
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)

  // Editable when not yet checked, OR currently in the edit window.
  const inputsDisabled = (logEntry.checked && !editing) || logEntry.skipped

  function handleCheck() {
    if (logEntry.checked) return
    setJustChecked(true)
    setTimeout(() => setJustChecked(false), 300)
    onCheck()
  }

  function handleRowLongPressStart() {
    longPressTimer.current = setTimeout(() => {
      setNoteOpen(true)
    }, 500)
  }
  function handleRowLongPressEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const displayWeight = rawWeight ?? (logEntry.weight === '' ? '' : fmt(parseFloat(logEntry.weight)))

  function handleWeightChange(v: string) {
    setRawWeight(v)
    if (v === '') { onWeightChange(''); return }
    const n = parseFloat(v)
    // Commit to canonical lbs on every keystroke (when parseable) so parent state — which
    // drives the check action, PR detection and saving — never lags behind the input.
    if (Number.isFinite(n)) onWeightChange(String(fromDisplay(n)))
  }

  function handleWeightKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      repsRef.current?.focus()
    }
  }
  function handleRepsKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (editing) onSaveEdit()
      else handleCheck()
    }
  }

  return (
    <div
      style={{
        opacity: logEntry.skipped ? 0.55 : logEntry.checked && !editing ? 0.75 : 1,
        transition: 'opacity 150ms ease',
        backgroundColor: editing ? 'rgba(200,241,53,0.05)' : 'transparent',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px' }}
        onMouseDown={handleRowLongPressStart}
        onMouseUp={handleRowLongPressEnd}
        onMouseLeave={handleRowLongPressEnd}
        onTouchStart={handleRowLongPressStart}
        onTouchEnd={handleRowLongPressEnd}
        onTouchCancel={handleRowLongPressEnd}
      >
        <span style={{
          fontSize: '12px',
          color: isBonus ? 'var(--accent-dim)' : 'var(--text-muted)',
          fontFamily: "'DM Sans', sans-serif",
          minWidth: '38px', fontWeight: 500,
          textDecoration: logEntry.skipped ? 'line-through' : 'none',
        }}>
          {isBonus ? `+${setNumber - 1}` : `SET ${setNumber}`}
        </span>

        {/* Warm-up toggle */}
        <button
          onClick={onToggleWarmup}
          disabled={logEntry.checked && !editing}
          aria-pressed={logEntry.isWarmup}
          aria-label={logEntry.isWarmup ? `Unmark set ${setNumber} as warm-up` : `Mark set ${setNumber} as warm-up`}
          title={logEntry.isWarmup ? 'Warm-up set' : 'Mark as warm-up'}
          style={{
            width: '28px', height: '28px',
            borderRadius: '999px',
            border: `1px solid ${logEntry.isWarmup ? 'var(--accent-dim)' : 'var(--border)'}`,
            backgroundColor: logEntry.isWarmup ? 'rgba(143, 170, 36, 0.18)' : 'transparent',
            color: logEntry.isWarmup ? 'var(--accent-dim)' : 'var(--text-muted)',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '11px',
            fontWeight: 700,
            cursor: (logEntry.checked && !editing) ? 'default' : 'pointer',
            flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          W
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 }}>
          <input
            ref={weightRef}
            type="number"
            inputMode="decimal"
            value={displayWeight}
            onChange={e => handleWeightChange(e.target.value)}
            onFocus={e => e.target.select()}
            onBlur={() => setRawWeight(null)}
            onKeyDown={handleWeightKeyDown}
            disabled={inputsDisabled}
            placeholder="0"
            aria-label={`Weight for set ${setNumber}`}
            style={{
              width: '68px', height: '40px',
              backgroundColor: 'var(--surface-elevated)',
              border: `1px solid ${inputsDisabled ? 'var(--border)' : 'var(--border-strong)'}`,
              borderRadius: '8px',
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '16px',
              textAlign: 'center',
              outline: 'none',
            }}
          />
          <button
            onClick={onOpenPlateCalc}
            aria-label="Open plate calculator"
            title="Plate calculator"
            disabled={inputsDisabled}
            style={{
              width: '28px', height: '28px',
              backgroundColor: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: inputsDisabled ? 'default' : 'pointer',
              padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="18" rx="1" />
              <line x1="6" y1="8" x2="6" y2="16" />
              <line x1="18" y1="8" x2="18" y2="16" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            ref={repsRef}
            type="number"
            inputMode="numeric"
            value={logEntry.reps}
            onChange={e => onRepsChange(e.target.value)}
            onFocus={e => e.target.select()}
            onKeyDown={handleRepsKeyDown}
            disabled={inputsDisabled}
            placeholder="0"
            aria-label={`Reps for set ${setNumber}`}
            style={{
              width: '52px', height: '40px',
              backgroundColor: 'var(--surface-elevated)',
              border: `1px solid ${inputsDisabled ? 'var(--border)' : 'var(--border-strong)'}`,
              borderRadius: '8px',
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '16px',
              textAlign: 'center',
              outline: 'none',
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>reps</span>
        </div>

        {logEntry.isPR && (
          <span style={{
            fontSize: '10px', fontFamily: "'Bebas Neue', sans-serif",
            color: 'var(--accent)',
            backgroundColor: 'rgba(200, 241, 53, 0.1)',
            border: '1px solid rgba(200, 241, 53, 0.3)',
            borderRadius: '9999px', padding: '2px 7px',
            letterSpacing: '0.5px',
          }}>
            PR
          </span>
        )}

        {/* Skip / unskip set button */}
        <button
          onClick={logEntry.skipped ? onUnskip : (logEntry.checked ? undefined : onSkip)}
          disabled={logEntry.checked}
          title={logEntry.skipped ? 'Undo skip' : 'Skip this set'}
          aria-label={logEntry.skipped ? `Undo skip on set ${setNumber}` : `Skip set ${setNumber}`}
          style={{
            width: '44px', height: '44px', minWidth: '44px',
            borderRadius: '9999px',
            border: `2px solid ${logEntry.skipped ? 'rgba(239,68,68,0.5)' : 'var(--border)'}`,
            backgroundColor: logEntry.skipped ? 'rgba(239,68,68,0.1)' : 'transparent',
            cursor: logEntry.checked ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            transition: 'border-color 150ms ease, background-color 150ms ease',
            opacity: logEntry.checked ? 0.3 : 1,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
           style={{ color: logEntry.skipped ? 'var(--danger)' : 'var(--border-strong)' }}>
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        {/* Check / Save button */}
        {editing ? (
          <button
            onClick={onSaveEdit}
            aria-label={`Save set ${setNumber}`}
            style={{
              height: '44px',
              padding: '0 14px',
              borderRadius: 'var(--radius-pill, 9999px)',
              border: 'none',
              backgroundColor: 'var(--accent)',
              color: 'var(--bg)',
              fontFamily: 'var(--font-sans)',
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '1px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            SAVE
          </button>
        ) : (
          <button
            onClick={logEntry.checked ? onStartEdit : handleCheck}
            disabled={logEntry.skipped}
            aria-label={
              logEntry.checked
                ? `Edit set ${setNumber}`
                : `Mark set ${setNumber} complete`
            }
            aria-pressed={logEntry.checked}
            style={{
              width: '44px', height: '44px', minWidth: '44px',
              borderRadius: '9999px',
              border: `2px solid ${logEntry.checked ? 'var(--accent)' : 'var(--border-strong)'}`,
              backgroundColor: logEntry.checked ? 'rgba(200, 241, 53, 0.12)' : 'transparent',
              cursor: logEntry.skipped ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transform: justChecked ? 'scale(1.2)' : 'scale(1)',
              transition: 'transform 200ms ease, border-color 150ms ease, background-color 150ms ease',
              flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
             style={{ color: logEntry.checked ? 'var(--accent)' : 'var(--text-muted)' }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        )}
      </div>

      {(noteOpen || logEntry.note) && (
        <div style={{ padding: '0 16px 8px' }}>
          <input
            type="text"
            value={logEntry.note}
            onChange={e => onNoteChange(e.target.value)}
            onBlur={() => {
              // Persist to DB if the row is already saved (otherwise the next
              // check/save will flush the note via upsert).
              if (logEntry.checked) onNoteBlur()
              if (!logEntry.note) setNoteOpen(false)
            }}
            placeholder="Set note (form, feel...)"
            aria-label={`Note for set ${setNumber}`}
            style={{
              width: '100%',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
              fontSize: '13px',
              padding: '6px 10px',
              outline: 'none',
            }}
          />
        </div>
      )}
    </div>
  )
}
