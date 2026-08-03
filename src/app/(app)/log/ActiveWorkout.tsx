'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Exercise } from '@/lib/types'
import { checkAndAwardBadges, ALL_BADGES, type BadgeDefinition } from '@/lib/utils/badges'
import BadgeUnlockOverlay from '@/components/BadgeUnlockOverlay'
import { localDateKey } from '@/lib/utils/formatting'
import { haptic } from '@/lib/utils/haptics'
import { useUnit } from '@/lib/contexts/UnitContext'
import { deleteIncompleteSessions } from '@/lib/utils/sessions'
import { advanceIndex, effectiveSequence } from '@/lib/utils/rotation'
import type { UserRotation, UserStats, CompleteSessionResult } from '@/lib/types'
import { useRestTimer } from '@/lib/hooks/useRestTimer'
import { useKeyboardInset } from '@/lib/hooks/useKeyboardInset'
import { useExitingValue } from '@/lib/hooks/useExitingValue'
import RestTimerBar from '@/components/RestTimerBar'
import PlateCalculator from '@/components/PlateCalculator'
import CompletionModal from './CompletionModal'
import { useFeatureTooltip } from '@/components/onboarding/useFeatureTooltip'
import { onboardTarget } from '@/components/onboarding/anchor'
import { useOnboarding } from '@/lib/contexts/OnboardingContext'

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
  prExercises: { name: string; weight: number; reps: number }[]
  duration: number
  setsCompleted: number
  currentStreak: number
  isNewBestStreak: boolean
}

export interface FinishUndoToken {
  sessionId: string
  day: string
  userId: string
  xpEarned: number
  /**
   * Rotation pointer to restore. Stats are NOT stored here anymore: undo calls
   * `uncomplete_session`, which reopens the session and lets the server
   * re-derive every stat from the logs. Storing "previous XP" client-side was
   * how a replayed or tampered undo token could mint XP out of nothing.
   */
  prevRotationIndex: number
  expiresAt: number
}

function dayLabel(day: string): string {
  return day.replace(/-/g, ' ').toUpperCase() + ' DAY'
}

/**
 * Run a Supabase query with a few retries so a transient mobile-network blip —
 * or an access-token refresh mid-workout (tokens expire after ~60 min, which is
 * shorter than a long session) — doesn't fail an otherwise-valid save. Retries
 * on both a thrown fetch error and a returned `{ error }`, with exponential
 * backoff. The second attempt also gives the Supabase client a beat to refresh a
 * just-expired token and recover on its own. Only pass idempotent operations
 * (update-by-id / upsert / select) so re-running a partially-applied attempt is
 * safe.
 */
async function runWithRetry<R extends { error: unknown }>(
  op: () => PromiseLike<R>,
  attempts = 3,
): Promise<R> {
  let result: R | undefined
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      result = await op()
      if (!result.error) return result
    } catch (err) {
      result = { error: err } as R
    }
    if (attempt < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt))
    }
  }
  return result as R
}

export default function ActiveWorkout({ day }: { day: string }) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [logs, setLogs] = useState<LogMap>({})
  // `previousBests` is the best WEIGHT on record per exercise — display/prefill
  // only now (the "prev: X lbs" hint and the weight input's starting value).
  // `previousBestVolumes` is the live "bar to beat" for PR detection: best
  // weight x reps on record, which is what actually decides is_pr (mirrors the
  // server's grind_recompute_stats — see docs/sql/15-volume-based-prs.sql).
  // Both start as the prior-session best (from DB) and advance within this
  // workout as sets are logged. `baselineBests`/`baselineBestVolumes` keep the
  // original DB values so we can recompute the live bests when sets are
  // edited or undone.
  const [previousBests, setPreviousBests] = useState<PreviousBest>({})
  const [baselineBests, setBaselineBests] = useState<PreviousBest>({})
  const [previousBestVolumes, setPreviousBestVolumes] = useState<PreviousBest>({})
  const [baselineBestVolumes, setBaselineBestVolumes] = useState<PreviousBest>({})
  const [startedAt, setStartedAt] = useState<Date>(new Date())
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [completionData, setCompletionData] = useState<CompletionData | null>(null)
  // Non-null right after a finish that earned badges — shown before
  // CompletionModal (which is already queued in completionData underneath).
  const [badgeUnlock, setBadgeUnlock] = useState<BadgeDefinition[] | null>(null)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [allExercises, setAllExercises] = useState<Exercise[]>([])
  const [swapTarget, setSwapTarget] = useState<string | null>(null)
  const [extraSets, setExtraSets] = useState<Record<string, number>>({})
  const [workoutNote, setWorkoutNote] = useState('')
  const [undoState, setUndoState] = useState<UndoState | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [resumeToast, setResumeToast] = useState<string | null>(null)
  // Passive "X saved" confirmation, anchored at the bottom. Distinct from the
  // top undo toast (which is actionable): this one just reassures the user that
  // an edit/note/swap actually persisted, then fades on its own.
  const [saveToast, setSaveToast] = useState<string | null>(null)
  const saveToastTimer = useRef<NodeJS.Timeout | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [plateCalcTarget, setPlateCalcTarget] = useState<{ key: string; current: number } | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const restTimer = useRestTimer()
  const keyboardInset = useKeyboardInset()
  // Keep each toast's last content around through its exit animation instead
  // of yanking it off screen the instant its owning state clears.
  const undoToastExit = useExitingValue(undoState, 200)
  const resumeToastExit = useExitingValue(resumeToast, 200)
  const saveToastExit = useExitingValue(saveToast, 180)
  const { hasSeenTooltip, markTooltipSeen } = useOnboarding()

  /**
   * Flash a short bottom-anchored "saved" confirmation. Re-flashing resets the
   * timer so rapid edits don't leave a stale message lingering.
   */
  const showSaveToast = useCallback((msg: string) => {
    setSaveToast(msg)
    if (saveToastTimer.current) clearTimeout(saveToastTimer.current)
    saveToastTimer.current = setTimeout(() => setSaveToast(null), 1900)
  }, [])

  // Clear the pending save-toast timer on unmount so it can't fire into a
  // torn-down component.
  useEffect(() => () => { if (saveToastTimer.current) clearTimeout(saveToastTimer.current) }, [])
  // handleCheck reads this after an `await`, by which point another set may have
  // been checked (and re-rendered) in the meantime — the `logs` captured in its
  // own closure would be stale. The ref always reflects the latest committed state.
  const logsRef = useRef<LogMap>(logs)
  useEffect(() => { logsRef.current = logs }, [logs])

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000))
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [startedAt])

  // Auto-clear undo state when the 5s window expires.
  useEffect(() => {
    if (!undoState) return
    const remaining = undoState.expiresAt - Date.now()
    if (remaining <= 0) {
      // Already expired on (re)mount — clear immediately rather than scheduling.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const initSession = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: allDayExs } = await supabase
      .from('exercises')
      .select('*')
      .eq('day_type', day)
      .order('sort_order', { ascending: true })

    if (!allDayExs || allDayExs.length === 0) { setLoading(false); return }

    const { data: allExsData } = await supabase
      .from('exercises')
      .select('*')
      .order('day_type', { ascending: true })
      .order('sort_order', { ascending: true })
    setAllExercises(allExsData ?? [])

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    // Disabled exercises (17-exercise-active-flag.sql) don't offer for a
    // fresh workout — but if this resuming session already logged sets against
    // it they stay visible. Resume is resolved atomically below, so we may not
    // know yet which exercises have logs: filter inactive only for a blank slate
    // after the session payload returns, or keep all active here and re-filter.
    let exs = allDayExs.filter(ex => ex.active)

    if (exs.length === 0) {
      // Fallback: if every exercise is inactive, still allow them so a user in
      // a mid-session with only disabled rows isn't stranded.
      exs = allDayExs
    }
    if (exs.length === 0) { setLoading(false); return }
    setExercises(exs)

    // One batch RPC for previous bests — was N sequential queries (one per exercise).
    const bests: PreviousBest = {}
    const bestVolumes: PreviousBest = {}
    const exerciseIds = exs.map(e => e.id)
    if (exerciseIds.length > 0) {
      const { data: bestRows } = await supabase.rpc('get_exercise_bests', {
        p_exercise_ids: exerciseIds,
      })
      for (const row of (bestRows ?? []) as {
        exercise_id: string
        max_weight: number | null
        max_volume: number | null
      }[]) {
        bests[row.exercise_id] = row.max_weight
        bestVolumes[row.exercise_id] = row.max_volume
      }
    }
    for (const ex of exs) {
      if (!(ex.id in bests)) bests[ex.id] = null
      if (!(ex.id in bestVolumes)) bestVolumes[ex.id] = null
    }
    setPreviousBests(bests)
    setBaselineBests(bests)
    setPreviousBestVolumes(bestVolumes)
    setBaselineBestVolumes(bestVolumes)

    type ExistingLog = {
      id: string
      exercise_id: string
      set_number: number
      weight: number | null
      reps: number | null
      is_pr: boolean
      is_warmup?: boolean
      note?: string | null
      is_skipped?: boolean
    }

    // Atomic create-or-resume — prevents two tabs from forking open sessions.
    const { data: resumeData, error: resumeError } = await supabase.rpc(
      'start_or_resume_session',
      { p_day_type: day },
    )

    if (resumeError || !resumeData) {
      setLoading(false)
      setResumeToast('Could not start workout. Check your connection and try again.')
      setTimeout(() => setResumeToast(null), 4000)
      return
    }

    const resumePayload = resumeData as {
      session: {
        id: string
        started_at: string
        note?: string | null
      }
      logs: ExistingLog[]
      resumed?: boolean
    }

    const session = resumePayload.session
    const sid = session.id
    const sessionStart = new Date(session.started_at)
    if (session.note) setWorkoutNote(session.note)
    const existingLogs: ExistingLog[] = Array.isArray(resumePayload.logs)
      ? resumePayload.logs
      : []

    // Re-include disabled exercises that already have logs on this session.
    const loggedExerciseIds = new Set(existingLogs.map(l => l.exercise_id))
    const fullExs = allDayExs.filter(ex => ex.active || loggedExerciseIds.has(ex.id))
    if (fullExs.length > 0 && fullExs.length !== exs.length) {
      exs = fullExs
      setExercises(exs)
    }

    if (existingLogs.length > 0 || resumePayload.resumed) {
      // Count extras per exercise from highest set_number seen.
      const extras: Record<string, number> = {}
      for (const log of existingLogs) {
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
      for (const log of existingLogs) {
        const key = `${log.exercise_id}-${log.set_number}`
        restored[key] = log.is_skipped
          ? { ...restored[key], checked: false, skipped: true, isPR: false, logId: log.id }
          : {
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
  }, [day, supabase, router])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { initSession() }, [initSession])

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

  /** Same as bestFromLogs, but the live PR bar: best weight x reps (volume). */
  function bestVolumeFromLogs(exerciseId: string, logsMap: LogMap): number | null {
    let best = baselineBestVolumes[exerciseId] ?? null
    for (const key of Object.keys(logsMap)) {
      if (!key.startsWith(`${exerciseId}-`)) continue
      const e = logsMap[key]
      if (!e.checked || e.isWarmup || e.skipped) continue
      if (e.weight === '' || e.reps === '') continue
      const w = parseFloat(e.weight)
      const r = parseInt(e.reps)
      if (!Number.isFinite(w) || !Number.isFinite(r)) continue
      const volume = w * r
      if (best === null || volume > best) best = volume
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
      // Allow toggling on an unsaved set, OR on a saved set that's currently
      // being edited. Block it only for saved sets not in the edit window —
      // otherwise re-opening a logged set to edit it left warm-up stuck.
      if (!cur || (cur.checked && editingKey !== key)) return prev
      return { ...prev, [key]: { ...cur, isWarmup: !cur.isWarmup } }
    })
  }

  async function handleCheck(exerciseId: string, setNumber: number) {
    const key = `${exerciseId}-${setNumber}`
    const logEntry = logs[key]
    if (!logEntry || !sessionId || logEntry.checked) return

    const weight = logEntry.weight !== '' ? parseFloat(logEntry.weight) : null

    // If reps not entered, carry forward the previous set's reps
    let repsStr = logEntry.reps
    if (repsStr === '' && setNumber > 1) {
      const prevReps = logs[`${exerciseId}-${setNumber - 1}`]?.reps
      if (prevReps && prevReps !== '') repsStr = prevReps
    }
    // No reps and nothing to copy from — require the user to fill it in
    if (repsStr === '') return
    const reps = parseInt(repsStr)

    const prevBestVolume = previousBestVolumes[exerciseId]
    const volume = weight !== null ? weight * reps : null
    const isPR =
      !logEntry.isWarmup &&
      volume !== null &&
      prevBestVolume !== null &&
      volume > prevBestVolume

    const { data: saved, error: saveError } = await runWithRetry(() =>
      supabase
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
            is_skipped: false,
          },
          { onConflict: 'session_id,exercise_id,set_number' },
        )
        .select('id')
        .maybeSingle(),
    )

    // If the set couldn't be persisted, don't mark it checked — that would show
    // a saved-looking set the DB never received, and it would silently vanish on
    // resume. Surface it so the user can tap again once the connection recovers.
    if (saveError) {
      setResumeToast('Could not save set. Check your connection and try again.')
      setTimeout(() => setResumeToast(null), 4000)
      return
    }

    setLogs(prev => ({
      ...prev,
      [key]: { ...prev[key], reps: repsStr, checked: true, skipped: false, isPR, logId: saved?.id },
    }))

    if (isPR && weight !== null && volume !== null) {
      setPreviousBestVolumes(prev => ({ ...prev, [exerciseId]: volume }))
      // The weight-only "prev" display should only ever rise to an actual
      // heavier weight — a volume PR at a lower weight (more reps) shouldn't
      // knock the displayed reference weight down.
      setPreviousBests(prev => {
        const cur = prev[exerciseId] ?? null
        return cur !== null && cur >= weight ? prev : { ...prev, [exerciseId]: weight }
      })
      haptic('success')
    } else {
      haptic('light')
    }

    setUndoState({ key, exerciseId, setNumber, expiresAt: Date.now() + 5000 })

    // Don't start a rest countdown when this check completes the whole workout —
    // there's nothing left to rest for. Read from the ref (latest committed state)
    // rather than the `logs` closed over at call time — another set may have been
    // checked while this one's upsert was in flight above. The pre-check state
    // still needs the just-checked key treated as processed when projecting completion.
    const willAllBeProcessed =
      totalSets() > 0 &&
      Object.entries(logsRef.current).every(([k, l]) => (k === key ? true : l.checked || l.skipped))

    if (!logEntry.isWarmup && !willAllBeProcessed) {
      restTimer.start(exerciseId)
    }
  }

  async function handleUndo() {
    if (!undoState || !sessionId) return
    const { key, exerciseId, setNumber } = undoState
    const previous = logs[key]
    setUndoState(null)
    restTimer.stop()

    const { error } = await supabase
      .from('session_logs')
      .delete()
      .eq('session_id', sessionId)
      .eq('exercise_id', exerciseId)
      .eq('set_number', setNumber)

    if (error) {
      setResumeToast('Could not undo set. Check your connection and try again.')
      setTimeout(() => setResumeToast(null), 4000)
      return
    }

    setLogs(prev => {
      const cur = prev[key] ?? previous
      if (!cur) return prev
      const next = { ...prev, [key]: { ...cur, checked: false, isPR: false, logId: undefined } }
      setPreviousBests(pb => ({ ...pb, [exerciseId]: bestFromLogs(exerciseId, next) }))
      setPreviousBestVolumes(pb => ({ ...pb, [exerciseId]: bestVolumeFromLogs(exerciseId, next) }))
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

    const prevBestVolume = previousBestVolumes[exerciseId]
    const volume = weight !== null && reps !== null ? weight * reps : null
    const isPR =
      !logEntry.isWarmup &&
      volume !== null &&
      prevBestVolume !== null &&
      volume > prevBestVolume

    const { error } = await supabase.from('session_logs').upsert(
      {
        session_id: sessionId,
        exercise_id: exerciseId,
        set_number: setNumber,
        weight,
        reps,
        is_pr: isPR,
        is_warmup: logEntry.isWarmup,
        note: logEntry.note || null,
        is_skipped: false,
      },
      { onConflict: 'session_id,exercise_id,set_number' },
    )

    if (error) {
      setResumeToast('Could not save set. Check your connection and try again.')
      setTimeout(() => setResumeToast(null), 4000)
      return
    }

    setLogs(prev => {
      const next = { ...prev, [key]: { ...prev[key], isPR } }
      setPreviousBests(pb => ({ ...pb, [exerciseId]: bestFromLogs(exerciseId, next) }))
      setPreviousBestVolumes(pb => ({ ...pb, [exerciseId]: bestVolumeFromLogs(exerciseId, next) }))
      return next
    })
    setEditingKey(null)
    haptic('medium')
    showSaveToast(`Set ${setNumber} saved`)
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
    const { error } = await supabase
      .from('session_logs')
      .update({ note: logEntry.note || null })
      .eq('session_id', sessionId)
      .eq('exercise_id', exerciseId)
      .eq('set_number', setNumber)
    if (!error) showSaveToast(logEntry.note ? 'Note saved' : 'Note cleared')
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
    showSaveToast('Set added')
  }

  /**
   * Remove an added (bonus) set entirely — as opposed to skipping, which keeps
   * the slot but marks it not-done. Only valid for sets beyond sets_target.
   * Any bonus sets after the deleted one are shifted down by one so the
   * remaining sets stay contiguous (set_number 1..total, no gaps).
   */
  async function handleDeleteSet(exerciseId: string, setNumber: number) {
    const ex = exercises.find(e => e.id === exerciseId)
    if (!ex) return
    const currentExtras = extraSets[exerciseId] ?? 0
    const total = ex.sets_target + currentExtras
    if (setNumber <= ex.sets_target || setNumber > total) return

    if (sessionId) {
      await supabase
        .from('session_logs')
        .delete()
        .eq('session_id', sessionId)
        .eq('exercise_id', exerciseId)
        .eq('set_number', setNumber)
      // Shift every later bonus set's DB row down by one to fill the gap.
      for (let s = setNumber; s < total; s++) {
        await supabase
          .from('session_logs')
          .update({ set_number: s })
          .eq('session_id', sessionId)
          .eq('exercise_id', exerciseId)
          .eq('set_number', s + 1)
      }
    }

    setLogs(prev => {
      const next = { ...prev }
      for (let s = setNumber; s < total; s++) {
        const laterKey = `${exerciseId}-${s + 1}`
        if (next[laterKey]) next[`${exerciseId}-${s}`] = next[laterKey]
      }
      delete next[`${exerciseId}-${total}`]
      // The deleted set may have held the live PR — recompute the bests.
      setPreviousBests(pb => ({ ...pb, [exerciseId]: bestFromLogs(exerciseId, next) }))
      setPreviousBestVolumes(pb => ({ ...pb, [exerciseId]: bestVolumeFromLogs(exerciseId, next) }))
      return next
    })
    setExtraSets(prev => ({ ...prev, [exerciseId]: currentExtras - 1 }))
    // The shift above moves every later set's data down one slot, so an in-progress
    // edit needs to follow it — otherwise editingKey keeps pointing at a set number
    // that now holds a DIFFERENT set's data, putting the wrong row in edit mode.
    if (editingKey?.startsWith(`${exerciseId}-`)) {
      const editNum = parseInt(editingKey.slice(exerciseId.length + 1), 10)
      if (editNum === setNumber) setEditingKey(null)
      else if (editNum > setNumber) setEditingKey(`${exerciseId}-${editNum - 1}`)
    }
    showSaveToast('Set removed')
  }

  /**
   * Persist a skip as a weight=null/reps=null `is_skipped` marker row (see
   * 18-skip-persistence.sql) instead of leaving it purely in React state —
   * otherwise closing the app and resuming rebuilds `logs` from
   * `session_logs` alone and every skip silently reverts to "not done".
   * Stats RPCs already filter on `weight is not null`, so these rows are
   * inert for XP/streak/PR purposes.
   */
  async function persistSkip(exerciseId: string, setNumbers: number[]) {
    if (!sessionId || setNumbers.length === 0) return
    await supabase.from('session_logs').upsert(
      setNumbers.map(s => ({
        session_id: sessionId,
        exercise_id: exerciseId,
        set_number: s,
        weight: null,
        reps: null,
        is_pr: false,
        is_warmup: false,
        is_skipped: true,
      })),
      { onConflict: 'session_id,exercise_id,set_number' },
    )
  }

  /** Undo persistSkip — deletes the marker row(s) so resume no longer sees them. */
  async function persistUnskip(exerciseId: string, setNumbers: number[]) {
    if (!sessionId || setNumbers.length === 0) return
    await supabase
      .from('session_logs')
      .delete()
      .eq('session_id', sessionId)
      .eq('exercise_id', exerciseId)
      .in('set_number', setNumbers)
  }

  async function handleSkipSet(exerciseId: string, setNumber: number) {
    const key = `${exerciseId}-${setNumber}`
    const wasChecked = logs[key]?.checked
    // persistSkip upserts the skip marker over whatever was there — including
    // an already-saved checked row, which it overwrites (weight/reps/is_pr
    // back to null/false) so it doesn't persist as a completed set.
    setLogs(prev => {
      const next = { ...prev, [key]: { ...prev[key], skipped: true, checked: false, isPR: false, logId: undefined } }
      if (wasChecked) {
        // Recompute live PR bars — the overwritten set may have been the best.
        setPreviousBests(pb => ({ ...pb, [exerciseId]: bestFromLogs(exerciseId, next) }))
        setPreviousBestVolumes(pb => ({ ...pb, [exerciseId]: bestVolumeFromLogs(exerciseId, next) }))
      }
      return next
    })
    // Exit edit mode if the user is mid-edit when they skip.
    if (editingKey === key) setEditingKey(null)
    await persistSkip(exerciseId, [setNumber])
  }

  async function handleUnskipSet(exerciseId: string, setNumber: number) {
    const key = `${exerciseId}-${setNumber}`
    setLogs(prev => ({
      ...prev,
      [key]: { ...prev[key], skipped: false, logId: undefined },
    }))
    await persistUnskip(exerciseId, [setNumber])
  }

  async function handleSkipExercise(exerciseId: string) {
    const ex = exercises.find(e => e.id === exerciseId)
    if (!ex) return
    const setsToSkip: number[] = []
    for (let s = 1; s <= ex.sets_target; s++) {
      if (!logs[`${exerciseId}-${s}`]?.checked) setsToSkip.push(s)
    }
    setLogs(prev => {
      const next = { ...prev }
      for (const s of setsToSkip) {
        const key = `${exerciseId}-${s}`
        next[key] = { ...next[key], skipped: true, checked: false }
      }
      return next
    })
    await persistSkip(exerciseId, setsToSkip)
  }

  async function handleUnskipExercise(exerciseId: string) {
    const ex = exercises.find(e => e.id === exerciseId)
    if (!ex) return
    const setsToUnskip: number[] = []
    for (let s = 1; s <= ex.sets_target; s++) {
      if (logs[`${exerciseId}-${s}`]?.skipped) setsToUnskip.push(s)
    }
    setLogs(prev => {
      const next = { ...prev }
      for (const s of setsToUnskip) {
        const key = `${exerciseId}-${s}`
        if (next[key]?.skipped) {
          next[key] = { ...next[key], skipped: false, logId: undefined }
        }
      }
      return next
    })
    await persistUnskip(exerciseId, setsToUnskip)
  }

  async function handleSwapExercise(newExercise: Exercise) {
    if (!swapTarget || !sessionId) return
    const oldExercise = exercises.find(e => e.id === swapTarget)
    const oldExtras = extraSets[swapTarget] ?? 0

    await supabase
      .from('session_logs')
      .delete()
      .eq('session_id', sessionId)
      .eq('exercise_id', swapTarget)

    let prevBest: number | null = previousBests[newExercise.id] !== undefined
      ? previousBests[newExercise.id]
      : null
    let prevBestVolume: number | null = previousBestVolumes[newExercise.id] !== undefined
      ? previousBestVolumes[newExercise.id]
      : null

    if (previousBests[newExercise.id] === undefined) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from('session_logs')
          .select('weight, reps, sessions!inner(user_id, completed_at)')
          .eq('exercise_id', newExercise.id)
          .eq('sessions.user_id', user.id)
          .not('sessions.completed_at', 'is', null)
          .not('weight', 'is', null)
        let maxWeight: number | null = null
        let maxVolume: number | null = null
        for (const row of data ?? []) {
          if (row.weight === null) continue
          if (maxWeight === null || row.weight > maxWeight) maxWeight = row.weight
          if (row.reps === null) continue
          const vol = row.weight * row.reps
          if (maxVolume === null || vol > maxVolume) maxVolume = vol
        }
        prevBest = maxWeight
        prevBestVolume = maxVolume
        setPreviousBests(prev => ({ ...prev, [newExercise.id]: prevBest }))
        setPreviousBestVolumes(prev => ({ ...prev, [newExercise.id]: prevBestVolume }))
      }
    }
    // Seed the baselines too — bestFromLogs/bestVolumeFromLogs (used by
    // undo/edit/delete-set to recompute the live PR bars) fall back to
    // baselineBests/baselineBestVolumes, which are otherwise only ever
    // populated in initSession. Without this, the first undo/edit/delete on
    // the swapped-in exercise would collapse its PR bar to null even though a
    // real previous best was just fetched above.
    setBaselineBests(prev => (prev[newExercise.id] !== undefined ? prev : { ...prev, [newExercise.id]: prevBest }))
    setBaselineBestVolumes(prev => (prev[newExercise.id] !== undefined ? prev : { ...prev, [newExercise.id]: prevBestVolume }))

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
        // Clear every set for the old exercise, including bonus sets beyond
        // sets_target — otherwise their stale entries (with logIds pointing at
        // DB rows already deleted above) linger in state and can resurface as
        // already-"checked" sets if this same exercise is swapped back in later.
        const oldTotal = oldExercise.sets_target + oldExtras
        for (let s = 1; s <= oldTotal; s++) {
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
    // Bonus sets don't carry across a swap — both sides start clean at their
    // own sets_target, same as a freshly loaded exercise.
    setExtraSets(prev => {
      if (!(swapTarget in prev) && !(newExercise.id in prev)) return prev
      const next = { ...prev }
      delete next[swapTarget]
      delete next[newExercise.id]
      return next
    })
    // An in-progress edit on the exercise being swapped out no longer applies.
    if (editingKey?.startsWith(`${swapTarget}-`)) setEditingKey(null)

    setSwapTarget(null)
    showSaveToast(`Swapped in ${newExercise.name}`)
  }

  /**
   * Create a brand-new exercise from the swap sheet (when the one the user wants
   * isn't in any of their days yet) and immediately swap it into the current
   * slot. The exercise is added to THIS day's catalog so it persists past the
   * session, mirroring WorkoutManager's insert (owner-stamped, appended to the
   * end of the day's sort order). Returns the created row, or null on failure so
   * the modal can surface an error and keep the form open.
   */
  async function createAndSwapExercise(name: string, sets: number, reps: string): Promise<Exercise | null> {
    if (!swapTarget) return null
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const sortOrder = allExercises
      .filter(e => e.day_type === day)
      .reduce((m, e) => Math.max(m, e.sort_order), 0) + 1

    const { data, error } = await supabase
      .from('exercises')
      .insert({
        user_id: user.id,
        name: name.trim(),
        day_type: day,
        sets_target: sets,
        reps_target: reps.trim(),
        sort_order: sortOrder,
      })
      .select()
      .maybeSingle()

    if (error || !data) return null

    const created = data as Exercise
    // Keep the in-memory catalog in sync so a subsequent swap sees the new row.
    setAllExercises(prev => [...prev, created])
    await handleSwapExercise(created)
    return created
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

  async function handleUndoFinish() {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('grind_finish_undo') : null
    if (!raw) return
    let token: FinishUndoToken
    try { token = JSON.parse(raw) } catch { return }
    if (Date.now() > token.expiresAt) { localStorage.removeItem('grind_finish_undo'); return }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.id !== token.userId) return

    // Reopen the session server-side; stats are re-derived from the remaining
    // logs rather than restored from values the client was holding. A tampered
    // or replayed token can therefore only reopen a session you own — it can't
    // dictate what your XP becomes.
    const { error: undoError } = await supabase.rpc('uncomplete_session', {
      p_session_id: token.sessionId,
      p_local_date: localDateKey(new Date()),
    })

    if (undoError) {
      setResumeToast('Could not undo. Try again.')
      setTimeout(() => setResumeToast(null), 4000)
      return
    }

    await supabase
      .from('user_rotation')
      .update({ current_index: token.prevRotationIndex })
      .eq('user_id', user.id)

    localStorage.removeItem('grind_finish_undo')
    setCompletionData(null)
  }

  async function handleFinish() {
    if (!sessionId || finishing) return
    if (checkedSets() === 0) {
      // Nothing to save — guard against an empty completion.
      setResumeToast('Log at least one set before finishing.')
      setTimeout(() => setResumeToast(null), 4000)
      return
    }
    setFinishing(true)

    // The whole finish is wrapped so a network failure can't leave the button
    // stuck on "SAVING…" or silently drop the workout. Every set is already
    // saved to session_logs as it's checked, so on failure the session simply
    // isn't marked complete — it stays in-progress and resumes right where it
    // left off. `runWithRetry` gives a transient blip, or an auth token that
    // just expired on a long session, a chance to recover on its own.
    try {
      const { data: userData } = await runWithRetry(() => supabase.auth.getUser())
      const user = userData?.user
      if (!user) { router.push('/login'); return }

      // Completion is a single server-side transaction.
      //
      // XP, level, streak and PR flags used to be computed here and written
      // straight to `user_stats` — which meant anyone could set their own XP
      // from devtools. The server now derives all of it from the session logs
      // themselves (docs/sql/11-server-side-xp.sql) and the client has no
      // UPDATE privilege on `user_stats` at all. We send only the local
      // calendar date, because Postgres can't know the user's timezone and
      // streaks depend on it.
      const { data: finishData, error: finishError } = await runWithRetry(() =>
        supabase.rpc('complete_session', {
          p_session_id: sessionId,
          p_local_date: localDateKey(new Date()),
          p_note: workoutNote || null,
        }),
      )

      let result: CompleteSessionResult
      if (finishError || !finishData) {
        // The RPC is not naturally idempotent across a lost response: if the
        // first attempt committed server-side but the reply never arrived,
        // runWithRetry's second call correctly gets refused with
        // SESSION_NOT_OPEN (the session is already completed). That specific
        // error means success, not failure — re-read what the server already
        // settled on instead of telling the user it failed.
        const alreadyDone = String(
          (finishError as { message?: string } | null)?.message ?? ''
        ).includes('SESSION_NOT_OPEN')

        if (!alreadyDone) {
          console.error('[grind] complete_session failed', finishError, finishData)
          const msg = String((finishError as { message?: string } | null)?.message ?? '')
          if (msg.includes('NO_WORKING_SETS')) {
            setResumeToast('Log at least one set with weight and reps before finishing.')
            setTimeout(() => setResumeToast(null), 5000)
            return
          }
          throw finishError ?? new Error('Finish failed')
        }

        const [{ data: sessionRow }, { data: statsRow }] = await Promise.all([
          supabase.from('sessions').select('xp_earned').eq('id', sessionId).maybeSingle(),
          supabase.from('user_stats').select('*').eq('user_id', user.id).maybeSingle(),
        ])
        if (!sessionRow || !statsRow) throw finishError ?? new Error('Finish failed')

        result = {
          xp_earned: sessionRow.xp_earned,
          xp_total: statsRow.xp_total,
          prev_level: statsRow.level,
          level: statsRow.level,
          // Can't recover whether THIS completion leveled the user up once the
          // original response is lost; under-reporting a level-up banner is a
          // harmless cosmetic miss, unlike mis-reporting XP.
          leveled_up: false,
          current_streak: statsRow.current_streak,
          longest_streak: statsRow.longest_streak,
          last_workout_date: statsRow.last_workout_date,
          total_workouts: statsRow.total_workouts,
          pr_count: 0,
          pr_exercises: [],
        }
      } else {
        result = finishData as CompleteSessionResult
      }

      const xpEarned = result.xp_earned
      const prCount = result.pr_count
      const prExercises = result.pr_exercises ?? []
      const newLevel = result.level
      const leveledUp = result.leveled_up

      haptic('medium')

      // Authoritative post-completion stats, for the badge check below.
      const updatedStats = {
        xp_total: result.xp_total,
        level: result.level,
        current_streak: result.current_streak,
        longest_streak: result.longest_streak,
        last_workout_date: result.last_workout_date,
        total_workouts: result.total_workouts,
        updated_at: new Date().toISOString(),
      }

      // Advance the rotation pointer so the home page suggests the next day
      // after this one. Best-effort — a failure here must never block
      // completion.
      let prevRotationIndex = 0
      try {
        const [{ data: dayTypeRows }, { data: rotationRow }, { data: flexRows }] = await Promise.all([
          supabase.from('exercises').select('day_type'),
          supabase.from('user_rotation').select('*').eq('user_id', user.id).maybeSingle(),
          supabase.from('user_flex_days').select('day_key').eq('user_id', user.id),
        ])
        const dayKeys = Array.from(new Set((dayTypeRows ?? []).map(r => r.day_type)))
        const rotation = rotationRow as UserRotation | null
        prevRotationIndex = rotation?.current_index ?? 0
        const flexDays = new Set((flexRows ?? []).map((r: { day_key: string }) => r.day_key))
        const seq = effectiveSequence(rotation, dayKeys, flexDays)
        const newIndex = advanceIndex(seq, rotation?.current_index ?? -1, day)
        await supabase.from('user_rotation').upsert(
          {
            user_id: user.id,
            mode: rotation?.mode ?? 'auto',
            sequence: rotation?.sequence ?? [],
            current_index: newIndex,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        )
      } catch {
        // Rotation is a non-critical convenience; swallow and move on.
      }

      // Store a 10-minute undo token so the user can resume if they finished
      // by accident.
      if (typeof window !== 'undefined') {
        const token: FinishUndoToken = {
          sessionId,
          day,
          userId: user.id,
          xpEarned,
          prevRotationIndex,
          expiresAt: Date.now() + 10 * 60 * 1000,
        }
        localStorage.setItem('grind_finish_undo', JSON.stringify(token))
      }

      // Badge awards are a bonus — never fail an already-saved finish over them.
      let newBadges: string[] = []
      try {
        newBadges = await checkAndAwardBadges(
          supabase,
          user.id,
          { user_id: user.id, ...updatedStats } as UserStats,
          { sessionStartedAt: startedAt, hadNoSkips: skippedSets() === 0 && checkedSets() > 0 },
        )
      } catch {
        newBadges = []
      }

      if (newBadges.length > 0) {
        const resolved = newBadges
          .map(id => ALL_BADGES.find(b => b.id === id))
          .filter((b): b is BadgeDefinition => !!b)
        if (resolved.length > 0) setBadgeUnlock(resolved)
      }

      setCompletionData({
        xpEarned,
        leveledUp,
        newLevel,
        prCount,
        prExercises,
        duration: elapsed,
        setsCompleted: checkedSets(),
        currentStreak: result.current_streak,
        isNewBestStreak: result.current_streak > 1 && result.current_streak === result.longest_streak,
      })
    } catch (err) {
      // The workout is untouched (or safely resumable) — tell the user and let
      // them try again. Reuse the top toast so the message is impossible to
      // miss. Log the underlying error too: if the toast keeps firing on a good
      // connection it's a server-side RPC failure, and this is the only trace.
      console.error('[grind] handleFinish failed', err)
      setResumeToast('Could not finish workout. Check your connection and try again.')
      setTimeout(() => setResumeToast(null), 5000)
    } finally {
      setFinishing(false)
    }
  }

  // ── First-time contextual hints (use-case based, one-off; NOT a tour) ─────────
  // Each fires once ever, the first time its control is genuinely in use. Hooks
  // must run before the early returns below. Suppressed while any modal/sheet is
  // open, and — except the rest-timer hint, which explains the very bar that's
  // counting — during an active rest countdown, so a hint never lands over a
  // modal or distracts mid-rest. A coordinator inside the hook shows one at a
  // time so eligible hints queue rather than stack.
  const anyModalOpen = !!plateCalcTarget || !!swapTarget || !!completionData || showExitConfirm
  const restCounting = restTimer.active && !restTimer.paused
  const hintsBlocked = anyModalOpen || restCounting
  const workoutReady = !loading && exercises.length > 0
  const hasAnyPR = Object.values(logs).some(l => l.isPR)

  const hintCheck = useFeatureTooltip('aw-check', {
    when: workoutReady, suppressed: hintsBlocked, getEl: () => onboardTarget('aw-check'),
    body: 'Tap the checkmark to log this set. Tap a logged set again to edit and re-save it.',
    preferred: ['top', 'left', 'bottom'],
  })
  const hintWarmup = useFeatureTooltip('aw-warmup', {
    when: workoutReady, suppressed: hintsBlocked, getEl: () => onboardTarget('aw-warmup'),
    body: "Mark warm-up sets — they're excluded from PR detection.",
    preferred: ['top', 'bottom'],
  })
  const hintPlate = useFeatureTooltip('aw-plate', {
    when: workoutReady, suppressed: hintsBlocked, getEl: () => onboardTarget('aw-plate'),
    body: 'Tap here to see which plates to load per side for your target weight.',
    preferred: ['top', 'bottom'],
  })
  const hintNote = useFeatureTooltip('aw-note', {
    when: workoutReady, suppressed: hintsBlocked, getEl: () => onboardTarget('aw-note'),
    body: 'Tap the chevron to add a note to this specific set.',
    preferred: ['bottom', 'right'],
  })
  const hintSkip = useFeatureTooltip('aw-skip', {
    when: workoutReady, suppressed: hintsBlocked, getEl: () => onboardTarget('aw-skip'),
    body: 'Skip marks a planned set as not-done but keeps the slot. Extra sets you add get a trash icon that removes them instead.',
    preferred: ['top', 'left'],
  })
  const hintAddSet = useFeatureTooltip('aw-addset', {
    when: workoutReady, suppressed: hintsBlocked, getEl: () => onboardTarget('aw-addset'),
    body: 'Need an extra set beyond the plan? Add one here.',
    preferred: ['top', 'bottom'],
  })
  const hintSwap = useFeatureTooltip('aw-swap', {
    when: workoutReady, suppressed: hintsBlocked, getEl: () => onboardTarget('aw-swap'),
    body: 'Swap this exercise for another from your catalog, or create a new one.',
    preferred: ['bottom', 'left'],
  })
  const hintPR = useFeatureTooltip('aw-pr', {
    when: hasAnyPR, suppressed: hintsBlocked, getEl: () => onboardTarget('aw-pr'),
    body: 'New personal record! GRIND compares against your best-ever weight for this exercise.',
    preferred: ['top', 'bottom'],
  })
  // The rest-timer hint is the one exception that may show during a countdown.
  const hintRest = useFeatureTooltip('aw-rest-adjust', {
    when: restTimer.active, suppressed: anyModalOpen, getEl: () => onboardTarget('aw-rest-adjust'),
    body: 'Adjust your rest on the fly, or tap the timer to set a new default for this exercise.',
    preferred: ['top'],
  })
  const activeWorkoutHints = (
    <>{hintCheck}{hintWarmup}{hintPlate}{hintNote}{hintSkip}{hintAddSet}{hintSwap}{hintPR}{hintRest}</>
  )

  // Undo hint is folded into the 5s undo toast the first time it appears (see the
  // toast render) rather than shown as a separate floating bubble. Latched into
  // its own state so it stays for the whole toast, not just the render before it's
  // marked seen, then resets when the toast closes and never returns.
  const [undoHintVisible, setUndoHintVisible] = useState(false)
  useEffect(() => {
    // Latching the fold-in hint to the undo toast's lifetime — a sync from the
    // external undoState transition, not derived render state.
    if (undoState && !hasSeenTooltip('aw-undo')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUndoHintVisible(true)
      markTooltipSeen('aw-undo')
    } else if (!undoState) {
      setUndoHintVisible(false)
    }
  }, [undoState, hasSeenTooltip, markTooltipSeen])

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
            backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: 'none',
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
      {activeWorkoutHints}
      {badgeUnlock ? (
        <BadgeUnlockOverlay badges={badgeUnlock} onContinue={() => setBadgeUnlock(null)} />
      ) : completionData && (
        <CompletionModal
          data={completionData}
          onDone={() => router.push('/home')}
          onUndo={handleUndoFinish}
        />
      )}

      {swapTarget && (
        <ExerciseSwapModal
          currentExerciseId={swapTarget}
          day={day}
          allExercises={allExercises}
          currentExercises={exercises}
          onSelect={handleSwapExercise}
          onCreate={createAndSwapExercise}
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
      {resumeToastExit.data && (
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
            color: 'var(--accent-text)',
            padding: '10px 16px',
            borderRadius: 'var(--radius-pill, 9999px)',
            fontSize: '13px',
            fontWeight: 500,
            zIndex: 300,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            animation: resumeToastExit.closing ? 'toast-out 200ms ease forwards' : 'toast-in 180ms ease',
            // Purely informational — never let this strip swallow a tap meant
            // for the content beneath it while it's on screen.
            pointerEvents: 'none',
          }}
        >
          {resumeToastExit.data}
        </div>
      )}

      {/* Undo toast — anchored to the top so it's visible wherever you are scrolled.
          Sits just below the resume toast if both happen to show. */}
      {undoToastExit.data && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: `calc(env(safe-area-inset-top) + ${resumeToastExit.data ? '60px' : '12px'})`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'calc(100% - 32px)',
            maxWidth: '420px',
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-pill, 9999px)',
            padding: '10px 12px 10px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 300,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            animation: undoToastExit.closing ? 'toast-out 200ms ease forwards' : 'toast-in 180ms ease',
            // The pill spans most of the width near the top for 5s. Only the
            // UNDO button should catch taps — otherwise this bar sits over the
            // top of the content and eats taps aimed at the controls beneath it
            // (the "I tapped a button but nothing/the wrong thing happened" bug).
            pointerEvents: 'none',
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Logged set {undoToastExit.data.setNumber}
            </span>
            {undoHintVisible && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                You have 5 seconds to undo a logged set.
              </span>
            )}
          </span>
          <button
            onClick={handleUndo}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent-text)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 700,
              fontSize: '13px',
              letterSpacing: '1px',
              cursor: 'pointer',
              padding: '4px 8px',
              pointerEvents: undoToastExit.closing ? 'none' : 'auto',
            }}
          >
            UNDO
          </button>
        </div>
      )}

      {/* Passive "saved" confirmation — bottom-anchored, non-interactive.
          Sits above the finish/rest bar, and rides up above the keyboard when
          one is open so it stays visible while editing. */}
      {saveToastExit.data && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: `calc(${keyboardInset > 0 ? `${keyboardInset}px` : 'env(safe-area-inset-bottom)'} + ${restTimer.active ? '104px' : '92px'})`,
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--accent)',
            color: 'var(--accent-text)',
            padding: '9px 16px',
            borderRadius: 'var(--radius-pill, 9999px)',
            fontSize: '13px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            whiteSpace: 'nowrap',
            zIndex: 60,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            animation: saveToastExit.closing ? 'save-toast-out 180ms ease forwards' : 'save-toast-in 160ms ease',
            pointerEvents: 'none',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {saveToastExit.data}
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
          paused={restTimer.paused}
          onStop={restTimer.stop}
          onAdd={restTimer.addSeconds}
          onPause={restTimer.pause}
          onResume={restTimer.resume}
        />
      )}

      <div className="page page--workout" style={{ paddingBottom: 'calc(140px + env(safe-area-inset-bottom))', fontFamily: "'DM Sans', sans-serif" }}>
       <div className="wo-layout">

        {/* Desktop sidebar rail — hidden on mobile via CSS. Mirrors the mobile
            header (title/timer/progress) and adds an exercise jump-list. */}
        <aside className="wo-sidebar">
          <button
            onClick={() => setShowExitConfirm(true)}
            aria-label="Exit workout"
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-secondary)', padding: 0,
              fontFamily: "'DM Sans', sans-serif", fontSize: '13px', fontWeight: 600,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Exit
          </button>

          <div>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '30px', color: 'var(--text-primary)', letterSpacing: '1px',
              lineHeight: 1.05,
            }}>
              {dayLabel(day)}
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px',
            }}>
              {formatElapsed(elapsed)}
            </div>
          </div>

          {/* Progress */}
          <div>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              marginBottom: '6px',
            }}>
              <span style={{
                fontSize: '10px', letterSpacing: 'var(--tracking-label)',
                color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500,
              }}>
                Progress
              </span>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: '13px',
                color: 'var(--accent-text)',
              }}>
                {Math.round(progressPercent())}%
              </span>
            </div>
            <div style={{ height: '6px', backgroundColor: 'var(--border)', borderRadius: '9999px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${progressPercent()}%`,
                backgroundColor: 'var(--accent)', borderRadius: '9999px',
                transition: 'width 300ms ease',
              }} />
            </div>
          </div>

          {/* Exercise jump-list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{
              fontSize: '10px', letterSpacing: 'var(--tracking-label)',
              color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500,
              marginBottom: '2px',
            }}>
              Exercises
            </span>
            {exercises.map((ex) => {
              const setCount = ex.sets_target + (extraSets[ex.id] ?? 0)
              const keys = Array.from({ length: setCount }, (_, i) => `${ex.id}-${i + 1}`)
              const entries = keys.map(k => logs[k])
              const allSkipped = setCount > 0 && entries.every(e => e?.skipped)
              const allProcessed = setCount > 0 && entries.every(e => e?.checked || e?.skipped)
              const anyChecked = entries.some(e => e?.checked)
              const done = allProcessed && anyChecked
              return (
                <button
                  key={ex.id}
                  className="wo-jump-item"
                  onClick={() => document.getElementById(`wo-ex-${ex.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    width: '100%', textAlign: 'left',
                    border: '1px solid transparent', borderRadius: 'var(--radius-sm)',
                    padding: '7px 8px', cursor: 'pointer',
                  }}
                >
                  <span style={{
                    width: '16px', height: '16px', borderRadius: '9999px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: done ? 'none' : `1.5px solid ${allSkipped ? 'var(--danger)' : 'var(--border-strong)'}`,
                    backgroundColor: done ? 'var(--accent)' : 'transparent',
                  }}>
                    {done && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {allSkipped && !done && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="3" strokeLinecap="round">
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    )}
                  </span>
                  <span style={{
                    fontSize: '13px', minWidth: 0,
                    color: allSkipped ? 'var(--text-muted)' : 'var(--text-secondary)',
                    textDecoration: allSkipped ? 'line-through' : 'none',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {ex.name}
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        <div className="wo-main">

        {/* Header */}
        <div className="wo-sticky-header wo-mobile-header" style={{
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
        <div className="wo-main-inner" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {exercises.map((ex, exIdx) => (
            <ExerciseCard
              key={ex.id}
              exercise={ex}
              firstExercise={exIdx === 0}
              extraSets={extraSets[ex.id] ?? 0}
              logs={logs}
              previousBest={previousBests[ex.id] ?? null}
              editingKey={editingKey}
              onCheck={handleCheck}
              onUpdate={updateLog}
              onSwap={() => setSwapTarget(ex.id)}
              onSkipSet={handleSkipSet}
              onUnskipSet={handleUnskipSet}
              onDeleteSet={handleDeleteSet}
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
                fontSize: '16px', // ≥16px — anything smaller makes iOS auto-zoom on focus
                padding: '10px 12px',
                resize: 'vertical',
                minHeight: '54px',
              }}
            />
          </div>
        </div>
        </div>{/* .wo-main */}
       </div>{/* .wo-layout */}
      </div>

      {/* Finish button — hidden while the rest bar owns the bottom edge.
          Always pinned to the viewport bottom; the keyboard appears on top of it. */}
      {!restTimer.active && (
      <div className="wo-fixed-bar" style={{
        position: 'fixed',
        bottom: 0,
        paddingTop: '12px',
        paddingLeft: '16px',
        paddingRight: '16px',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
        backgroundColor: 'var(--bg)',
        borderTop: '1px solid var(--border)',
        zIndex: 50,
      }}>
        <div className="wo-finish-inner">
        {(() => {
          const canFinish = checked > 0 && !finishing
          return (
            <button
              onClick={handleFinish}
              disabled={!canFinish}
              className="wo-finish-btn"
              style={{
                height: '56px',
                backgroundColor: canFinish ? 'var(--accent)' : 'var(--border)',
                color: canFinish ? 'var(--on-accent)' : 'var(--text-muted)',
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
        <div className="wo-finish-summary" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {skipped > 0
            ? `${checked} done · ${skipped} skipped · ${total} total`
            : `${checked} / ${total} sets`}
        </div>
        </div>
      </div>
      )}
    </>
  )
}

// ─── Exercise Card ─────────────────────────────────────────────────────────────

interface ExerciseCardProps {
  exercise: Exercise
  /** First card in the list — carries the one-off onboarding hint anchors. */
  firstExercise: boolean
  extraSets: number
  logs: LogMap
  previousBest: number | null
  editingKey: string | null
  onCheck: (exerciseId: string, setNumber: number) => void
  onUpdate: (key: string, field: 'weight' | 'reps' | 'note', value: string) => void
  onSwap: () => void
  onSkipSet: (exerciseId: string, setNumber: number) => void
  onUnskipSet: (exerciseId: string, setNumber: number) => void
  onDeleteSet: (exerciseId: string, setNumber: number) => void
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
  exercise, firstExercise, extraSets, logs, previousBest, editingKey,
  onCheck, onUpdate, onSwap,
  onSkipSet, onUnskipSet, onDeleteSet,
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
    <div id={`wo-ex-${exercise.id}`} style={{
      backgroundColor: 'var(--surface)',
      border: `1px solid ${anySkipped ? 'rgba(239,68,68,0.2)' : 'var(--border)'}`,
      borderRadius: '12px',
      overflow: 'hidden',
      opacity: allSkipped ? 0.65 : 1,
      transition: 'opacity 150ms ease, border-color 150ms ease',
      scrollMarginTop: 'calc(var(--nav-h) + 16px)',
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
                  <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.37"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                  <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                </svg>
              )}
              <span style={{
                fontSize: '10px',
                color: allSkipped ? 'var(--accent-text)' : 'var(--text-secondary)',
                fontFamily: "'Bebas Neue', sans-serif",
                letterSpacing: '0.5px',
              }}>
                {allSkipped ? 'UNDO' : 'SKIP'}
              </span>
            </button>

            {/* Swap button */}
            <button
              data-onboard={firstExercise ? 'aw-swap' : undefined}
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
            {previousBest !== null ? (previousBest === 0 ? 'prev: BW' : `prev: ${fmt(previousBest)} ${unitLabel}`) : 'no previous data'}
          </span>
        </div>
      </div>

      <div style={{ height: '1px', backgroundColor: 'var(--border)' }} />

      <div style={{ padding: '8px 0' }}>
        {/* Column headers. The two leading spacers mirror the SET label and W columns.
           The plate calc button is position:absolute so it sits visually between LBS
           and REPS without displacing either label — both stay centered over their inputs. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px 6px' }}>
          <span aria-hidden style={{ minWidth: '38px', flexShrink: 0 }} />
          <span aria-hidden style={{ width: '38px', flexShrink: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'relative' }}>
            <span style={{
              width: '56px', textAlign: 'center',
              fontSize: '10px', fontWeight: 600, letterSpacing: '0.5px',
              textTransform: 'uppercase', color: 'var(--text-muted)',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {unitLabel}
            </span>
            {/* Absolutely positioned so it doesn't affect the flex layout of LBS/REPS */}
            <button
              data-onboard={firstExercise ? 'aw-plate' : undefined}
              onClick={() => {
                // Prefer first unchecked+unskipped set; fall back to set 1 when all are done.
                const target = setNumbers.find(s => {
                  const e = logs[`${exercise.id}-${s}`]
                  return e && !e.checked && !e.skipped
                }) ?? setNumbers[0]
                if (target == null) return
                const key = `${exercise.id}-${target}`
                const entry = logs[key]
                const cur = entry?.weight !== '' ? parseFloat(entry?.weight ?? '') : NaN
                onOpenPlateCalc(key, Number.isFinite(cur) ? toDisplay(cur) : 0)
              }}
              aria-label="Open plate calculator"
              title="Plate calculator"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '28px', height: '28px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: 'transparent', border: 'none',
                cursor: 'pointer', padding: 0,
                color: 'var(--text-muted)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="18" rx="1" />
                <line x1="6" y1="8" x2="6" y2="16" />
                <line x1="18" y1="8" x2="18" y2="16" />
              </svg>
            </button>
            <span style={{
              width: '56px', textAlign: 'center',
              fontSize: '10px', fontWeight: 600, letterSpacing: '0.5px',
              textTransform: 'uppercase', color: 'var(--text-muted)',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              reps
            </span>
          </div>
        </div>
        {setNumbers.map((setNum) => {
          const key = `${exercise.id}-${setNum}`
          const logEntry = logs[key] ?? {
            weight: '', reps: '', checked: false, skipped: false, isPR: false,
            isWarmup: false, note: '',
          }
          const isBonus = setNum > exercise.sets_target
          const editing = editingKey === key
          const prevReps = setNum > 1 ? (logs[`${exercise.id}-${setNum - 1}`]?.reps ?? '') : ''
          return (
            <SetRow
              key={key}
              setNumber={setNum}
              isBonus={isBonus}
              onboardFirst={firstExercise && setNum === 1 && !isBonus}
              editing={editing}
              logEntry={logEntry}
              prevReps={prevReps}
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
              onDelete={() => onDeleteSet(exercise.id, setNum)}
            />
          )
        })}

        <div style={{ padding: '6px 16px 4px' }}>
          <button
            data-onboard={firstExercise ? 'aw-addset' : undefined}
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
  day: string
  allExercises: Exercise[]
  currentExercises: Exercise[]
  onSelect: (exercise: Exercise) => void
  onCreate: (name: string, sets: number, reps: string) => Promise<Exercise | null>
  onClose: () => void
}

function ExerciseSwapModal({ currentExerciseId, day, allExercises, currentExercises, onSelect, onCreate, onClose }: ExerciseSwapModalProps) {
  const [query, setQuery] = useState('')
  // 'search' lists existing exercises; 'create' is the inline new-exercise form
  // reached when the one you want isn't in any of your days yet.
  const [mode, setMode] = useState<'search' | 'create'>('search')
  const [formName, setFormName] = useState('')
  const [formSets, setFormSets] = useState('3')
  const [formReps, setFormReps] = useState('8-12')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const keyboardInset = useKeyboardInset()

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

  // Offer to create only when what's typed doesn't already exist anywhere in the
  // catalog (case-insensitive) — no point minting a duplicate of something
  // that's already selectable in the list.
  const trimmedQuery = query.trim()
  const exactExists = allExercises.some(
    ex => ex.name.trim().toLowerCase() === trimmedQuery.toLowerCase()
  )
  const canOfferCreate = trimmedQuery.length > 0 && !exactExists

  function openCreate() {
    setFormName(trimmedQuery)
    setFormSets('3')
    setFormReps('8-12')
    setError('')
    setMode('create')
  }

  async function submitCreate() {
    if (saving) return
    const name = formName.trim()
    if (!name) { setError('Exercise name is required.'); return }
    const sets = parseInt(formSets, 10)
    if (!sets || sets < 1 || sets > 20) { setError('Sets must be between 1 and 20.'); return }
    if (!formReps.trim()) { setError('Reps is required.'); return }
    // Same duplicate guard WorkoutManager enforces: unique name within a day.
    const dupInDay = allExercises.some(
      ex => ex.day_type === day && ex.name.trim().toLowerCase() === name.toLowerCase()
    )
    if (dupInDay) { setError('An exercise with this name already exists for this day.'); return }

    setSaving(true)
    setError('')
    const created = await onCreate(name, sets, formReps.trim())
    if (!created) {
      setSaving(false)
      setError('Could not create exercise. Check your connection and try again.')
      return
    }
    // On success the parent swaps it in and closes this sheet — nothing else to do.
  }

  // On iOS the keyboard shrinks only the visual viewport, so a fixed
  // bottom-anchored sheet stays pinned behind it. Lift the sheet by the keyboard
  // height (via backdrop padding) and cap its height to what's still visible, so
  // the search field and results — or the create form — stay above the keyboard.
  const lift = keyboardInset
  const sheetMaxHeight = lift > 0 ? `calc(92dvh - ${lift}px)` : '72vh'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)',
        zIndex: 300, display: 'flex', alignItems: 'flex-end',
        paddingBottom: lift > 0 ? `${lift}px` : 0,
        transition: 'padding-bottom 180ms ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', backgroundColor: 'var(--surface)',
          borderRadius: '16px 16px 0 0',
          maxHeight: sheetMaxHeight, display: 'flex', flexDirection: 'column',
          border: '1px solid var(--border)', borderBottom: 'none',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 16px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: '8px',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
            {mode === 'create' && (
              <button
                onClick={() => { setMode('search'); setError('') }}
                aria-label="Back to search"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  width: '32px', height: '32px', marginLeft: '-6px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}
            <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: 'var(--text-primary)', letterSpacing: '1px', fontWeight: 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {mode === 'create' ? 'NEW EXERCISE' : 'SWAP EXERCISE'}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close swap dialog"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              width: '44px', height: '44px', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {mode === 'search' ? (
          <>
            {/* Search */}
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search or add an exercise..."
                aria-label="Search exercises"
                autoFocus
                style={{
                  width: '100%',
                  backgroundColor: 'var(--surface-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '16px', // ≥16px — anything smaller makes iOS auto-zoom on focus
                  padding: '10px 12px',
                  outline: 'none',
                }}
              />
            </div>

            {/* List */}
            <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 'env(safe-area-inset-bottom)' }}>
              {/* Create affordance — shown as soon as the typed name is new, so
                  the user is never stuck when what they want isn't listed. */}
              {canOfferCreate && (
                <button
                  onClick={openCreate}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: 'var(--accent-wash)',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    padding: '14px 16px',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '12px',
                  }}
                >
                  <span style={{
                    width: '28px', height: '28px', borderRadius: '9999px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'var(--accent)', color: 'var(--on-accent)',
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: '15px', fontWeight: 600, color: 'var(--accent-text)',
                      fontFamily: "'DM Sans', sans-serif",
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      Create “{trimmedQuery}”
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>
                      New exercise for this day
                    </div>
                  </div>
                </button>
              )}

              {dayTypes.length === 0 && !canOfferCreate && (
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
                              color: isCurrent ? 'var(--accent-text)' : 'var(--text-primary)',
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
                              fontSize: '10px', color: 'var(--accent-text)',
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
          </>
        ) : (
          /* ── Create form ──────────────────────────────────────────────────── */
          <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label htmlFor="swap-new-name" style={{
                  fontSize: '10px', letterSpacing: 'var(--tracking-label)',
                  color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500,
                }}>
                  Name
                </label>
                <input
                  id="swap-new-name"
                  type="text"
                  value={formName}
                  onChange={e => { setFormName(e.target.value); if (error) setError('') }}
                  placeholder="e.g. Incline Dumbbell Press"
                  autoFocus={formName === ''}
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--surface-elevated)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '16px',
                    padding: '11px 12px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: '0 0 96px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label htmlFor="swap-new-sets" style={{
                    fontSize: '10px', letterSpacing: 'var(--tracking-label)',
                    color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500,
                  }}>
                    Sets
                  </label>
                  <input
                    id="swap-new-sets"
                    type="number"
                    inputMode="numeric"
                    value={formSets}
                    onChange={e => { setFormSets(e.target.value); if (error) setError('') }}
                    onFocus={e => e.target.select()}
                    min={1}
                    max={20}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '16px',
                      padding: '11px 12px',
                      textAlign: 'center',
                      outline: 'none',
                    }}
                  />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label htmlFor="swap-new-reps" style={{
                    fontSize: '10px', letterSpacing: 'var(--tracking-label)',
                    color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500,
                  }}>
                    Reps
                  </label>
                  <input
                    id="swap-new-reps"
                    type="text"
                    value={formReps}
                    onChange={e => { setFormReps(e.target.value); if (error) setError('') }}
                    onFocus={e => e.target.select()}
                    placeholder="e.g. 8-12"
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-sans)',
                      fontSize: '16px',
                      padding: '11px 12px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Added to your <span style={{ color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{day.replace(/-/g, ' ')}</span> day and swapped in for this workout.
              </div>

              {error && (
                <div role="alert" style={{ fontSize: '13px', color: 'var(--danger)' }}>
                  {error}
                </div>
              )}

              <button
                onClick={submitCreate}
                disabled={saving}
                style={{
                  width: '100%', height: '52px',
                  backgroundColor: 'var(--accent)', color: 'var(--on-accent)',
                  border: 'none', borderRadius: 'var(--radius-md)',
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: '20px', letterSpacing: '1px',
                  cursor: saving ? 'default' : 'pointer',
                  opacity: saving ? 0.6 : 1,
                  transition: 'opacity 150ms ease',
                }}
              >
                {saving ? 'CREATING…' : 'CREATE & SWAP IN'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Set Row ───────────────────────────────────────────────────────────────────

interface SetRowProps {
  setNumber: number
  isBonus: boolean
  /** First non-bonus set of the first exercise — carries the one-off hint anchors. */
  onboardFirst?: boolean
  editing: boolean
  logEntry: SetState
  prevReps: string
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
  onDelete: () => void
}

function SetRow({
  setNumber, isBonus, onboardFirst, editing,
  logEntry, prevReps,
  onCheck, onSaveEdit, onStartEdit,
  onWeightChange, onRepsChange, onNoteChange, onNoteBlur,
  onToggleWarmup, onSkip, onUnskip, onDelete,
}: SetRowProps) {
  const { fromDisplay, fmt } = useUnit()
  const [justChecked, setJustChecked] = useState(false)
  const [needsReps, setNeedsReps] = useState(false)
  // null = auto: a row with a saved note starts open (notes can arrive after
  // mount when an in-progress session loads), an empty one starts closed.
  // The chevron under the set label sets it explicitly.
  const [noteOpen, setNoteOpen] = useState<boolean | null>(null)
  const noteVisible = noteOpen ?? logEntry.note !== ''
  // logEntry.weight is stored canonically in lbs. We show it in the active display unit.
  // While the field is focused we keep the raw typed string in `rawWeight` so the user can
  // type freely (decimals, partial entries) without conversion fighting the keystrokes; on
  // blur we drop the buffer and the field re-derives from canonical state.
  const [rawWeight, setRawWeight] = useState<string | null>(null)
  const weightRef = useRef<HTMLInputElement>(null)
  const repsRef = useRef<HTMLInputElement>(null)

  // Editable when not yet checked, OR currently in the edit window.
  const inputsDisabled = (logEntry.checked && !editing) || logEntry.skipped

  function handleCheck() {
    if (logEntry.checked) return
    // If reps are empty but a previous set has reps, let the parent auto-fill.
    // Only block + nudge when there is genuinely nothing to copy from.
    if (logEntry.reps.trim() === '' && !prevReps) {
      setNeedsReps(true)
      repsRef.current?.focus()
      return
    }
    // The set is about to be saved (directly or via carried-forward reps) —
    // any earlier "needs reps" warning no longer applies.
    if (needsReps) setNeedsReps(false)
    setJustChecked(true)
    setTimeout(() => setJustChecked(false), 300)
    // On iOS, tapping the check button does NOT blur the input the user just
    // typed in, so the keyboard would linger (with the layout viewport panned)
    // right as the rest timer bar mounts. Dismiss it deterministically.
    if (document.activeElement === repsRef.current || document.activeElement === weightRef.current) {
      ;(document.activeElement as HTMLElement).blur()
    }
    onCheck()
  }

  function handleRepsChange(v: string) {
    if (needsReps && v.trim() !== '') setNeedsReps(false)
    onRepsChange(v)
  }

  /**
   * Pull a just-focused input to the middle of the scroll area once the iOS
   * keyboard has animated in, so a mid-list set isn't left hidden behind it.
   * iOS auto-scrolls native inputs into view, but inside our custom scroll
   * container (with fixed bottom bars it doesn't know about) it often lands the
   * field under the keyboard — this makes it deterministic.
   */
  function ensureVisible(el: HTMLElement) {
    setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
  }

  // Show 'BW' only when the set is checked/saved with weight 0 —
  // not for skipped or unchecked rows, where 0 is just a pre-fill placeholder.
  function fmtWeight(canonical: string): string {
    if (canonical === '') return ''
    const n = parseFloat(canonical)
    return (n === 0 && logEntry.checked) ? 'BW' : fmt(n)
  }
  const displayWeight = rawWeight ?? fmtWeight(logEntry.weight)

  function handleWeightChange(v: string) {
    setRawWeight(v)
    if (v === '') { onWeightChange(''); return }
    // Allow typing 'BW' / 'bw' directly as a shorthand for body weight (stored as 0).
    if (v.trim().toLowerCase() === 'bw') { onWeightChange('0'); return }
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}>
        {/* Set label + note chevron: tapping toggles the per-set note input. */}
        <button
          data-onboard={onboardFirst ? 'aw-note' : undefined}
          onClick={() => setNoteOpen(!noteVisible)}
          aria-expanded={noteVisible}
          aria-label={noteVisible ? `Hide note for set ${setNumber}` : `Show note for set ${setNumber}`}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px',
            minWidth: '38px',
          }}
        >
          <span style={{
            fontSize: '12px',
            color: isBonus ? 'var(--accent-dim)' : 'var(--text-muted)',
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 500,
            textDecoration: logEntry.skipped ? 'line-through' : 'none',
          }}>
            {isBonus ? `+${setNumber - 1}` : `SET ${setNumber}`}
          </span>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{
              // Accent when a note exists so it's findable while collapsed.
              color: logEntry.note ? 'var(--accent-text)' : 'var(--text-muted)',
              transform: noteVisible ? 'rotate(180deg)' : 'none',
              transition: 'transform 150ms ease',
              marginLeft: '6px',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Warm-up toggle. The "W" pill is intentionally minimal; a small caption
           under the first set of each exercise states what it does without repeating
           on every row. The fixed-width column keeps the inputs aligned across rows. */}
        <div style={{
          width: '36px', flexShrink: 0, marginRight: '2px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px',
        }}>
          <button
            data-onboard={onboardFirst ? 'aw-warmup' : undefined}
            onClick={onToggleWarmup}
            disabled={logEntry.checked && !editing}
            aria-pressed={logEntry.isWarmup}
            aria-label={logEntry.isWarmup ? `Unmark set ${setNumber} as warm-up` : `Mark set ${setNumber} as warm-up`}
            title={logEntry.isWarmup ? 'Warm-up set (excluded from PRs)' : 'Mark as warm-up'}
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
          {setNumber === 1 && !isBonus && (
            <span style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '8px', fontWeight: 600, lineHeight: 1,
              letterSpacing: '0.3px', textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              color: logEntry.isWarmup ? 'var(--accent-dim)' : 'var(--text-muted)',
            }}>
              warm-up
            </span>
          )}
        </div>

        {/* Weight + reps inputs. Both are equal-sized fixed boxes with a clear gap
           so they never butt up against each other; their column labels live in the
           header above the sets. The group is flex:1 so the action buttons sit at the
           far right. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
          <input
            ref={weightRef}
            type="text"
            inputMode="decimal"
            value={displayWeight}
            onChange={e => handleWeightChange(e.target.value)}
            onFocus={e => {
              // When BW is shown, clear the buffer so the user types a fresh value
              // rather than appending to the 'BW' text.
              if (displayWeight === 'BW') setRawWeight('')
              else e.target.select()
              ensureVisible(e.currentTarget)
            }}
            onBlur={() => setRawWeight(null)}
            onKeyDown={handleWeightKeyDown}
            disabled={inputsDisabled}
            placeholder="BW"
            aria-label={`Weight for set ${setNumber}`}
            style={{
              width: '56px', flexShrink: 0, height: '40px',
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
          <input
            ref={repsRef}
            type="number"
            inputMode="numeric"
            value={logEntry.reps}
            onChange={e => handleRepsChange(e.target.value)}
            onFocus={e => { e.target.select(); ensureVisible(e.currentTarget) }}
            onBlur={() => setNeedsReps(false)}
            onKeyDown={handleRepsKeyDown}
            disabled={inputsDisabled}
            placeholder="0"
            aria-label={`Reps for set ${setNumber}`}
            aria-invalid={needsReps}
            title={needsReps ? 'Enter a rep count to complete this set' : undefined}
            style={{
              width: '56px', flexShrink: 0, height: '40px',
              backgroundColor: 'var(--surface-elevated)',
              border: `1px solid ${needsReps ? 'var(--danger)' : inputsDisabled ? 'var(--border)' : 'var(--border-strong)'}`,
              borderRadius: '8px',
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '16px',
              textAlign: 'center',
              outline: 'none',
              transition: 'border-color 150ms ease',
            }}
          />
        </div>

        {logEntry.isPR && (
          <span data-onboard="aw-pr" style={{
            fontSize: '10px', fontFamily: "'Bebas Neue', sans-serif",
            color: 'var(--accent-text)',
            backgroundColor: 'rgba(200, 241, 53, 0.1)',
            border: '1px solid rgba(200, 241, 53, 0.3)',
            borderRadius: '9999px', padding: '2px 7px',
            letterSpacing: '0.5px',
          }}>
            PR
          </span>
        )}

        {/* Bonus sets (added via + ADD SET) get a Delete button that removes the
            slot entirely — skipping doesn't make sense for a set that isn't part
            of the planned workout. Sets that are part of the day keep Skip/Undo. */}
        {isBonus ? (
          <button
            className="press"
            onClick={onDelete}
            title="Delete this set"
            aria-label={`Delete set ${setNumber}`}
            style={{
              width: '44px', height: '44px', minWidth: '44px',
              borderRadius: '9999px',
              border: '2px solid var(--border)',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'border-color 150ms ease, background-color 150ms ease',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ color: 'var(--text-muted)' }}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" /><path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        ) : (
          /* Skip / unskip set button. Also enabled in edit mode so the user can
             skip a previously logged set (handleSkipSet will delete the DB row). */
          <button
            className="press"
            data-onboard={onboardFirst ? 'aw-skip' : undefined}
            onClick={logEntry.skipped ? onUnskip : (logEntry.checked && !editing ? undefined : onSkip)}
            disabled={logEntry.checked && !editing}
            title={logEntry.skipped ? 'Undo skip' : 'Skip this set'}
            aria-label={logEntry.skipped ? `Undo skip on set ${setNumber}` : `Skip set ${setNumber}`}
            style={{
              width: '44px', height: '44px', minWidth: '44px',
              borderRadius: '9999px',
              border: `2px solid ${logEntry.skipped ? 'rgba(239,68,68,0.5)' : 'var(--border)'}`,
              backgroundColor: logEntry.skipped ? 'rgba(239,68,68,0.1)' : 'transparent',
              cursor: (logEntry.checked && !editing) ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'border-color 150ms ease, background-color 150ms ease',
              opacity: (logEntry.checked && !editing) ? 0.3 : 1,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
             style={{ color: logEntry.skipped ? 'var(--danger)' : 'var(--border-strong)' }}>
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}

        {/* Check / Save button */}
        {editing ? (
          <button
            onClick={onSaveEdit}
            aria-label={`Save set ${setNumber}`}
            title="Save changes"
            style={{
              // Match the check button's 44×44 circular footprint so swapping
              // check ⇄ save never changes the row layout (and never squeezes
              // the weight input). The filled accent fill reads as "confirm".
              width: '44px', height: '44px', minWidth: '44px',
              borderRadius: '9999px',
              border: '2px solid var(--accent)',
              backgroundColor: 'var(--accent)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'border-color 150ms ease, background-color 150ms ease',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ color: 'var(--on-accent)' }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        ) : (
          <button
            data-onboard={onboardFirst ? 'aw-check' : undefined}
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
             style={{ color: logEntry.checked ? 'var(--accent-text)' : 'var(--text-muted)' }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Always mounted so the field slides rather than snapping (.drawer in
          globals.css); `inert` keeps the hidden input out of the tab order. */}
      <div className="drawer" data-open={noteVisible}>
        {/* The drawer's direct child must be padding-free: `grid-template-rows:
            0fr` only zeroes its CONTENT height, so padding on it survives the
            collapse and (since overflow clips at the padding box) leaves a
            sliver of the input showing under every set. Padding goes one level
            in — same shape as FriendsAccordion/ProfileDashboard. */}
        <div>
        {/* 4px of top padding so the drawer's overflow clip doesn't cut the
            input's keyboard focus ring: outline-offset 2px + outline width 2px
            = 4px of clearance needed, not 2px — with only 2px the ring's top
            edge (and the input's own top border under it) got sliced off. */}
        <div inert={!noteVisible} style={{ padding: '4px 16px 8px' }}>
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
              fontSize: '16px', // ≥16px — anything smaller makes iOS auto-zoom on focus
              padding: '6px 10px',
              outline: 'none',
            }}
          />
        </div>
        </div>
      </div>
    </div>
  )
}
