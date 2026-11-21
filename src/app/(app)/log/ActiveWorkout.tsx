'use client'
import { formatSetsReps } from '@/lib/utils/formatting'
import { parseWeightOverrides } from '@/lib/utils/weightOverrides'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, getClientUser } from '@/lib/supabase/client'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import { demoSafeClient } from '@/lib/demoMode/demoSafeSupabase'
import { Exercise } from '@/lib/types'
import { ALL_BADGES, type BadgeDefinition } from '@/lib/utils/badges'
import BadgeUnlockOverlay from '@/components/BadgeUnlockOverlay'
import { haptic } from '@/lib/utils/haptics'
import { useUnit } from '@/lib/contexts/UnitContext'
import { discardWorkout } from '@/lib/utils/sessions'
import { completeSession } from '@/lib/utils/completeSession'
import {
  queueWorkoutOps,
  isTransientError,
  MAX_SET_WEIGHT_LBS,
  MAX_SET_REPS,
  FLUSHED_EVENT,
  getQueuedOps,
  removeQueuedOp,
  clearQueuedOpsForExercise,
  withRequestTimeout,
  type FlushResult,
  type QueuedOp,
} from '@/lib/utils/offlineQueue'
import { withOfflineGate, browserIsOffline } from '@/lib/offline/offlineGate'
import {
  ensurePendingLocalSession,
  getActiveWorkoutScreenSession,
  setActiveWorkoutScreenSession,
  getPendingLocalSessions,
  isPendingLocalSessionId,
  lastKnownUserId,
  readWorkoutSnapshot,
  rememberUserId,
  resolveSessionAlias,
  saveWorkoutSnapshot,
} from '@/lib/offline/localSession'
import { requestWorkoutFinish, reopenWorkoutDraft, saveWorkoutNote, syncSessionNow } from '@/lib/offline/sync'
import { changeWorkoutStore, loadWorkoutStore, readWorkoutStore, WORKOUT_STORE_EVENT, type SavedSet } from '@/lib/offline/workoutStore'
import { reportError } from '@/lib/utils/reportError'
import { planWarmupRamp } from '@/lib/utils/warmupSets'
import { formatWarmupPercentsList, percentsToFractions, readWarmupPercents } from '@/lib/utils/warmupPrefs'
import {
  emptySetState,
  findCarryReps,
  computeLocalIsPR,
  liveSetIsPR,
  normalizePriorVolume,
  parseRpe,
  overlayQueuedOps,
  extraSetsFromLogs,
  ensureLogSlots,
  mergeSessionExercises,
  readSessionExtraIds,
  writeSessionExtraIds,
  clearSessionExtraIds,
  isSessionExtra,
  sessionExtraIdsFor,
  originalDayIdsFromCatalog,
  extraHasWorkingSet,
  shouldPersistSessionExtra,
  applyFlushResult,
  type LogMap,
  type SetState,
} from './sessionLogState'
import { useRestTimer, getPauseRestOnExit } from '@/lib/hooks/useRestTimer'
import { useTapGesture } from '@/lib/hooks/useTapGesture'
import { resolveRestSeconds, setSessionRest, clearSessionRest, registerProgrammedRest } from '@/lib/utils/restPref'
import { useKeyboardInset } from '@/lib/hooks/useKeyboardInset'
import { useExitingValue } from '@/lib/hooks/useExitingValue'
import RestTimerBar from '@/components/RestTimerBar'
import ToastPill, { TOAST_SLIDE_OUT_MS } from '@/components/ToastPill'
import { requestOpenCoach } from '@/lib/coach/openCoachBus'
import ExercisePickerSheet, { EXERCISE_PICKER_EXIT_MS } from './ExercisePickerSheet'
import PlateCalculator from '@/components/PlateCalculator'
import CompletionModal from './CompletionModal'
import RenameExerciseDialog from './RenameExerciseDialog'
import { performFinishUndo } from '@/lib/utils/finishUndo'
import { markAppDataStale } from '@/lib/cache/appDataCache'
import { useFeatureTooltip } from '@/components/onboarding/useFeatureTooltip'
import Tooltip from '@/components/onboarding/Tooltip'
import { onboardTarget } from '@/components/onboarding/anchor'
import { useOnboarding } from '@/lib/contexts/OnboardingContext'
import {
  cancelRestNotifications,
  clearWorkoutNotifications,
  fetchNotificationPrefs,
  hasSeenPushCoach,
  markPushCoachSeen,
  notifyRestEndedLocally,
  pushSupported,
  scheduleRestNotifications,
  subscribeToPush,
  updateWorkoutStatusNotification,
  WorkoutWakeLock,
  type NotificationPrefs,
} from '@/lib/push'

interface UndoState {
  key: string
  exerciseId: string
  setNumber: number
  expiresAt: number
}

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


export default function ActiveWorkout({ day }: { day: string }) {
  const router = useRouter()
  const { demoMode } = useDemoMode()
  // Every write this screen makes (session_logs, complete_session, badges,
  // rotation) becomes a local no-op while Demo Mode is on — see
  // src/lib/demoMode/demoSafeSupabase.ts. Reads (exercises, last weights)
  // still hit Supabase normally, so the workout UI stays fully populated.
  // `rawSupabase` talks to the network no matter what (sync, session creation);
  // `supabase` is the same client, except `session_logs` writes made while
  // offline — or against a session that only exists on this device so far —
  // fail instantly so the existing "queue it for later" path takes over.
  const rawSupabase = useMemo(
    () => (demoMode ? demoSafeClient(createClient()) : createClient()),
    [demoMode],
  )
  const [sessionId, setSessionId] = useState<string | null>(null)
  const supabase = useMemo(
    () =>
      withOfflineGate(
        rawSupabase,
        // The screen registers its session id in localSession (see the effect
        // that calls setActiveWorkoutScreenSession).
        () => browserIsOffline() || isPendingLocalSessionId(getActiveWorkoutScreenSession()),
      ),
    [rawSupabase],
  )

  const [exercises, setExercises] = useState<Exercise[]>([])
  const [logs, setLogs] = useState<LogMap>({})
  // `previousBests` is the WEIGHT from the most recent completed session per
  // exercise (get_exercise_last_weights) — display only, drives the "prev: X
  // lbs" hint. Deliberately last-session, not all-time-best, so "prev" means
  // what it says even after a deload. A fresh set's actual starting value
  // prefers the exercise's own weight_target (docs/sql/25) when set, falling
  // back to this last-session value otherwise — see the `fillWeights` /
  // `fillWeight` computations at each prefill site (initSession, handleAddSet,
  // handleSwapExercise), which read from `previousBests` but don't feed it.
  // `previousBestVolumes` tracks the session's running best volume (for undo/
  // edit recomputes / display). Live PR *badges* pin to `baselineBestVolumes`
  // (prior-session get_exercise_bests only) so later sets that beat the prior
  // best still badge — matching server grind_recompute_stats (docs/sql/15 + 51).
  // A missing prior is the first-session baseline (not a PR).
  // `baselineBests`/`baselineBestVolumes` stay frozen at the DB values from
  // session start.
  const [previousBests, setPreviousBests] = useState<PreviousBest>({})
  const [baselineBests, setBaselineBests] = useState<PreviousBest>({})
  const [previousBestVolumes, setPreviousBestVolumes] = useState<PreviousBest>({})
  const [baselineBestVolumes, setBaselineBestVolumes] = useState<PreviousBest>({})
  // handleCheck/saveEdit read this so PostgREST numeric strings and missing
  // priors normalize the same way as the server (null prior = baseline).
  // Synced in a layout effect (not during render) so the ref write can't be
  // read as a render-time side effect, while still landing before any event
  // handler could plausibly fire against a stale value.
  const baselineBestVolumesRef = useRef(baselineBestVolumes)
  useLayoutEffect(() => {
    baselineBestVolumesRef.current = baselineBestVolumes
  }, [baselineBestVolumes])
  const [startedAt, setStartedAt] = useState<Date>(new Date())
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)
  /** The exercise catalog read failed — show a retry, not the empty-day screen. */
  const [loadError, setLoadError] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [completionData, setCompletionData] = useState<CompletionData | null>(null)
  // Non-null right after a finish that earned badges — shown before
  // CompletionModal (which is already queued in completionData underneath).
  const [badgeUnlock, setBadgeUnlock] = useState<BadgeDefinition[] | null>(null)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [allExercises, setAllExercises] = useState<Exercise[]>([])
  const [swapTarget, setSwapTarget] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<Exercise | null>(null)
  const [addExerciseOpen, setAddExerciseOpen] = useState(false)
  const [extraSets, setExtraSets] = useState<Record<string, number>>({})
  // Coach "lighter weights today" (sessions.weight_overrides), canonical lbs.
  const [weightOverrides, setWeightOverrides] = useState<Record<string, number>>({})
  const [workoutNote, setWorkoutNote] = useState('')
  const workoutOwnerRef = useRef<string | null>(null)
  const [workoutOwner, setWorkoutOwner] = useState<string | null>(null)
  const noteWriteRef = useRef<Promise<void> | null>(null)
  const storageFailureRef = useRef(new Set<string>())
  const [storageError, setStorageError] = useState(false)
  const [, setStoreVersion] = useState(0)

  useEffect(() => {
    const onStore = (event: Event) => {
      if ((event as CustomEvent<string>).detail === workoutOwnerRef.current) setStoreVersion(version => version + 1)
    }
    window.addEventListener(WORKOUT_STORE_EVENT, onStore)
    return () => window.removeEventListener(WORKOUT_STORE_EVENT, onStore)
  }, [])

  // Notes from the most recent completed session of each exercise, keyed
  // `${exerciseId}-${setNumber}`, plus that day's last workout note. Read-only
  // hints so last time's notes are visible mid-workout.
  const [lastSetNotes, setLastSetNotes] = useState<Record<string, string>>({})
  const [lastWorkoutNote, setLastWorkoutNote] = useState('')
  const [undoState, setUndoState] = useState<UndoState | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [resumeToast, setResumeToast] = useState<string | null>(null)
  // Passive "X saved" confirmation, anchored at the bottom. Distinct from the
  // top undo toast (which is actionable): this one just reassures the user that
  // an edit/note/swap actually persisted, then fades on its own.
  const [saveToast, setSaveToast] = useState<string | null>(null)
  const saveToastTimer = useRef<NodeJS.Timeout | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const discardingRef = useRef(false)
  const finishingRef = useRef(false)
  const skippingKeysRef = useRef<Set<string>>(new Set())
  const addingIdsRef = useRef<Set<string>>(new Set())
  const removingIdsRef = useRef<Set<string>>(new Set())
  /** Active catalog ids this day had when the session started — extras are anything else. */
  const originalDayIdsRef = useRef<Set<string>>(new Set())
  const [originalDayIds, setOriginalDayIds] = useState<Set<string>>(() => new Set())
  const createdThisSessionIdsRef = useRef<Set<string>>(new Set())
  const [plateCalcTarget, setPlateCalcTarget] = useState<{ key: string; current: number } | null>(null)
  const [warmupUndo, setWarmupUndo] = useState<Record<string, { extrasBefore: number; logsBefore: LogMap }>>({})
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const restExerciseIds = useMemo(() => new Set(exercises.map(exercise => exercise.id)), [exercises])
  const restTimer = useRestTimer(sessionId, workoutOwner, restExerciseIds)
  const keyboardInset = useKeyboardInset()
  // Keep each toast's last content around through its exit animation instead
  // of yanking it off screen the instant its owning state clears.
  const undoToastExit = useExitingValue(undoState, TOAST_SLIDE_OUT_MS)
  const resumeToastExit = useExitingValue(resumeToast, TOAST_SLIDE_OUT_MS)
  const saveToastExit = useExitingValue(saveToast, TOAST_SLIDE_OUT_MS)
  const pickerKey = addExerciseOpen ? 'add' : swapTarget ? `swap:${swapTarget}` : null
  const pickerExit = useExitingValue(pickerKey, EXERCISE_PICKER_EXIT_MS)
  const plateExit = useExitingValue(plateCalcTarget, 240)
  const renameExit = useExitingValue(renameTarget, 240)
  const [enteredExerciseId, setEnteredExerciseId] = useState<string | null>(null)
  const { hasSeenTooltip, markTooltipSeen } = useOnboarding()

  // Web Push prefs + wake lock (rest-end / hybrid status while backgrounded).
  const [pushPrefs, setPushPrefs] = useState<NotificationPrefs | null>(null)
  const pushPrefsRef = useRef<NotificationPrefs | null>(null)
  const wakeLockRef = useRef<WorkoutWakeLock | null>(null)
  if (wakeLockRef.current === null) wakeLockRef.current = new WorkoutWakeLock()
  const [pushCoachOpen, setPushCoachOpen] = useState(false)
  const [pushCoachBusy, setPushCoachBusy] = useState(false)
  const restStartedOnce = useRef(false)
  const setCompletionNotifyDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Flag the document while a live workout is on screen so landscape-phone CSS
  // can drop the top nav / sidebar without relying on :has() support.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('in-workout')
    return () => root.classList.remove('in-workout')
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadPrefs() {
      const prefs = await fetchNotificationPrefs()
      if (cancelled || !prefs) return
      setPushPrefs(prefs)
      pushPrefsRef.current = prefs
    }
    void loadPrefs()
    // Re-read when returning to the tab so Profile toggles mid-workout apply
    // instead of keeping the mount-time snapshot (unexpected rest pings).
    function onVisibility() {
      if (document.visibilityState === 'visible') void loadPrefs()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    pushPrefsRef.current = pushPrefs
  }, [pushPrefs])

  // Screen Wake Lock while a live session is open and visible.
  useEffect(() => {
    if (!sessionId || completionData) {
      void wakeLockRef.current?.release()
      return
    }
    void wakeLockRef.current?.acquire()
    return () => { void wakeLockRef.current?.release() }
  }, [sessionId, completionData])

  // Schedule / cancel server + local rest notifications from timer transitions
  // (not remainingMs — that ticks every 250ms). Pause/stop cancels; natural end
  // (remaining hit 0 with exerciseId still set) is handled by the deliver effect
  // below so we don't wipe the cron fallback before a remount can notify.
  useEffect(() => {
    if (!sessionId) return
    const prefs = pushPrefsRef.current

    if (restTimer.paused) {
      void cancelRestNotifications(sessionId)
      return
    }
    if (!restTimer.exerciseId) {
      // Explicit stop() clears exerciseId — cancel schedules. Expired remounts
      // restore exerciseId with remainingMs=0 (see useRestTimer) so they hit
      // the natural-end branch below instead of wiping the cron fallback first.
      void cancelRestNotifications(sessionId)
      return
    }
    if (!restTimer.active) {
      // Natural end (remaining hit 0) — deliver path below owns cancel-after-notify.
      return
    }
    // Prefs still loading — wait; effect re-runs when they arrive.
    if (!prefs) return
    if (!prefs.enabled || !prefs.rest_complete) {
      void cancelRestNotifications(sessionId)
      return
    }

    const endsAtMs = restTimer.startedAt + restTimer.durationMs
    // Don't schedule if the timer has already expired - prevents spam when
    // adjusting time after rest has ended or when effect re-runs at 0.
    if (endsAtMs <= Date.now()) {
      return
    }

    const durationSec = Math.round(restTimer.durationMs / 1000)
    const exerciseName = exercises.find(e => e.id === restTimer.exerciseId)?.name ?? ''
    void scheduleRestNotifications({
      sessionId,
      exerciseId: restTimer.exerciseId,
      exerciseName,
      endsAtMs,
      durationSec,
      prefs,
    })
  }, [
    sessionId,
    restTimer.active,
    restTimer.paused,
    restTimer.exerciseId,
    restTimer.startedAt,
    restTimer.durationMs,
    exercises,
    pushPrefs?.enabled,
    pushPrefs?.rest_complete,
    pushPrefs?.rest_warning_10s,
  ])

  // When the in-page rest tick hits 0 (or an expired timer was restored on
  // remount), deliver rest-end once if backgrounded, then cancel server rows so
  // Hobby cron can't fire an hour later. Deduped inside notifyRestEndedLocally
  // against the page setTimeout path.
  const restEndNotifiedKey = useRef<string | null>(null)
  useEffect(() => {
    if (!sessionId || !restTimer.exerciseId) return
    if (restTimer.paused || restTimer.remainingMs > 0) return
    const prefs = pushPrefsRef.current
    if (!prefs?.enabled || !prefs.rest_complete) {
      // Prefs off — still cancel any leftover server rows from before the toggle.
      void cancelRestNotifications(sessionId)
      return
    }

    const endsAtMs = restTimer.startedAt + restTimer.durationMs
    const key = `${sessionId}:${restTimer.exerciseId}:${restTimer.startedAt}`
    if (restEndNotifiedKey.current === key) return
    restEndNotifiedKey.current = key

    const exerciseName = exercises.find(e => e.id === restTimer.exerciseId)?.name ?? ''
    const backgrounded =
      typeof document !== 'undefined' && document.visibilityState === 'hidden'
    if (backgrounded) {
      notifyRestEndedLocally(exerciseName, { endsAtMs, sessionId })
    } else {
      // Foreground: user already saw the rest bar hit 0 — just clear fallbacks.
      void cancelRestNotifications(sessionId)
    }
  }, [
    sessionId,
    restTimer.exerciseId,
    restTimer.startedAt,
    restTimer.durationMs,
    restTimer.remainingMs,
    restTimer.paused,
    exercises,
  ])

  // Soft coach mark after the first rest of a session (once per install).
  useEffect(() => {
    if (!restTimer.active || restStartedOnce.current) return
    restStartedOnce.current = true
    if (hasSeenPushCoach()) return
    if (!pushSupported()) return
    if (pushPrefsRef.current?.enabled) return
    setPushCoachOpen(true)
  }, [restTimer.active])

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
  // Clear the pending notification debounce timer on unmount
  useEffect(() => () => { if (setCompletionNotifyDebounce.current) clearTimeout(setCompletionNotifyDebounce.current) }, [])
  // handleCheck reads this after an `await`, by which point another set may have
  // been checked (and re-rendered) in the meantime — the `logs` captured in its
  // own closure would be stale. The ref always reflects the latest committed state.
  const logsRef = useRef<LogMap>(logs)
  useEffect(() => { logsRef.current = logs }, [logs])

  /** Keep logsRef in sync inside setState updaters so rest/completion checks
   *  don't race on a stale ref between paint and the effect above. */
  function commitLogs(updater: (prev: LogMap) => LogMap) {
    setLogs(prev => {
      const next = updater(prev)
      logsRef.current = next
      return next
    })
  }

  // Replay anything queued by the offline fallbacks below (check, edit, skip/
  // unskip, delete) — once on mount (in case the connection was already back
  // by the time the app reopened) and again whenever the browser regains
  // connectivity mid-workout.
  useEffect(() => {
    if (!sessionId) return
    const sid = sessionId
    function apply(result: FlushResult) {
      if (result.synced.length === 0 && result.rejected.length === 0) return
      setLogs(prev => applyFlushResult(prev, result))
      if (result.rejected.length > 0) {
        setResumeToast("Couldn't save that set — check the weight and reps.")
        setTimeout(() => setResumeToast(null), 4000)
      }
    }
    async function syncNow() {
      try {
        const { result, completion } = await syncSessionNow(sid, rawSupabase, workoutOwnerRef.current ?? undefined)
        apply(result)
        if (completion?.ok && !finishingRef.current) {
          markAppDataStale()
          router.replace('/home')
        }
      } catch (error) {
        reportError(error, { operation: 'syncWorkout', route: '/log' })
      }
    }
    // The background agent (OfflineSyncAgent) flushes on reconnect and on its
    // backoff timer; this screen just reflects what it did.
    function onFlushed(e: Event) {
      const detail = (e as CustomEvent<{ sessionId: string; result: FlushResult }>).detail
      if (detail?.sessionId === resolveSessionAlias(sid)) apply(detail.result)
    }
    function onCompleted(event: Event) {
      if ((event as CustomEvent<string>).detail === sid && !finishingRef.current) {
        router.replace('/home')
      }
    }
    window.addEventListener('grind:workout-complete', onCompleted)
    void syncNow()
    window.addEventListener('online', syncNow)
    window.addEventListener(FLUSHED_EVENT, onFlushed)
    return () => {
      window.removeEventListener('online', syncNow)
      window.removeEventListener('grind:workout-complete', onCompleted)
      window.removeEventListener(FLUSHED_EVENT, onFlushed)
    }
  }, [sessionId, rawSupabase, router])

  useEffect(() => {
    setActiveWorkoutScreenSession(sessionId)
    return () => setActiveWorkoutScreenSession(null)
  }, [sessionId])

  useEffect(() => {
    // Freeze the displayed elapsed time once the workout is finished — otherwise
    // it keeps visibly ticking up behind the completion modal (through its close
    // animation and the navigation back to /home) even though the workout is done.
    if (completionData) return
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000))
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [startedAt, completionData])

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

  function changeWorkoutNote(text: string) {
    setWorkoutNote(text)
    const owner = workoutOwnerRef.current
    if (!owner || !sessionId || demoMode) return
    const write = saveWorkoutNote(owner, sessionId, text)
    noteWriteRef.current = write
    void write.then(() => {
      if (noteWriteRef.current !== write) return
      storageFailureRef.current.delete('note')
      setStorageError(storageFailureRef.current.size > 0)
    }, () => {
      if (noteWriteRef.current !== write) return
      storageFailureRef.current.add('note')
      setStorageError(true)
    })
  }

  useEffect(() => {
    const owner = workoutOwnerRef.current
    if (!sessionId || !owner || demoMode) return
    const timer = setTimeout(() => {
      if (readWorkoutStore(owner).notes[sessionId]) {
        void syncSessionNow(sessionId, rawSupabase, owner).catch(() => {})
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [sessionId, workoutNote, rawSupabase, demoMode])

  // Last completed session's set notes per exercise (+ the day's last workout
  // note). Best-effort: a failed read just means no hints.
  const loadLastNotes = useCallback(async (exerciseIds: string[], currentSessionId: string) => {
    if (exerciseIds.length === 0) return
    const { data } = await supabase
      .from('session_logs')
      .select('exercise_id, set_number, note, session_id, sessions!inner(started_at, completed_at, day_type, note)')
      .in('exercise_id', exerciseIds)
      .not('weight', 'is', null)
      .not('sessions.completed_at', 'is', null)
      .neq('session_id', currentSessionId)
      .order('started_at', { referencedTable: 'sessions', ascending: false })
      .limit(400)
    type Row = {
      exercise_id: string
      set_number: number
      note: string | null
      session_id: string
      sessions: { started_at: string; day_type: string; note: string | null } | { started_at: string; day_type: string; note: string | null }[]
    }
    const rows = ((data ?? []) as Row[]).map(r => ({
      ...r,
      sess: Array.isArray(r.sessions) ? r.sessions[0] : r.sessions,
    }))
    const newestPerExercise: Record<string, { sid: string; at: string }> = {}
    for (const r of rows) {
      const cur = newestPerExercise[r.exercise_id]
      if (!cur || r.sess.started_at > cur.at) newestPerExercise[r.exercise_id] = { sid: r.session_id, at: r.sess.started_at }
    }
    const notes: Record<string, string> = {}
    let dayNote = ''
    let dayNoteAt = ''
    for (const r of rows) {
      if (newestPerExercise[r.exercise_id]?.sid === r.session_id && r.note) {
        notes[`${r.exercise_id}-${r.set_number}`] = r.note
      }
      if (r.sess.day_type === day && r.sess.note && r.sess.started_at > dayNoteAt) {
        dayNote = r.sess.note
        dayNoteAt = r.sess.started_at
      }
    }
    setLastSetNotes(notes)
    setLastWorkoutNote(dayNote)
  }, [supabase, day])

  const initSession = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    // Stay on the loader while redirecting to /login (don't flash the empty state).
    let redirecting = false
    try {
    originalDayIdsRef.current = new Set()
    setOriginalDayIds(new Set())
    createdThisSessionIdsRef.current = new Set()
    const user = await getClientUser(supabase)
    let userId: string | null = user?.id ?? null
    if (user) {
      rememberUserId(user.id)
    } else {
      // No session and no way to ask the server: with a remembered account this
      // is a dead connection (an expired token can't refresh offline), not a
      // sign-out — sign-out forgets the account. Never bounce to /login here.
      userId = lastKnownUserId()
      if (!userId || !browserIsOffline()) { redirecting = true; router.push('/login'); return }
    }

    if (!userId) return
    workoutOwnerRef.current = userId
    setWorkoutOwner(userId)
    if (!demoMode) await loadWorkoutStore(userId).catch(() => {})
    const pendingDraft = getPendingLocalSessions(userId).find(p => p.day === day)

    // What the device remembers from the last online load: lets a workout start
    // with no signal at all (see src/lib/offline/localSession.ts).
    const snapshot = readWorkoutSnapshot<Exercise>(userId)
    let offlineStart = browserIsOffline()

    // One catalog read (was two sequential ones): the day's exercises are just
    // a slice of the full list, already in sort_order within each day_type.
    let allExsData: Exercise[] | null = null
    if (offlineStart && snapshot) {
      allExsData = snapshot.exercises
    } else {
      const res = await withRequestTimeout(
        Promise.resolve(
          supabase
            .from('exercises')
            .select('*')
            .order('day_type', { ascending: true })
            .order('sort_order', { ascending: true }),
        ),
        10_000,
      )
      if (res.error) {
        // A dead link with a saved catalog starts the workout from the device
        // copy; a dropped read with nothing saved is not an empty day: say so
        // and offer a retry.
        if (snapshot && isTransientError(res.error)) {
          allExsData = snapshot.exercises
          offlineStart = true
        } else {
          throw res.error
        }
      } else {
        allExsData = (res.data ?? []) as Exercise[]
      }
    }
    const allDayExs = (allExsData ?? []).filter(ex => ex.day_type === day)

    if (allDayExs.length === 0) { setLoading(false); return }

    setAllExercises(allExsData ?? [])
    registerProgrammedRest(allExsData ?? [])

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

    // Atomic create-or-resume — prevents two tabs from forking open sessions.
    // Kicked off now so it overlaps the "best" lookups below instead of
    // waiting behind them (we only get here once the day has exercises, so an
    // empty day never creates a session).
    // Offline (or a dead link): resolve instantly with a transient error and
    // fall through to a device-local session below.
    const resumePromise = offlineStart || pendingDraft
      ? Promise.resolve({ data: null, error: { message: 'offline', code: '' } })
      : withRequestTimeout(
          Promise.resolve(supabase.rpc('start_or_resume_session', { p_day_type: day })),
          10_000,
        )

    // Two batch RPCs — was N sequential queries (one per exercise). `bests` (the
    // "prev: X lbs" hint, display-only) comes from the most recent completed
    // session's weight for the exercise, NOT the all-time max — a deload or
    // lighter session should show as "prev", not the old PR weight.
    // `bestVolumes` stays all-time-best: it backs the live PR bar-to-beat, which
    // is genuinely volume-vs-ever (mirrors grind_recompute_stats server-side).
    const bests: PreviousBest = {}
    const bestVolumes: PreviousBest = {}
    const exerciseIds = exs.map(e => e.id)
    if (exerciseIds.length > 0 && !offlineStart) {
      const [{ data: lastWeightRows, error: lastWeightError }, { data: bestRows }] = await Promise.all([
        withRequestTimeout(
          Promise.resolve(supabase.rpc('get_exercise_last_weights', { p_exercise_ids: exerciseIds })),
          10_000,
        ),
        withRequestTimeout(
          Promise.resolve(supabase.rpc('get_exercise_bests', { p_exercise_ids: exerciseIds })),
          10_000,
        ),
      ])
      if (lastWeightError) {
        // get_exercise_last_weights (docs/sql/24) missing or erroring — fall
        // back to all-time-best weight rather than leaving prefill blank.
        console.error('get_exercise_last_weights failed, falling back to all-time best:', lastWeightError)
      }
      for (const row of (lastWeightRows ?? []) as {
        exercise_id: string
        last_weight: number | null
      }[]) {
        bests[row.exercise_id] = normalizePriorVolume(row.last_weight)
      }
      for (const row of (bestRows ?? []) as {
        exercise_id: string
        max_weight: number | null
        max_volume: number | null
      }[]) {
        if (lastWeightError) bests[row.exercise_id] = normalizePriorVolume(row.max_weight)
        bestVolumes[row.exercise_id] = normalizePriorVolume(row.max_volume)
      }
    }
    // Anything the server didn't answer for (offline, timeout) comes from the
    // numbers saved at the last online load, so "prev" and the PR bar still work.
    for (const ex of exs) {
      if (snapshot && !(ex.id in bests) && ex.id in snapshot.bests) bests[ex.id] = snapshot.bests[ex.id]
      if (snapshot && !(ex.id in bestVolumes) && ex.id in snapshot.bestVolumes) {
        bestVolumes[ex.id] = snapshot.bestVolumes[ex.id]
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
    // Keep a device copy of what an offline start needs (catalog + prev/PR
    // numbers). Skipped when this load itself came from that copy.
    if (!offlineStart && allExsData) saveWorkoutSnapshot(userId, allExsData, bests, bestVolumes)

    // What a fresh, never-logged set actually prefills with — separate from
    // `bests` above (which stays last-session-only, driving the "prev:" hint).
    // Prefer the exercise's own weight_target (set once when adding/editing it,
    // docs/sql/25); fall back to last session's weight when no target is set.
    // `?? ` is correct here (not `||`) so a target of exactly 0 (bodyweight) is
    // honored rather than falling through.
    const fillWeights: PreviousBest = {}
    for (const ex of exs) {
      fillWeights[ex.id] = ex.weight_target ?? bests[ex.id]
    }

    let { data: resumeData, error: resumeError } = await resumePromise

    // Couldn't reach the server (offline, hung request, flaky cell): start — or
    // pick back up — a session on this device. Sets queue locally and the sync
    // agent creates the real session the moment a connection returns.
    if ((resumeError || !resumeData) && (!resumeError || isTransientError(resumeError)) && (snapshot || pendingDraft) && !demoMode) {
      const cached = Object.values(readWorkoutStore(userId).resume)
        .find(entry => entry.day === day && (!pendingDraft || entry.id === pendingDraft.id))
      const alreadyStarted = !!pendingDraft || !!cached
      const local = pendingDraft ?? cached ?? await ensurePendingLocalSession(day, userId)
      resumeData = {
        session: { id: local.id, started_at: local.startedAt, note: cached?.note ?? null },
        logs: cached?.logs ?? [],
        resumed: alreadyStarted,
      }
      resumeError = null
      offlineStart = true
    }

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
      logs: SavedSet[]
      resumed?: boolean
    }

    const session = resumePayload.session
    const sid = session.id
    const sessionStart = new Date(session.started_at)
    setWorkoutNote(readWorkoutStore(userId).notes[sid]?.text ?? session.note ?? '')
    void loadLastNotes(exs.map(e => e.id), sid)
    const existingLogs: SavedSet[] = Array.isArray(resumePayload.logs)
      ? resumePayload.logs
      : []
    if (!demoMode) {
      await changeWorkoutStore(userId, state => {
        if (!state.resume[sid] || !offlineStart) {
          state.resume[sid] = { id: sid, day, startedAt: session.started_at,
            note: session.note ?? null, logs: existingLogs }
        }
      }).catch(() => setStorageError(true))
    }

    const loggedExerciseIds = new Set(existingLogs.map(l => l.exercise_id))
    for (const q of getQueuedOps(sid)) loggedExerciseIds.add(q.exerciseId)
    const persistedExtraIds = readSessionExtraIds(sid)
    for (const id of persistedExtraIds) loggedExerciseIds.add(id)
    originalDayIdsRef.current = new Set(
      originalDayIdsFromCatalog(
        allDayExs.filter(ex => ex.active).map(ex => ex.id),
        persistedExtraIds,
      ),
    )
    setOriginalDayIds(originalDayIdsRef.current)
    let sessionExs = allDayExs.filter(ex => ex.active || loggedExerciseIds.has(ex.id))
    if (sessionExs.length === 0) sessionExs = allDayExs
    sessionExs = mergeSessionExercises(sessionExs, allExsData ?? [], loggedExerciseIds)
    if (sessionExs.length !== exs.length || sessionExs.some((e, i) => e.id !== exs[i]?.id)) {
      exs = sessionExs
      setExercises(exs)
    }

    const missingPriorIds = exs.filter(e => !(e.id in bests)).map(e => e.id)
    if (missingPriorIds.length > 0 && !offlineStart) {
      const [{ data: extraLastRows, error: extraLastError }, { data: extraBestRows }] = await Promise.all([
        supabase.rpc('get_exercise_last_weights', { p_exercise_ids: missingPriorIds }),
        supabase.rpc('get_exercise_bests', { p_exercise_ids: missingPriorIds }),
      ])
      for (const row of (extraLastRows ?? []) as { exercise_id: string; last_weight: number | null }[]) {
        bests[row.exercise_id] = normalizePriorVolume(row.last_weight)
      }
      for (const row of (extraBestRows ?? []) as {
        exercise_id: string
        max_weight: number | null
        max_volume: number | null
      }[]) {
        if (extraLastError) bests[row.exercise_id] = normalizePriorVolume(row.max_weight)
        bestVolumes[row.exercise_id] = normalizePriorVolume(row.max_volume)
      }
      for (const id of missingPriorIds) {
        if (!(id in bests)) bests[id] = null
        if (!(id in bestVolumes)) bestVolumes[id] = null
        const row = exs.find(e => e.id === id)
        fillWeights[id] = row?.weight_target ?? bests[id]
      }
      setPreviousBests({ ...bests })
      setBaselineBests({ ...bests })
      setPreviousBestVolumes({ ...bestVolumes })
      setBaselineBestVolumes({ ...bestVolumes })
    }

    // Today-only weights from the Coach's "lighter weights today" (migration
    // 60). They win over weight_target / last weight for sets not logged yet;
    // logged sets keep what was lifted. Missing column or a failed read just
    // means no overrides: the workout prefills as usual.
    let todayOverrides: Record<string, number> = {}
    if (!offlineStart) {
      const { data: ovRow } = await supabase
        .from('sessions')
        .select('weight_overrides')
        .eq('id', sid)
        .maybeSingle()
      todayOverrides = parseWeightOverrides((ovRow as { weight_overrides?: unknown } | null)?.weight_overrides)
      for (const [id, lbs] of Object.entries(todayOverrides)) {
        if (id in fillWeights || exs.some(e => e.id === id)) fillWeights[id] = lbs
      }
    }
    setWeightOverrides(todayOverrides)
    if (Object.keys(todayOverrides).length > 0) {
      setResumeToast("Coach's lighter weights are prefilled for today")
      setTimeout(() => setResumeToast(null), 4000)
    }

    if (existingLogs.length > 0 || resumePayload.resumed) {
      const restored: LogMap = {}
      for (const ex of exs) {
        for (let s = 1; s <= ex.sets_target; s++) {
          const key = `${ex.id}-${s}`
          restored[key] = emptySetState(
            fillWeights[ex.id] !== null ? String(fillWeights[ex.id]) : '',
          )
        }
      }
      for (const log of existingLogs) {
        const key = `${log.exercise_id}-${log.set_number}`
        const isWarmup = !!log.is_warmup
        // Open sessions store is_pr=false (client writes ignored); recompute locally.
        const localPR =
          !log.is_skipped &&
          log.reps != null &&
          computeLocalIsPR(isWarmup, log.weight, log.reps, bestVolumes[log.exercise_id])
        restored[key] = log.is_skipped
          ? { ...restored[key], checked: false, skipped: true, isPR: false, logId: log.id }
          : {
              weight: log.weight !== null ? String(log.weight) : '',
              reps: log.reps !== null ? String(log.reps) : '',
              checked: true,
              skipped: false,
              isPR: localPR,
              isWarmup,
              note: log.note ?? '',
              rpe: log.rpe != null ? String(log.rpe) : '',
              logId: log.id,
            }
      }
      overlayQueuedOps(restored, sid)
      const extras = extraSetsFromLogs(restored, exs)
      ensureLogSlots(
        restored,
        exs,
        extras,
        id => (fillWeights[id] !== null ? String(fillWeights[id]) : ''),
      )
      setExtraSets(extras)
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
          prefilled[key] = emptySetState(
            fillWeights[ex.id] !== null ? String(fillWeights[ex.id]) : '',
          )
        }
      }
      // A brand-new session can still have offline-queued sets if every write
      // failed before the app was closed (so no session_logs rows exist yet)
      // — same overlay as the resumed branch above.
      overlayQueuedOps(prefilled, sid)
      const extras = extraSetsFromLogs(prefilled, exs)
      ensureLogSlots(
        prefilled,
        exs,
        extras,
        id => (fillWeights[id] !== null ? String(fillWeights[id]) : ''),
      )
      setExtraSets(extras)
      setLogs(prefilled)
    }

    setSessionId(sid)
    setStartedAt(sessionStart)
    setElapsed(Math.floor((Date.now() - sessionStart.getTime()) / 1000))
    setLoading(false)
    markAppDataStale()
    } catch (err) {
      reportError(err, { operation: 'initSession', route: '/log' })
      setLoadError(true)
    } finally {
      if (!redirecting) setLoading(false)
    }
  }, [day, supabase, router, loadLastNotes, demoMode, setStorageError])

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

  // Single pass over logs, recomputed only when exercises/logs actually
  // change — not on every elapsed-timer tick (setInterval re-renders this
  // component every second for the duration of the workout).
  const setCounts = useMemo(() => {
    // Include bonus sets so progress never reads e.g. "4 / 3 sets" / >100%.
    const total = exercises.reduce(
      (sum, ex) => sum + ex.sets_target + (extraSets[ex.id] ?? 0),
      0,
    )
    let checked = 0
    let skipped = 0
    for (const l of Object.values(logs)) {
      if (l.checked) checked++
      else if (l.skipped) skipped++
    }
    const percent = total === 0 ? 0 : Math.min(100, ((checked + skipped) / total) * 100)
    return { total, checked, skipped, percent }
  }, [exercises, logs, extraSets])

  const allSetsProcessed = useMemo(() => {
    if (exercises.length === 0) return false
    for (const ex of exercises) {
      const n = ex.sets_target + (extraSets[ex.id] ?? 0)
      for (let s = 1; s <= n; s++) {
        const l = logs[`${ex.id}-${s}`]
        if (!l || (!l.checked && !l.skipped)) return false
      }
    }
    return true
  }, [exercises, logs, extraSets])

  // When every set is checked or skipped, stop any running rest so Finish is
  // primary — don't leave the CTA buried behind a countdown with nothing left to rest for.
  useEffect(() => {
    if (!allSetsProcessed || !restTimer.active) return
    restTimer.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stop on completion only
  }, [allSetsProcessed, restTimer.active])

  /** Matches server grind_session_has_working_set: non-warmup, non-skipped, weight+reps. */
  function hasWorkingSet(): boolean {
    return Object.values(logs).some(l => {
      if (!l.checked || l.skipped || l.isWarmup) return false
      const w = l.weight !== '' ? parseFloat(l.weight) : NaN
      const r = l.reps !== '' ? parseInt(l.reps, 10) : NaN
      return Number.isFinite(w) && Number.isFinite(r)
    })
  }

  function hasPendingSync(): boolean {
    if (!sessionId) return false
    if (getQueuedOps(sessionId).length > 0) return true
    return Object.values(logs).some(l => l.pendingSync)
  }

  /** Unique sets waiting on the offline queue or still flagged pendingSync. */
  function pendingSyncCount(): number {
    if (!sessionId) return 0
    const keys = new Set<string>()
    for (const op of getQueuedOps(sessionId)) {
      keys.add(`${op.exerciseId}-${op.setNumber}`)
    }
    for (const [k, l] of Object.entries(logs)) {
      if (l.pendingSync) keys.add(k)
    }
    return keys.size
  }

  function persistQueuedOp(op: QueuedOp) { return persistQueuedOps([op]) }

  async function persistQueuedOps(ops: QueuedOp[]) {
    const keys = ops.map(op => op.exerciseId + '-' + op.setNumber)
    const write = queueWorkoutOps(ops, workoutOwnerRef.current)
    inflightSavesRef.current.add(write)
    try {
      await write
      for (const key of keys) storageFailureRef.current.delete(key)
      setStorageError(storageFailureRef.current.size > 0)
      return true
    } catch (error) {
      for (const key of keys) storageFailureRef.current.add(key)
      setStorageError(true)
      setResumeToast('This edit could not be saved on this device. Try again.')
      reportError(error, { operation: 'persistWorkoutEdit', route: '/log' })
      return false
    } finally {
      inflightSavesRef.current.delete(write)
    }
  }

  function syncQueuedEdits(sid: string) {
    const owner = workoutOwnerRef.current
    if (!owner || demoMode) return
    if (browserIsOffline()) showQueuedSyncToast()
    else void syncSessionNow(sid, rawSupabase, owner).catch(() => {})
  }

  async function retryPendingSync() {
    if (!sessionId) return
    const { result } = await syncSessionNow(sessionId, rawSupabase)
    if (result.rejected.length > 0) {
      setLogs(prev => applyFlushResult(prev, result))
      setResumeToast("Couldn't save that set — check the weight and reps.")
      setTimeout(() => setResumeToast(null), 4000)
      return
    }
    if (result.synced.length === 0) {
      setResumeToast('Still waiting for a connection…')
      setTimeout(() => setResumeToast(null), 3000)
      return
    }
    setLogs(prev => applyFlushResult(prev, result))
  }

  function totalSets(): number {
    return setCounts.total
  }
  function checkedSets(): number {
    return setCounts.checked
  }
  function skippedSets(): number {
    return setCounts.skipped
  }
  function progressPercent(): number {
    return setCounts.percent
  }

  // Track set counts in a ref so visibility listener always reads fresh values.
  const setCountsRef = useRef(setCounts)
  useEffect(() => {
    setCountsRef.current = setCounts
  }, [setCounts])

  // Track last notified state to avoid redundant notifications.
  const lastNotifiedState = useRef<{ checked: number; total: number; resting: boolean } | null>(null)

  // Hybrid workout status card when backgrounded; clear tags on return.
  useEffect(() => {
    if (!sessionId || completionData) return

    function onVisibility() {
      void wakeLockRef.current?.onVisibilityChange()
      const prefs = pushPrefsRef.current
      if (document.visibilityState === 'hidden') {
        if (prefs?.enabled && prefs.workout_status) {
          const resting = restTimer.active && !restTimer.paused
          const checked = setCountsRef.current.checked
          const total = setCountsRef.current.total
          
          // Only notify if state changed since last notification
          const lastState = lastNotifiedState.current
          if (
            !lastState ||
            lastState.checked !== checked ||
            lastState.total !== total ||
            lastState.resting !== resting
          ) {
            lastNotifiedState.current = { checked, total, resting }
            updateWorkoutStatusNotification({
              resting,
              exerciseName: resting
                ? (exercises.find(e => e.id === restTimer.exerciseId)?.name ?? undefined)
                : undefined,
              remainingMs: resting ? restTimer.remainingMs : undefined,
              doneSets: checked,
              totalSets: total,
            })
          }
        }
      } else {
        clearWorkoutNotifications()
        // Don't clear lastNotifiedState - keep it so we can detect changes on next background
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
    // restTimer fields / set counts are read at hide-time; listing them would
    // re-bind the listener every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, completionData, exercises])

  function updateLog(key: string, field: 'weight' | 'reps' | 'note' | 'rpe', value: string) {
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

  const checkingKeysRef = useRef<Set<string>>(new Set())
  // Optimistic set writes still on the wire — Finish waits for these.
  const inflightSavesRef = useRef<Set<Promise<unknown>>>(new Set())

  async function handleCheck(exerciseId: string, setNumber: number) {
    const key = `${exerciseId}-${setNumber}`
    // Prefer the live ref — a second tap while the first await is in flight
    // would otherwise see a stale closed-over `logs` and double-upsert / rest-start.
    const logEntry = logsRef.current[key] ?? logs[key]
    if (!logEntry || !sessionId || logEntry.checked || checkingKeysRef.current.has(key)) return
    checkingKeysRef.current.add(key)

    try {
      const weight = logEntry.weight !== '' ? parseFloat(logEntry.weight) : NaN
      if (!Number.isFinite(weight) || weight < 0) return

      // If reps not entered, carry forward the nearest earlier set's reps for
      // this exercise — not necessarily set N-1, since that one might itself be
      // blank (e.g. set 2 skipped over while filling in set 1, then set 3).
      let repsStr = logEntry.reps
      if (repsStr === '') repsStr = findCarryReps(logsRef.current, exerciseId, setNumber)
      // No reps and nothing to copy from — require the user to fill it in
      if (repsStr === '') return
      const reps = parseInt(repsStr, 10)
      if (!Number.isFinite(reps)) return
      // Values the database CHECKs would refuse can never sync - reject them
      // before the optimistic commit rather than queueing them as "offline".
      if (weight > MAX_SET_WEIGHT_LBS || reps < 0 || reps > MAX_SET_REPS) {
        showSetRejectedToast()
        return
      }

      const prevBestVolume = normalizePriorVolume(baselineBestVolumesRef.current[exerciseId])
      const volume = weight * reps
      // Match server grind_recompute_stats: first-ever volume is the baseline
      // (not a PR). Badge eligibility pins to prior-session baseline only (not
      // raised mid-session) so a later set that beats the old PR still badges
      // even if set 1 already did. Client always writes is_pr:false; local isPR
      // is UI-only until finish.
      const isPR = computeLocalIsPR(logEntry.isWarmup, weight, reps, prevBestVolume)
      const rpe = parseRpe(logEntry.rpe)

      // Optimistic: the set reads as logged the instant it's tapped; the write
      // happens in the background (see persistSet below) instead of making the
      // user wait a network round trip for the checkmark.
      commitLogs(prev => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? logEntry),
          weight: String(weight),
          reps: repsStr,
          checked: true,
          skipped: false,
          isPR,
        },
      }))

      const persistSet = async () => {
        if (demoMode) return
        const owner = workoutOwnerRef.current
        const saved = await persistQueuedOp({
          kind: 'upsert', sessionId, exerciseId, setNumber, weight, reps, isPR,
          isWarmup: logEntry.isWarmup, note: logEntry.note || null, isSkipped: false, rpe,
          queuedAt: Date.now(), performedAt: new Date().toISOString(),
        })
        if (!saved) {
          restoreLogEntries(exerciseId, { [key]: logEntry }, [key])
          return
        }
        commitLogs(prev => prev[key]?.checked
          ? { ...prev, [key]: { ...prev[key], pendingSync: true } } : prev)
        if (browserIsOffline()) {
          setResumeToast('Saved on this device. It will sync when you reconnect.')
          setTimeout(() => setResumeToast(null), 4000)
        } else if (owner) {
          void syncSessionNow(sessionId, rawSupabase, owner).catch(() => {})
        }
      }

      if (isPR) {
        // Track session-best volume for undo/edit recomputes; badge decisions
        // stay pinned to baselineBestVolumes above.
        setPreviousBestVolumes(prev => {
          const cur = prev[exerciseId]
          return cur !== undefined && cur !== null && cur >= volume
            ? prev
            : { ...prev, [exerciseId]: volume }
        })
        // The weight-only "prev" display should only ever rise to an actual
        // heavier weight — a volume PR at a lower weight (more reps) shouldn't
        // knock the displayed reference weight down.
        setPreviousBests(prev => {
          const cur = prev[exerciseId] ?? null
          return cur !== null && cur >= weight ? prev : { ...prev, [exerciseId]: weight }
        })
        // Android-only: iOS already ticked from the check-button switch overlay
        // on press. Post-await imperative haptics are dead on iOS 26.5+/27.
        haptic('success')
      }

      setUndoState({ key, exerciseId, setNumber, expiresAt: Date.now() + 5000 })

      // Update notification with new count if backgrounded - debounced to prevent
      // spam when rapidly completing multiple sets in quick succession
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden' &&
        pushPrefsRef.current?.enabled &&
        pushPrefsRef.current?.workout_status
      ) {
        if (setCompletionNotifyDebounce.current) {
          clearTimeout(setCompletionNotifyDebounce.current)
        }

        setCompletionNotifyDebounce.current = setTimeout(() => {
          setCompletionNotifyDebounce.current = null
          const newChecked = Object.entries(logsRef.current).filter(
            ([k, l]) => (k === key ? true : l.checked),
          ).length
          const resting = restTimer.active && !restTimer.paused
          lastNotifiedState.current = { checked: newChecked, total: totalSets(), resting }
          updateWorkoutStatusNotification({
            resting,
            exerciseName: resting
              ? (exercises.find(e => e.id === restTimer.exerciseId)?.name ?? undefined)
              : undefined,
            remainingMs: resting ? restTimer.remainingMs : undefined,
            doneSets: newChecked,
            totalSets: totalSets(),
          })
        }, 300)
      }

      // Don't start a rest countdown when this check completes the whole workout —
      // there's nothing left to rest for. Prefer slot-complete over counting
      // Object.entries (stale keys / missing slots). logsRef was sync-updated by
      // commitLogs above so concurrent checks see each other.
      let willAllBeProcessed = exercises.length > 0
      if (willAllBeProcessed) {
        for (const ex of exercises) {
          const n = ex.sets_target + (extraSets[ex.id] ?? 0)
          for (let s = 1; s <= n; s++) {
            const slot = logsRef.current[`${ex.id}-${s}`]
            if (!slot || (!slot.checked && !slot.skipped)) {
              willAllBeProcessed = false
              break
            }
          }
          if (!willAllBeProcessed) break
        }
      }

      if (willAllBeProcessed) {
        // Finish is next — clear any leftover rest from an earlier set.
        if (restTimer.active) restTimer.stop()
      } else if (!logEntry.isWarmup) {
        restTimer.start(exerciseId, resolveRestSeconds(exerciseId, sessionId))
      }

      await persistSet()
    } finally {
      checkingKeysRef.current.delete(key)
    }
  }


  async function handleUndo() {
    if (!undoState || !sessionId) return
    const { exerciseId, setNumber } = undoState
    setUndoState(null)
    await uncheckSet(exerciseId, setNumber)
  }

  // Puts a logged set back to "never done": deletes the row (or queues the
  // delete offline), stops its rest timer and clears the PR flag. Shared by the
  // undo banner and by saving an edit with the reps cleared (a mistyped set).
  async function uncheckSet(exerciseId: string, setNumber: number, clearReps = false) {
    if (!sessionId) return
    const key = `${exerciseId}-${setNumber}`
    const previous = logs[key]
    // Only kill the rest bar if it belongs to the set we just undid — undoing
    // an older set shouldn't stop an unrelated exercise's countdown.
    if (restTimer.exerciseId === exerciseId) {
      restTimer.stop()
      void cancelRestNotifications(sessionId)
    }

    if (!demoMode && !await persistQueuedOp({
      // eslint-disable-next-line react-hooks/purity
      kind: 'delete', sessionId, exerciseId, setNumber, queuedAt: Date.now(),
    })) return
    setLogs(prev => {
      const cur = prev[key] ?? previous
      if (!cur) return prev
      const next = {
        ...prev,
        [key]: {
          ...cur,
          ...(clearReps ? { reps: '' } : {}),
          checked: false,
          isPR: false,
          logId: undefined,
          pendingSync: !demoMode,
        },
      }
      setPreviousBests(pb => ({ ...pb, [exerciseId]: bestFromLogs(exerciseId, next) }))
      setPreviousBestVolumes(pb => ({ ...pb, [exerciseId]: bestVolumeFromLogs(exerciseId, next) }))
      return next
    })
    setEditingKey(null)
    syncQueuedEdits(sessionId)
  }

  function handleStartEdit(key: string) {
    if (!logs[key]?.checked) return
    setEditingKey(key)
  }

  async function handleSaveEdit(exerciseId: string, setNumber: number) {
    const key = `${exerciseId}-${setNumber}`
    const logEntry = logs[key]
    if (!logEntry || !sessionId) return

    // Reps cleared on a logged set = it was a mistype / not done yet. Put the
    // set back to untouched (row deleted, rest timer stopped) so tapping the
    // check again logs it fresh and starts the rest timer as normal.
    if (logEntry.checked && logEntry.reps.trim() === '') {
      setUndoState(prev => (prev?.key === key ? null : prev))
      await uncheckSet(exerciseId, setNumber, true)
      return
    }

    const weight = logEntry.weight !== '' ? parseFloat(logEntry.weight) : null
    const reps = logEntry.reps !== '' ? parseInt(logEntry.reps, 10) : null
    // Checked sets must stay working sets — reject empty/non-finite edits so we
    // don't persist a "checked" row the finish gate / server won't count.
    if (
      logEntry.checked &&
      (weight === null || reps === null || !Number.isFinite(weight) || !Number.isFinite(reps))
    ) {
      setResumeToast('Enter weight and reps to save this set.')
      setTimeout(() => setResumeToast(null), 3000)
      return
    }
    if (
      (weight !== null && Number.isFinite(weight) && (weight < 0 || weight > MAX_SET_WEIGHT_LBS)) ||
      (reps !== null && Number.isFinite(reps) && (reps < 0 || reps > MAX_SET_REPS))
    ) {
      showSetRejectedToast()
      return
    }

    // Badge eligibility pins to prior-session baseline (server volume-PR rules).
    // Session bests are recomputed below via bestVolumeFromLogs for display/undo.
    const prevBestVolume = normalizePriorVolume(baselineBestVolumesRef.current[exerciseId])
    // Match server: null prior best ⇒ first lift is the baseline, not a PR.
    const isPR =
      reps !== null && computeLocalIsPR(logEntry.isWarmup, weight, reps, prevBestVolume)
    const rpe = parseRpe(logEntry.rpe)

    if (!demoMode && !await persistQueuedOp({
      kind: 'upsert', sessionId, exerciseId, setNumber, weight, reps, isPR,
      isWarmup: logEntry.isWarmup, note: logEntry.note || null, isSkipped: false,
      // eslint-disable-next-line react-hooks/purity
      rpe, queuedAt: Date.now(),
    })) return

    setLogs(prev => {
      const next = { ...prev, [key]: { ...prev[key], isPR, pendingSync: !demoMode } }
      setPreviousBests(pb => ({ ...pb, [exerciseId]: bestFromLogs(exerciseId, next) }))
      setPreviousBestVolumes(pb => ({ ...pb, [exerciseId]: bestVolumeFromLogs(exerciseId, next) }))
      return next
    })
    setEditingKey(null)
    syncQueuedEdits(sessionId)
    // Save-edit tick comes from data-haptic="heavy" on the check/save button.
  }

  /**
   * Persist the note/RPE drawer on an already-saved set. Without this the
   * typed note and the picked RPE live only in local state and are lost on
   * refresh/resume.
   *
   * Both fields go in one UPDATE. RPE previously had no persistence path at
   * all: its `<select>` only called `onUpdate(key, 'rpe', v)`, and changing a
   * select doesn't blur the note input, so the note-only writer here never ran
   * for it — a set logged with RPE 8 came back blank on resume and finished
   * with `rpe` null in `session_logs`.
   *
   * `overrides` exists because the RPE select commits through React state: the
   * handler that fires on change still closes over the PREVIOUS `logs`, so the
   * newly picked value is passed through explicitly rather than read back from
   * a snapshot that doesn't have it yet.
   *
   * A failure falls back to the offline queue like every other write on this
   * screen — silently dropping the edit (as this used to) meant a note the user
   * watched themselves type just wasn't there next time.
   */
  async function persistSetMeta(
    exerciseId: string,
    setNumber: number,
    overrides?: { note?: string; rpe?: string },
  ) {
    if (!sessionId) return
    const key = `${exerciseId}-${setNumber}`
    const logEntry = logsRef.current[key] ?? logs[key]
    if (!logEntry || !logEntry.checked || logEntry.skipped) return
    const note = (overrides?.note ?? logEntry.note) || null
    const rpe = parseRpe(overrides?.rpe ?? logEntry.rpe)
    if (!demoMode) {
      const weight = parseFloat(logEntry.weight)
      const reps = parseInt(logEntry.reps, 10)
      if (!Number.isFinite(weight) || !Number.isFinite(reps)) return
      if (!await persistQueuedOp({
        kind: 'upsert', sessionId, exerciseId, setNumber, weight, reps,
        isPR: logEntry.isPR, isWarmup: logEntry.isWarmup, note, isSkipped: false,
        // eslint-disable-next-line react-hooks/purity
        rpe, queuedAt: Date.now(),
      })) return
      commitLogs(prev => prev[key] ? { ...prev, [key]: { ...prev[key], pendingSync: true } } : prev)
      syncQueuedEdits(sessionId)
    }
  }

  function handleAddSet(exerciseId: string) {
    const ex = exercises.find(e => e.id === exerciseId)
    if (!ex) return
    const currentExtras = extraSets[exerciseId] ?? 0
    const newSetNum = ex.sets_target + currentExtras + 1
    // Same precedence as the initial prefill: today's Coach override, then the
    // exercise's own weight_target (docs/sql/25), else last session's weight.
    const fillWeight = weightOverrides[exerciseId] ?? ex.weight_target ?? previousBests[exerciseId] ?? null
    setExtraSets(prev => ({ ...prev, [exerciseId]: currentExtras + 1 }))
    setLogs(prev => ({
      ...prev,
      [`${exerciseId}-${newSetNum}`]: emptySetState(fillWeight !== null ? String(fillWeight) : ''),
    }))
    showSaveToast('Set added')
  }

  /** Prefill configured warm-up percents in front of working sets, adding slots if needed. */
  function applyWarmupRamp(exerciseId: string) {
    const ex = exercises.find(e => e.id === exerciseId)
    if (!ex) return
    const fractions = percentsToFractions(readWarmupPercents())
    if (fractions.length === 0) {
      setResumeToast('Set warm-up percents in Settings first.')
      setTimeout(() => setResumeToast(null), 4000)
      return
    }
    const currentExtras = extraSets[exerciseId] ?? 0
    const total = ex.sets_target + currentExtras
    const currentLogs = logsRef.current
    const snapshot: LogMap = {}
    const rows = []
    for (let n = 1; n <= total; n++) {
      const key = `${exerciseId}-${n}`
      const row = currentLogs[key]
      if (!row) continue
      snapshot[key] = { ...row }
      rows.push({
        setNumber: n,
        weight: row.weight,
        isWarmup: row.isWarmup,
        checked: row.checked,
        skipped: row.skipped,
      })
    }
    const plan = planWarmupRamp(rows, ex.sets_target, previousBests[exerciseId], fractions)
    if (!plan.ok) {
      setResumeToast(
        plan.reason === 'nothing-to-fill'
          ? 'Warm-ups go on the first sets. Undo those first.'
          : 'Enter a working weight first, then apply warm-ups.',
      )
      setTimeout(() => setResumeToast(null), 4000)
      return
    }

    setWarmupUndo(prev => ({
      ...prev,
      [exerciseId]: { extrasBefore: currentExtras, logsBefore: snapshot },
    }))
    if (plan.extraToAdd > 0) {
      setExtraSets(prev => ({ ...prev, [exerciseId]: currentExtras + plan.extraToAdd }))
    }
    setLogs(prev => {
      const next = { ...prev }
      for (let i = 0; i < plan.extraToAdd; i++) {
        next[`${exerciseId}-${total + 1 + i}`] = emptySetState(plan.fillWeight)
      }
      for (const u of plan.updates) {
        const key = `${exerciseId}-${u.setNumber}`
        const cur = next[key] ?? emptySetState(plan.fillWeight)
        if (cur.checked || cur.skipped) continue
        next[key] = { ...cur, weight: String(u.weight), isWarmup: true }
      }
      return next
    })
    showSaveToast('Warm-up ramp applied')
  }

  async function undoWarmupRamp(exerciseId: string) {
    const snap = warmupUndo[exerciseId]
    const ex = exercises.find(e => e.id === exerciseId)
    if (!snap || !ex) return
    const extrasNow = extraSets[exerciseId] ?? 0
    const totalNow = ex.sets_target + extrasNow
    const restoredTotal = ex.sets_target + snap.extrasBefore

    if (sessionId && !demoMode && totalNow > restoredTotal) {
      // eslint-disable-next-line react-hooks/purity
      const queuedAt = Date.now()
      if (!await persistQueuedOps(Array.from({ length: totalNow - restoredTotal }, (_, offset) => ({
        kind: 'delete' as const, sessionId, exerciseId, setNumber: restoredTotal + 1 + offset, queuedAt,
      })))) return
      syncQueuedEdits(sessionId)
    }

    setLogs(prev => {
      const next = { ...prev }
      for (let n = 1; n <= totalNow; n++) delete next[`${exerciseId}-${n}`]
      for (const [key, row] of Object.entries(snap.logsBefore)) next[key] = row
      return next
    })
    setExtraSets(prev => ({ ...prev, [exerciseId]: snap.extrasBefore }))
    setWarmupUndo(prev => {
      if (!(exerciseId in prev)) return prev
      const next = { ...prev }
      delete next[exerciseId]
      return next
    })

    showSaveToast('Warm-up undone')
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
    const entry = logs[`${exerciseId}-${setNumber}`]
    const isBonus = setNumber > ex.sets_target
    const canDeleteWarmup = !!entry?.isWarmup && currentExtras > 0
    if (setNumber < 1 || setNumber > total) return
    if (!isBonus && !canDeleteWarmup) return

    // Compute the shifted end-state locally first — every later bonus set's
    // data moves down one slot to fill the gap. The DB writes below are
    // reconciling toward this same end-state (an upsert per shifted slot,
    // using the LOCAL truth for that slot rather than replaying the original
    // row's set_number in place), so on a write failure we can queue exactly
    // what's needed to reach it, instead of a mid-shift DB row move that has
    // no well-defined "just retry this part" story once offline.
    const next = { ...logs }
    for (let s = setNumber; s < total; s++) {
      const laterKey = `${exerciseId}-${s + 1}`
      if (next[laterKey]) next[`${exerciseId}-${s}`] = next[laterKey]
    }
    delete next[`${exerciseId}-${total}`]

    if (sessionId && !demoMode) {
      // eslint-disable-next-line react-hooks/purity
      const queuedAt = Date.now()
      const edits: QueuedOp[] = []
      for (let slot = setNumber; slot <= total; slot++) {
        const target = next[`${exerciseId}-${slot}`]
        if (!target || (!target.checked && !target.skipped)) {
          edits.push({ kind: 'delete', sessionId, exerciseId, setNumber: slot, queuedAt })
          continue
        }
        edits.push({
          kind: 'upsert', sessionId, exerciseId, setNumber: slot, queuedAt,
          weight: target.weight ? parseFloat(target.weight) : null,
          reps: target.reps ? parseInt(target.reps, 10) : null,
          isPR: target.isPR, isWarmup: target.isWarmup, isSkipped: target.skipped,
          note: target.note || null, rpe: parseRpe(target.rpe),
        })
        next[`${exerciseId}-${slot}`] = { ...target, pendingSync: true }
      }
      if (!await persistQueuedOps(edits)) return
      syncQueuedEdits(sessionId)
    }

    // The deleted set may have held the live PR — recompute the bests.
    setPreviousBests(pb => ({ ...pb, [exerciseId]: bestFromLogs(exerciseId, next) }))
    setPreviousBestVolumes(pb => ({ ...pb, [exerciseId]: bestVolumeFromLogs(exerciseId, next) }))
    setLogs(next)
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
  async function persistSkipEdit(exerciseId: string, setNumbers: number[], skip: boolean) {
    if (!sessionId || demoMode) return true
    const queuedAt = Date.now()
    return persistQueuedOps(setNumbers.map((setNumber): QueuedOp => skip
      ? { kind: 'upsert', sessionId, exerciseId, setNumber, weight: null, reps: null,
          isPR: false, isWarmup: false, note: null, isSkipped: true, queuedAt }
      : { kind: 'delete', sessionId, exerciseId, setNumber, queuedAt }))
  }

  function showQueuedSyncToast() {
    setResumeToast('Saved on this device — will sync once back online.')
    setTimeout(() => setResumeToast(null), 4000)
  }

  function showSetRejectedToast() {
    setResumeToast("Couldn't save that set — check the weight and reps.")
    setTimeout(() => setResumeToast(null), 4000)
  }

  /** A permanent (non-network) failure: report it and tell the user. Never queued. */

  function restoreLogEntries(exerciseId: string, snapshot: LogMap, keys: string[]) {
    commitLogs(prev => {
      const next = { ...prev }
      for (const k of keys) if (snapshot[k]) next[k] = snapshot[k]
      setPreviousBests(pb => ({ ...pb, [exerciseId]: bestFromLogs(exerciseId, next) }))
      setPreviousBestVolumes(pb => ({ ...pb, [exerciseId]: bestVolumeFromLogs(exerciseId, next) }))
      return next
    })
  }

  async function handleSkipSet(exerciseId: string, setNumber: number) {
    // Haptic: data-haptic on the skip control (delegated / overlay).
    const key = `${exerciseId}-${setNumber}`
    if (skippingKeysRef.current.has(key)) return
    skippingKeysRef.current.add(key)
    const skipSnapshot = logs
    const wasChecked = logs[key]?.checked
    // persistSkip upserts the skip marker over whatever was there — including
    // an already-saved checked row, which it overwrites (weight/reps/is_pr
    // back to null/false) so it doesn't persist as a completed set.
    // Preserve the current weight/reps/note before clearing so unskip can restore them.
    setLogs(prev => {
      const entry = prev[key]
      const next = {
        ...prev,
        [key]: {
          ...entry,
          skipped: true,
          checked: false,
          isPR: false,
          logId: undefined,
          // Backup current values before clearing
          skippedWeight: entry?.weight || '',
          skippedReps: entry?.reps || '',
          skippedNote: entry?.note || '',
          skippedRpe: entry?.rpe || '',
          // Clear the active fields
          weight: '',
          reps: '',
          note: '',
          rpe: '',
        },
      }
      if (wasChecked) {
        // Recompute live PR bars — the overwritten set may have been the best.
        setPreviousBests(pb => ({ ...pb, [exerciseId]: bestFromLogs(exerciseId, next) }))
        setPreviousBestVolumes(pb => ({ ...pb, [exerciseId]: bestVolumeFromLogs(exerciseId, next) }))
      }
      return next
    })
    // Exit edit mode if the user is mid-edit when they skip.
    if (editingKey === key) setEditingKey(null)
    try {
      if (!await persistSkipEdit(exerciseId, [setNumber], true)) {
        restoreLogEntries(exerciseId, skipSnapshot, [key])
        return
      }
      if (sessionId && !demoMode) {
        setLogs(prev => {
          const next = { ...prev }
          for (const slot of [key]) next[slot] = { ...next[slot], pendingSync: true }
          return next
        })
        syncQueuedEdits(sessionId)
      }
    } finally {
      skippingKeysRef.current.delete(key)
    }
  }

  async function handleUnskipSet(exerciseId: string, setNumber: number) {
    const key = `${exerciseId}-${setNumber}`
    if (skippingKeysRef.current.has(key)) return
    skippingKeysRef.current.add(key)
    const skipSnapshot = logs
    setLogs(prev => {
      const entry = prev[key]
      return {
        ...prev,
        [key]: {
          ...entry,
          skipped: false,
          logId: undefined,
          // Restore the backed-up values from before the skip
          weight: entry?.skippedWeight || '',
          reps: entry?.skippedReps || '',
          note: entry?.skippedNote || '',
          rpe: entry?.skippedRpe || '',
          // Clear the backup fields
          skippedWeight: undefined,
          skippedReps: undefined,
          skippedNote: undefined,
          skippedRpe: undefined,
        },
      }
    })
    try {
      if (!await persistSkipEdit(exerciseId, [setNumber], false)) {
        restoreLogEntries(exerciseId, skipSnapshot, [key])
        return
      }
      if (sessionId && !demoMode) {
        setLogs(prev => {
          const next = { ...prev }
          for (const slot of [key]) next[slot] = { ...next[slot], pendingSync: true }
          return next
        })
        syncQueuedEdits(sessionId)
      }
    } finally {
      skippingKeysRef.current.delete(key)
    }
  }

  async function handleSkipExercise(exerciseId: string) {
    const ex = exercises.find(e => e.id === exerciseId)
    if (!ex) return
    // Skip every set that isn't already skipped — including already-checked
    // ones and bonus sets beyond sets_target, so "skip exercise" fully clears
    // the card (extras used to stay editable and break the SKIPPED badge).
    const total = ex.sets_target + (extraSets[exerciseId] ?? 0)
    const setsToSkip: number[] = []
    let anyWasChecked = false
    for (let s = 1; s <= total; s++) {
      const entry = logs[`${exerciseId}-${s}`]
      if (!entry?.skipped) setsToSkip.push(s)
      if (entry?.checked) anyWasChecked = true
    }
    if (setsToSkip.length === 0) return
    const skipKeys = setsToSkip.map(s => `${exerciseId}-${s}`)
    if (skipKeys.some(k => skippingKeysRef.current.has(k))) return
    for (const k of skipKeys) skippingKeysRef.current.add(k)
    const skipSnapshot = logs
    setLogs(prev => {
      const next = { ...prev }
      for (const s of setsToSkip) {
        const key = `${exerciseId}-${s}`
        const entry = next[key]
        // Preserve the current values before clearing so unskip can restore them
        next[key] = {
          ...entry,
          skipped: true,
          checked: false,
          isPR: false,
          logId: undefined,
          // Backup current values
          skippedWeight: entry?.weight || '',
          skippedReps: entry?.reps || '',
          skippedNote: entry?.note || '',
          skippedRpe: entry?.rpe || '',
          // Clear active fields
          weight: '',
          reps: '',
          note: '',
          rpe: '',
        }
      }
      if (anyWasChecked) {
        // Recompute live PR bars — a set we just cleared may have been the best.
        setPreviousBests(pb => ({ ...pb, [exerciseId]: bestFromLogs(exerciseId, next) }))
        setPreviousBestVolumes(pb => ({ ...pb, [exerciseId]: bestVolumeFromLogs(exerciseId, next) }))
      }
      return next
    })
    // Exit edit mode if the user was mid-edit on one of the sets we just skipped.
    if (editingKey && setsToSkip.some(s => editingKey === `${exerciseId}-${s}`)) {
      setEditingKey(null)
    }
    try {
      if (!await persistSkipEdit(exerciseId, setsToSkip, true)) {
        restoreLogEntries(exerciseId, skipSnapshot, skipKeys)
        return
      }
      if (sessionId && !demoMode) {
        setLogs(prev => {
          const next = { ...prev }
          for (const slot of skipKeys) next[slot] = { ...next[slot], pendingSync: true }
          return next
        })
        syncQueuedEdits(sessionId)
      }
    } finally {
      for (const k of skipKeys) skippingKeysRef.current.delete(k)
    }
  }

  async function handleUnskipExercise(exerciseId: string) {
    const ex = exercises.find(e => e.id === exerciseId)
    if (!ex) return
    const total = ex.sets_target + (extraSets[exerciseId] ?? 0)
    const setsToUnskip: number[] = []
    for (let s = 1; s <= total; s++) {
      if (logs[`${exerciseId}-${s}`]?.skipped) setsToUnskip.push(s)
    }
    if (setsToUnskip.length === 0) return
    const unskipKeys = setsToUnskip.map(s => `${exerciseId}-${s}`)
    if (unskipKeys.some(k => skippingKeysRef.current.has(k))) return
    for (const k of unskipKeys) skippingKeysRef.current.add(k)
    const skipSnapshot = logs
    setLogs(prev => {
      const next = { ...prev }
      for (const s of setsToUnskip) {
        const key = `${exerciseId}-${s}`
        const entry = next[key]
        if (entry?.skipped) {
          // Same restore path as per-set unskip — exercise UNDO used to leave
          // empty inputs even though skippedWeight/Reps were still on the object.
          next[key] = {
            ...entry,
            skipped: false,
            logId: undefined,
            weight: entry.skippedWeight || '',
            reps: entry.skippedReps || '',
            note: entry.skippedNote || '',
            rpe: entry.skippedRpe || '',
            skippedWeight: undefined,
            skippedReps: undefined,
            skippedNote: undefined,
            skippedRpe: undefined,
          }
        }
      }
      return next
    })
    try {
      if (!await persistSkipEdit(exerciseId, setsToUnskip, false)) {
        restoreLogEntries(exerciseId, skipSnapshot, unskipKeys)
        return
      }
      if (sessionId && !demoMode) {
        setLogs(prev => {
          const next = { ...prev }
          for (const slot of unskipKeys) next[slot] = { ...next[slot], pendingSync: true }
          return next
        })
        syncQueuedEdits(sessionId)
      }
    } finally {
      for (const k of unskipKeys) skippingKeysRef.current.delete(k)
    }
  }

  /**
   * Rename in place. Only `exercises.name` changes — the row id stays, so every
   * session_log, PR bar and Progress-page history follows the new name. (Swap
   * is the opposite: a different exercise row with its own history.) Returns an
   * inline error message, or null once saved and the dialog is closing.
   */
  async function handleRenameExercise(exercise: Exercise, rawName: string): Promise<string | null> {
    const name = rawName.trim().replace(/\s+/g, ' ')
    if (!name) return 'Exercise name is required.'
    if (name === exercise.name) {
      setRenameTarget(null)
      return null
    }
    const key = name.toLowerCase()
    const clash = allExercises.some(
      e => e.id !== exercise.id && e.day_type === exercise.day_type && e.name.trim().toLowerCase() === key,
    ) || exercises.some(e => e.id !== exercise.id && e.name.trim().toLowerCase() === key)
    if (clash) return 'An exercise with this name already exists for this day.'

    const { error } = await supabase.from('exercises').update({ name }).eq('id', exercise.id)
    if (error) return 'Could not rename. Check your connection and try again.'

    const apply = (list: Exercise[]) => list.map(e => (e.id === exercise.id ? { ...e, name } : e))
    commitExercises(apply)
    setAllExercises(apply)
    markAppDataStale()
    setRenameTarget(null)
    showSaveToast(`Renamed to ${name}`)
    return null
  }

  async function handleSwapExercise(newExercise: Exercise) {
    if (!swapTarget || !sessionId) return
    const oldExercise = exercises.find(e => e.id === swapTarget)
    const oldExtras = extraSets[swapTarget] ?? 0

    const { error: deleteError } = await supabase
      .from('session_logs')
      .delete()
      .eq('session_id', sessionId)
      .eq('exercise_id', swapTarget)

    if (deleteError) {
      setResumeToast('Could not swap exercise. Check your connection and try again.')
      setTimeout(() => setResumeToast(null), 4000)
      return
    }

    // Drop offline-queue ops for the swapped-out exercise so a later flush
    // can't re-insert logs for a slot that's no longer on screen.
    await clearQueuedOpsForExercise(sessionId, swapTarget, workoutOwnerRef.current)

    let prevBest: number | null = previousBests[newExercise.id] !== undefined
      ? previousBests[newExercise.id]
      : null
    let prevBestVolume: number | null = previousBestVolumes[newExercise.id] !== undefined
      ? previousBestVolumes[newExercise.id]
      : null

    if (previousBests[newExercise.id] === undefined) {
      const user = await getClientUser(supabase)
      if (user) {
        // Same split as initSession: "prev" is the last session's weight, the
        // PR bar-to-beat stays all-time-best volume. Falls back to all-time-best
        // weight if get_exercise_last_weights (docs/sql/24) errors, same as above.
        const [{ data: lastWeightRows, error: lastWeightError }, { data: bestRows }] = await Promise.all([
          supabase.rpc('get_exercise_last_weights', { p_exercise_ids: [newExercise.id] }),
          supabase.rpc('get_exercise_bests', { p_exercise_ids: [newExercise.id] }),
        ])
        if (lastWeightError) {
          console.error('get_exercise_last_weights failed, falling back to all-time best:', lastWeightError)
        }
        const lastWeightRow = (lastWeightRows ?? [])[0] as { last_weight: number | null } | undefined
        const bestRow = (bestRows ?? [])[0] as { max_weight: number | null; max_volume: number | null } | undefined
        prevBest = lastWeightError
          ? normalizePriorVolume(bestRow?.max_weight)
          : normalizePriorVolume(lastWeightRow?.last_weight)
        prevBestVolume = normalizePriorVolume(bestRow?.max_volume)
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

    commitExercises(prev => {
      const idx = prev.findIndex(e => e.id === swapTarget)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = newExercise
      return next
    })

    // Same precedence as the initial prefill: the exercise's own weight_target
    // (docs/sql/25) when set, else last session's weight (prevBest, which also
    // still drives the "prev:" hint via previousBests above — unchanged).
    const fillWeight = newExercise.weight_target ?? prevBest

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
        next[`${newExercise.id}-${s}`] = emptySetState(
          fillWeight !== null ? String(fillWeight) : '',
        )
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
    setEnteredExerciseId(newExercise.id)
    showSaveToast(`Swapped in ${newExercise.name}`)
    setWarmupUndo(prev => {
      if (!(swapTarget in prev)) return prev
      const next = { ...prev }
      delete next[swapTarget]
      return next
    })
    if (oldExercise && isSessionExtra(oldExercise.id, originalDayIdsRef.current)) {
      void retireThisDayExtra(oldExercise)
    }
  }

  async function ensurePriors(exercise: Exercise): Promise<{
    prevBest: number | null
    prevBestVolume: number | null
  }> {
    let prevBest: number | null = previousBests[exercise.id] !== undefined
      ? previousBests[exercise.id]
      : null
    let prevBestVolume: number | null = previousBestVolumes[exercise.id] !== undefined
      ? previousBestVolumes[exercise.id]
      : null

    if (previousBests[exercise.id] === undefined) {
      const user = await getClientUser(supabase)
      if (user) {
        const [{ data: lastWeightRows, error: lastWeightError }, { data: bestRows }] = await Promise.all([
          supabase.rpc('get_exercise_last_weights', { p_exercise_ids: [exercise.id] }),
          supabase.rpc('get_exercise_bests', { p_exercise_ids: [exercise.id] }),
        ])
        if (lastWeightError) {
          console.error('get_exercise_last_weights failed, falling back to all-time best:', lastWeightError)
        }
        const lastWeightRow = (lastWeightRows ?? [])[0] as { last_weight: number | null } | undefined
        const bestRow = (bestRows ?? [])[0] as { max_weight: number | null; max_volume: number | null } | undefined
        prevBest = lastWeightError
          ? normalizePriorVolume(bestRow?.max_weight)
          : normalizePriorVolume(lastWeightRow?.last_weight)
        prevBestVolume = normalizePriorVolume(bestRow?.max_volume)
        setPreviousBests(prev => ({ ...prev, [exercise.id]: prevBest }))
        setPreviousBestVolumes(prev => ({ ...prev, [exercise.id]: prevBestVolume }))
      }
    }
    setBaselineBests(prev => (prev[exercise.id] !== undefined ? prev : { ...prev, [exercise.id]: prevBest }))
    setBaselineBestVolumes(prev => (prev[exercise.id] !== undefined ? prev : { ...prev, [exercise.id]: prevBestVolume }))
    return { prevBest, prevBestVolume }
  }

  function seedExerciseLogs(exercise: Exercise, prevBest: number | null) {
    const fillWeight = exercise.weight_target ?? prevBest
    setLogs(prev => {
      const next = { ...prev }
      for (let s = 1; s <= exercise.sets_target; s++) {
        const key = `${exercise.id}-${s}`
        if (!next[key]) next[key] = emptySetState(fillWeight !== null ? String(fillWeight) : '')
      }
      return next
    })
  }

  function persistSessionExtras(nextExercises: Exercise[]) {
    if (!sessionId) return
    writeSessionExtraIds(
      sessionId,
      sessionExtraIdsFor(nextExercises.map(e => e.id), originalDayIdsRef.current),
    )
  }

  function commitExercises(updater: (prev: Exercise[]) => Exercise[]) {
    let next: Exercise[] = exercises
    setExercises(prev => {
      next = updater(prev)
      persistSessionExtras(next)
      return next
    })
    return next
  }

  function clearExerciseLocalState(exerciseId: string, oldExercise?: Exercise, oldExtras = 0) {
    const total = (oldExercise?.sets_target ?? 0) + oldExtras
    setLogs(prev => {
      const next = { ...prev }
      for (let s = 1; s <= total; s++) delete next[`${exerciseId}-${s}`]
      return next
    })
    setExtraSets(prev => {
      if (!(exerciseId in prev)) return prev
      const next = { ...prev }
      delete next[exerciseId]
      return next
    })
    if (editingKey?.startsWith(`${exerciseId}-`)) setEditingKey(null)
    setWarmupUndo(prev => {
      if (!(exerciseId in prev)) return prev
      const next = { ...prev }
      delete next[exerciseId]
      return next
    })
  }

  /**
   * Drop a this-day session extra from the catalog so the next workout doesn't
   * offer it. Other-day rows are left alone (they're still on their own day).
   * Hard-delete only when nothing has ever been logged against it.
   */
  async function retireThisDayExtra(exercise: Exercise) {
    if (exercise.day_type !== day) return
    if (!isSessionExtra(exercise.id, originalDayIdsRef.current)) return

    const { count } = await supabase
      .from('session_logs')
      .select('id', { count: 'exact', head: true })
      .eq('exercise_id', exercise.id)

    if ((count ?? 0) > 0) {
      const { error } = await supabase
        .from('exercises')
        .update({ active: false })
        .eq('id', exercise.id)
      if (error) return
      setAllExercises(prev => prev.map(e => e.id === exercise.id ? { ...e, active: false } : e))
      markAppDataStale()
      return
    }

    // Only hard-delete rows minted during this live session. An existing
    // disabled catalog row that was added then removed must stay in Manage.
    if (!createdThisSessionIdsRef.current.has(exercise.id)) {
      const { error } = await supabase
        .from('exercises')
        .update({ active: false })
        .eq('id', exercise.id)
      if (error) return
      setAllExercises(prev => prev.map(e => e.id === exercise.id ? { ...e, active: false } : e))
      markAppDataStale()
      return
    }

    const { error } = await supabase.from('exercises').delete().eq('id', exercise.id)
    if (error) {
      const { error: disableError } = await supabase
        .from('exercises')
        .update({ active: false })
        .eq('id', exercise.id)
      if (disableError) return
      setAllExercises(prev => prev.map(e => e.id === exercise.id ? { ...e, active: false } : e))
      markAppDataStale()
      return
    }
    setAllExercises(prev => prev.filter(e => e.id !== exercise.id))
    markAppDataStale()
  }

  /** Keep a trained extra on this day's catalog for the next session. */
  async function persistExtraToDay(exercise: Exercise) {
    if (exercise.day_type === day) {
      if (exercise.active) return
      const { error } = await supabase
        .from('exercises')
        .update({ active: true })
        .eq('id', exercise.id)
      if (error) return
      setAllExercises(prev => prev.map(e => e.id === exercise.id ? { ...e, active: true } : e))
      markAppDataStale()
      return
    }

    const nameKey = exercise.name.trim().toLowerCase()
    const existing = allExercises.find(
      e => e.day_type === day && e.name.trim().toLowerCase() === nameKey,
    )
    if (existing) {
      if (existing.active) return
      const { error } = await supabase
        .from('exercises')
        .update({ active: true })
        .eq('id', existing.id)
      if (error) return
      setAllExercises(prev => prev.map(e => e.id === existing.id ? { ...e, active: true } : e))
      markAppDataStale()
      return
    }

    const user = await getClientUser(supabase)
    if (!user) return
    const sortOrder = allExercises
      .filter(e => e.day_type === day)
      .reduce((m, e) => Math.max(m, e.sort_order), 0) + 1
    const { data, error } = await supabase
      .from('exercises')
      .insert({
        user_id: user.id,
        name: exercise.name,
        day_type: day,
        sets_target: exercise.sets_target,
        reps_target: exercise.reps_target,
        weight_target: exercise.weight_target,
        sort_order: sortOrder,
        active: true,
      })
      .select()
      .maybeSingle()
    if (error) return
    const created = (data as Exercise | null) ?? (
      demoMode
        ? {
            ...exercise,
            id: crypto.randomUUID(),
            day_type: day,
            sort_order: sortOrder,
            active: true,
          }
        : null
    )
    if (created) {
      setAllExercises(prev => [...prev, created])
      markAppDataStale()
    }
  }

  async function reconcileSessionExtras(remaining: Exercise[], remainingLogs: LogMap) {
    for (const ex of remaining) {
      if (!isSessionExtra(ex.id, originalDayIdsRef.current)) continue
      const setCount = ex.sets_target + (extraSets[ex.id] ?? 0)
      const trained = extraHasWorkingSet(remainingLogs, ex.id, setCount)
      if (shouldPersistSessionExtra(true, trained)) await persistExtraToDay(ex)
      else await retireThisDayExtra(ex)
    }
  }

  function scrollToExercise(id: string) {
    window.setTimeout(() => {
      document.getElementById(`wo-ex-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, EXERCISE_PICKER_EXIT_MS + 40)
  }

  async function handleAddExercise(newExercise: Exercise) {
    if (!sessionId) return
    if (exercises.some(e => e.id === newExercise.id) || addingIdsRef.current.has(newExercise.id)) {
      setAddExerciseOpen(false)
      showSaveToast(`${newExercise.name} is already in this workout`)
      return
    }
    addingIdsRef.current.add(newExercise.id)
    try {
      const { prevBest } = await ensurePriors(newExercise)
      let added = false
      commitExercises(prev => {
        if (prev.some(e => e.id === newExercise.id)) return prev
        added = true
        return [...prev, newExercise]
      })
      if (!added) {
        setAddExerciseOpen(false)
        showSaveToast(`${newExercise.name} is already in this workout`)
        return
      }
      seedExerciseLogs(newExercise, prevBest)
      setAddExerciseOpen(false)
      setEnteredExerciseId(newExercise.id)
      showSaveToast(`Added ${newExercise.name}`)
      scrollToExercise(newExercise.id)
    } finally {
      addingIdsRef.current.delete(newExercise.id)
    }
  }

  async function handleRemoveExercise(exerciseId: string) {
    if (!sessionId) return
    if (!isSessionExtra(exerciseId, originalDayIdsRef.current)) return
    if (exercises.length <= 1) {
      showSaveToast('Add another exercise before removing this one')
      return
    }
    if (removingIdsRef.current.has(exerciseId)) return
    const oldExercise = exercises.find(e => e.id === exerciseId)
    if (!oldExercise) return
    removingIdsRef.current.add(exerciseId)

    const { error: deleteError } = await supabase
      .from('session_logs')
      .delete()
      .eq('session_id', sessionId)
      .eq('exercise_id', exerciseId)

    if (deleteError) {
      removingIdsRef.current.delete(exerciseId)
      setResumeToast('Could not remove exercise. Check your connection and try again.')
      setTimeout(() => setResumeToast(null), 4000)
      return
    }

    await clearQueuedOpsForExercise(sessionId, exerciseId, workoutOwnerRef.current)
    const oldExtras = extraSets[exerciseId] ?? 0
    commitExercises(prev => prev.filter(e => e.id !== exerciseId))
    clearExerciseLocalState(exerciseId, oldExercise, oldExtras)
    await retireThisDayExtra(oldExercise)
    removingIdsRef.current.delete(exerciseId)
    showSaveToast(`Removed ${oldExercise.name}`)
  }

  /**
   * Create a brand-new exercise from the swap/add sheet (when the one the user
   * wants isn't in any of their days yet). Inserted onto THIS day as inactive
   * so a discarded / removed extra does not reappear next session. Finishing
   * with a working set activates it for next time.
   */
  async function createExerciseForDay(
    name: string,
    sets: number,
    reps: string,
    weightTarget: number | null,
  ): Promise<Exercise | null> {
    const user = await getClientUser(supabase)
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
        weight_target: weightTarget,
        sort_order: sortOrder,
        active: false,
      })
      .select()
      .maybeSingle()

    if (error) return null

    const created = data
      ? (data as Exercise)
      : demoMode
        ? {
            id: crypto.randomUUID(),
            name: name.trim(),
            day_type: day,
            sets_target: sets,
            reps_target: reps.trim(),
            weight_target: weightTarget,
            sort_order: sortOrder,
            active: false,
            created_at: new Date().toISOString(),
          } satisfies Exercise
        : null
    if (!created) return null

    setAllExercises(prev => [...prev, created])
    createdThisSessionIdsRef.current.add(created.id)
    markAppDataStale()
    return created
  }

  /**
   * Create a brand-new exercise from the swap sheet and immediately swap it into
   * the current slot.
   */
  async function createAndSwapExercise(
    name: string,
    sets: number,
    reps: string,
    weightTarget: number | null,
  ): Promise<Exercise | null> {
    if (!swapTarget) return null
    const created = await createExerciseForDay(name, sets, reps, weightTarget)
    if (!created) return null
    await handleSwapExercise(created)
    return created
  }

  async function createAndAddExercise(
    name: string,
    sets: number,
    reps: string,
    weightTarget: number | null,
  ): Promise<Exercise | null> {
    const created = await createExerciseForDay(name, sets, reps, weightTarget)
    if (!created) return null
    await handleAddExercise(created)
    return created
  }

  async function handleDiscard() {
    if (discardingRef.current) return
    discardingRef.current = true
    setResumeToast(null)
    // The confirm dialog stays up showing "Discarding…" until we navigate.
    // It used to close first, which left the live workout on screen with no
    // feedback for the whole round trip — it read as a discard that hung.
    setDiscarding(true)

    const owner = workoutOwnerRef.current
    const result = owner && sessionId
      ? demoMode ? { ok: true } : await discardWorkout(rawSupabase, owner, sessionId)
      : { ok: false, error: 'Could not identify this workout.' }
    if (!result.ok) {
      discardingRef.current = false
      setDiscarding(false)
      setShowExitConfirm(false)
      setResumeToast('error' in result ? result.error ?? 'Could not discard. Try again.' : 'Could not discard. Try again.')
      setTimeout(() => setResumeToast(null), 4000)
      return
    }

    restTimer.stop()
    if (sessionId) {
      void cancelRestNotifications(sessionId)
      clearSessionExtraIds(sessionId)
      clearSessionRest(sessionId)
    }
    clearWorkoutNotifications()
    void wakeLockRef.current?.release()
    markAppDataStale()

    // Catalog cleanup for this-day extras doesn't decide anything the user is
    // waiting on — run it in parallel, after the route change, instead of
    // one awaited round trip per extra before it.
    const extrasToDrop = exercises.filter(e => isSessionExtra(e.id, originalDayIdsRef.current))
    void Promise.allSettled(extrasToDrop.map(ex => retireThisDayExtra(ex)))

    setSessionId(null)
    // A document navigation lets the worker serve the cached workout shell.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (browserIsOffline()) window.location.assign('/offline-workout')
    else router.replace('/log')
  }

  async function handleUndoFinish() {
    // Shared helper: uncomplete_session + rotation restore + clear token.
    const ok = await performFinishUndo(supabase)
    if (!ok) {
      setResumeToast('Could not undo. Try again.')
      setTimeout(() => setResumeToast(null), 4000)
      return false
    }
    markAppDataStale()
    setCompletionData(null)
    return true
  }

  async function handleFinish() {
    if (!sessionId || finishingRef.current) return
    if (!hasWorkingSet()) {
      // Align with server grind_session_has_working_set — warmups / empty weight
      // don't count, even if the UI shows them as checked.
      setResumeToast('Log at least one set with weight and reps before finishing.')
      setTimeout(() => setResumeToast(null), 4000)
      return
    }
    // Haptic: data-haptic="heavy" on FINISH (delegated / overlay).
    finishingRef.current = true
    setFinishing(true)
    restTimer.stop()
    void cancelRestNotifications(sessionId)
    clearWorkoutNotifications()
    void wakeLockRef.current?.release()

    try {
      await Promise.allSettled([...inflightSavesRef.current])
      await noteWriteRef.current?.catch(() => {})
      if (storageFailureRef.current.size > 0) {
        setResumeToast('Some edits have not been saved. Retry them before finishing.')
        return
      }
      const owner = workoutOwnerRef.current
      if (!owner) return
      const args = {
        day,
        note: workoutNote || null,
        startHour: startedAt.getHours(),
        offsetMinutes: -startedAt.getTimezoneOffset(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }
      let liveSessionId = sessionId
      let outcome
      if (demoMode) {
        outcome = await completeSession(supabase, {
          userId: owner, sessionId, dayType: day, note: args.note, startHour: args.startHour,
        })
      } else {
        await requestWorkoutFinish(owner, sessionId, { ...args, note: null })
        const synced = await syncSessionNow(sessionId, rawSupabase, owner)
        liveSessionId = synced.sessionId
        outcome = synced.completion
        if (!outcome) {
          const state = readWorkoutStore(owner)
          const blocked = getQueuedOps(liveSessionId, owner).some(op => op.rejected) ||
            state.notes[liveSessionId]?.rejected || state.drafts.find(draft => draft.id === liveSessionId)?.rejected
          setResumeToast(blocked
            ? 'Finish needs attention. Resume editing to resolve the saved changes.'
            : 'Finish saved on this device. It will sync when you reconnect.')
          return
        }
      }
      if (!outcome.ok) throw outcome.error
      const { result, newBadges } = outcome

      const xpEarned = result.xp_earned
      const prCount = result.pr_count
      // Prefer the RPC list, but if it under-reports vs live isPR badges (older
      // SQL deduped to one row per exercise), fall back to what the user saw.
      const serverPrExercises = outcome.prExercises
      const clientPrExercises = Object.entries(logs)
        .filter(([, l]) => l.isPR && l.checked && !l.skipped)
        .map(([key, l]) => {
          const exerciseId = key.slice(0, key.lastIndexOf('-'))
          return {
            name: exercises.find(e => e.id === exerciseId)?.name || 'Exercise',
            weight: parseFloat(l.weight) || 0,
            reps: parseInt(l.reps, 10) || 0,
          }
        })
        .sort((a, b) => b.weight * b.reps - a.weight * a.reps)
      const prExercises =
        serverPrExercises.length >= clientPrExercises.length
          ? serverPrExercises
          : clientPrExercises
      const newLevel = result.level
      const leveledUp = result.leveled_up

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
      await reconcileSessionExtras(exercises, logsRef.current)
      clearSessionExtraIds(liveSessionId)
      clearSessionRest(liveSessionId)
      clearSessionRest(sessionId)
      markAppDataStale()
    } catch (err) {
      // The workout is untouched (or safely resumable) — tell the user and let
      // them try again. Reuse the top toast so the message is impossible to
      // miss. Log the underlying error too: if the toast keeps firing on a good
      // connection it's a server-side RPC failure, and this is the only trace.
      reportError(err, { operation: 'handleFinish', route: '/log' })
      setResumeToast('Could not finish workout. Check your connection and try again.')
      setTimeout(() => setResumeToast(null), 5000)
    } finally {
      finishingRef.current = false
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
  const anyModalOpen = !!plateCalcTarget || !!pickerExit.data || !!completionData || showExitConfirm
  const restCounting = restTimer.active && !restTimer.paused
  const hintsBlocked = anyModalOpen || restCounting
  const workoutReady = !loading && exercises.length > 0
  const hasAnyPR = Object.entries(logs).some(([key, l]) => {
    const exId = key.slice(0, key.lastIndexOf('-'))
    return liveSetIsPR(l, baselineBestVolumes[exId])
  })

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
    body: 'Tap the chevron to add a note or RPE for this set.',
    preferred: ['bottom', 'right', 'top'],
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
    preferred: ['bottom', 'left', 'top'],
  })
  const hintPR = useFeatureTooltip('aw-pr', {
    when: hasAnyPR, suppressed: hintsBlocked, getEl: () => onboardTarget('aw-pr'),
    body: 'New personal record! GRIND compares against your best-ever weight x reps (volume) for this exercise.',
    preferred: ['top', 'bottom'],
  })
  // The rest-timer hint is the one exception that may show during a countdown.
  // Suppress during REST DONE flash (adjust controls unmounted).
  const hintRest = useFeatureTooltip('aw-rest-adjust', {
    when: restTimer.active && restTimer.remainingMs > 0,
    suppressed: anyModalOpen,
    getEl: () => onboardTarget('aw-rest-adjust'),
    body: 'Adjust your rest on the fly, or tap the timer to set a new default for this workout.',
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

  if (loadError) {
    return (
      <div style={{ padding: '24px 16px', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '20px',
          padding: '24px',
        }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
            Couldn&rsquo;t load this workout
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            Your exercises are safe &mdash; this is a connection hiccup, not an empty day.
          </div>
          <button
            onClick={() => { void initSession() }}
            className="press"
            style={{
              marginTop: '16px',
              width: '100%',
              height: '40px',
              backgroundColor: 'var(--surface-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              fontFamily: 'var(--font-display)',
              fontSize: '15px',
              letterSpacing: '1px',
              cursor: 'pointer',
            }}
          >
            RETRY
          </button>
        </div>
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
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--border-strong)' }}>
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

  const nextSet = exercises.flatMap(exercise => Array.from(
    { length: exercise.sets_target + (extraSets[exercise.id] ?? 0) },
    (_, index) => ({ exercise, number: index + 1, key: `${exercise.id}-${index + 1}` }),
  )).find(entry => !logs[entry.key]?.checked && !logs[entry.key]?.skipped)
  const workingSet = hasWorkingSet()
  const store = readWorkoutStore(workoutOwner)
  const currentId = sessionId ? resolveSessionAlias(sessionId, workoutOwner) : null
  const queued = currentId ? getQueuedOps(currentId, workoutOwner) : []
  const rejected = queued.find(op => op.rejected)
  const noteState = currentId ? store.notes[currentId] : undefined
  const finishState = currentId ? store.finishes[currentId] : undefined
  const draftError = store.drafts.find(draft => draft.id === currentId)?.rejected
  const issue = rejected?.rejected ?? noteState?.rejected ?? finishState?.rejected ?? draftError
  const syncLabel = storageError ? 'Some edits aren’t saved' : issue ? 'Sync needs attention'
    : finishState ? 'Finish saved on device' : (queued.length || noteState) ? 'Saved on device'
    : checked > 0 && !demoMode ? 'Synced' : ''

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
          onAskCoach={() => {
            const message =
              "How was that workout? Give me a quick take on today’s session — what went well and what to watch next time."
            // Queue via the bus (survives CoachRootLazy mount) before navigating.
            requestOpenCoach({ message, size: 'compact' })
            router.push('/home')
          }}
        />
      )}

      {pickerExit.data && (
        <ExercisePickerSheet
          intent={pickerExit.data === 'add' ? 'add' : 'swap'}
          currentExerciseId={pickerExit.data === 'add' ? null : pickerExit.data.slice('swap:'.length)}
          day={day}
          allExercises={allExercises}
          currentExercises={exercises}
          closing={pickerExit.closing}
          onSelect={pickerExit.data === 'add' ? handleAddExercise : handleSwapExercise}
          onCreate={pickerExit.data === 'add' ? createAndAddExercise : createAndSwapExercise}
          onClose={() => {
            setSwapTarget(null)
            setAddExerciseOpen(false)
          }}
        />
      )}

      {renameExit.data && (
        <RenameExerciseDialog
          key={renameExit.data.id}
          exercise={renameExit.data}
          closing={renameExit.closing}
          onSave={name => handleRenameExercise(renameExit.data!, name)}
          onClose={() => setRenameTarget(null)}
        />
      )}

      {showExitConfirm && (
        <div
          onClick={() => { if (!discarding) setShowExitConfirm(false) }}
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
                data-haptic="light"
                onClick={() => setShowExitConfirm(false)}
                disabled={discarding}
                style={{
                  position: 'relative',
                  flex: 1, height: '44px', backgroundColor: 'var(--surface-elevated)',
                  border: '1px solid var(--border)', borderRadius: '8px',
                  color: 'var(--text-primary)', fontFamily: "'DM Sans', sans-serif",
                  fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                data-haptic="medium"
                disabled={discarding}
                onClick={async () => {
                  await Promise.allSettled([...inflightSavesRef.current])
                  await noteWriteRef.current?.catch(() => {})
                  if (storageFailureRef.current.size > 0) {
                    setShowExitConfirm(false)
                    setResumeToast('Some edits could not be saved. Retry them before leaving.')
                    return
                  }
                  if (!restTimer.persistForExit(getPauseRestOnExit())) {
                    setShowExitConfirm(false)
                    setResumeToast('Could not save the rest timer. Try again.')
                    return
                  }
                  setShowExitConfirm(false)
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                  if (browserIsOffline()) window.location.assign('/offline-workout')
                  else router.replace('/log')
                }}
                style={{
                  position: 'relative',
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
              data-haptic="heavy"
              onClick={handleDiscard}
              disabled={discarding}
              style={{
                position: 'relative',
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
        <ToastPill
          key={resumeToastExit.data}
          edge="top"
          exiting={resumeToastExit.closing}
          onDismiss={() => setResumeToast(null)}
          role="status"
          aria-live="polite"
          style={{
            top: 'calc(env(safe-area-inset-top) + 12px)',
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--accent)',
            color: 'var(--accent-text)',
            padding: '10px 16px',
            borderRadius: 'var(--radius-pill, 9999px)',
            fontSize: '13px',
            fontWeight: 500,
            zIndex: 300,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {resumeToastExit.data}
        </ToastPill>
      )}

      {/* Undo toast — anchored to the top so it's visible wherever you are scrolled.
          Sits just below the resume toast if both happen to show. */}
      {undoToastExit.data && (
        <ToastPill
          key={undoToastExit.data.key}
          edge="top"
          exiting={undoToastExit.closing}
          onDismiss={() => setUndoState(null)}
          role="status"
          aria-live="polite"
          style={{
            top: `calc(env(safe-area-inset-top) + ${resumeToastExit.data ? '60px' : '12px'})`,
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
            pointerEvents: 'auto',
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
            data-haptic="medium"
            onClick={handleUndo}
            style={{
              position: 'relative',
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
        </ToastPill>
      )}

      {/* Passive "saved" confirmation — bottom-anchored, non-interactive.
          Sits above the finish/rest bar, and rides up above the keyboard when
          one is open so it stays visible while editing. */}
      {saveToastExit.data && (
        <ToastPill
          key={saveToastExit.data}
          edge="bottom"
          exiting={saveToastExit.closing}
          onDismiss={() => setSaveToast(null)}
          role="status"
          aria-live="polite"
          style={{
            bottom: `calc(${keyboardInset > 0 ? `${keyboardInset}px` : 'env(safe-area-inset-bottom)'} + ${restTimer.active ? '104px' : '92px'})`,
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
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {saveToastExit.data}
        </ToastPill>
      )}

      {/* Plate calculator */}
      {plateExit.data && (
        <PlateCalculator
          closing={plateExit.closing}
          initialTarget={plateExit.data.current}
          onClose={() => setPlateCalcTarget(null)}
          onApply={w => {
            if (!plateExit.data) return
            updateLog(plateExit.data.key, 'weight', String(w))
            setPlateCalcTarget(null)
          }}
        />
      )}

      {/* Soft one-time opt-in after the first rest — not on cold launch. */}
      {pushCoachOpen && (
        <div
          role="status"
          style={{
            position: 'fixed',
            left: '12px',
            right: '12px',
            bottom: restTimer.active
              ? 'calc(108px + env(safe-area-inset-bottom))'
              : 'calc(72px + env(safe-area-inset-bottom))',
            zIndex: 55,
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '12px 14px',
            boxShadow: 'var(--card-shadow)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Get a lock-screen ping when rest ends?
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            Optional. You can change this anytime in Profile → Settings.
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="press"
              disabled={pushCoachBusy}
              onClick={() => {
                markPushCoachSeen()
                setPushCoachOpen(false)
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '8px 10px',
              }}
            >
              Not now
            </button>
            <button
              type="button"
              className="press"
              disabled={pushCoachBusy}
              onClick={async () => {
                setPushCoachBusy(true)
                const result = await subscribeToPush()
                setPushCoachBusy(false)
                markPushCoachSeen()
                setPushCoachOpen(false)
                if (result.ok) {
                  const prefs = await fetchNotificationPrefs()
                  if (prefs) {
                    setPushPrefs(prefs)
                    pushPrefsRef.current = prefs
                  }
                } else {
                  setResumeToast(result.error || 'Could not enable notifications')
                  setTimeout(() => setResumeToast(null), 4000)
                }
              }}
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--on-accent)',
                border: 'none',
                borderRadius: '9999px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                padding: '8px 14px',
              }}
            >
              {pushCoachBusy ? 'Enabling…' : 'Enable'}
            </button>
          </div>
        </div>
      )}

      {restTimer.active && (
        <div className="wo-rest-sync" role="status">
          {restTimer.paused ? 'Rest paused' : restTimer.done ? 'Rest done' :
            `Rest until ${new Date(restTimer.startedAt + restTimer.durationMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`}
          {syncLabel && ` · ${syncLabel}`}
        </div>
      )}
      {/* Rest timer owns the lower controls while it is running. */}
      {restTimer.active && restTimer.exerciseId && (
        <RestTimerBar
          exerciseId={restTimer.exerciseId}
          exerciseName={exercises.find(e => e.id === restTimer.exerciseId)?.name ?? ''}
          sessionId={sessionId}
          remainingMs={restTimer.remainingMs}
          durationMs={restTimer.durationMs}
          paused={restTimer.paused}
          onStop={restTimer.stop}
          onAdd={(sec) => {
            restTimer.addSeconds(sec)
            if (sessionId) {
              const next = Math.max(5, Math.round(restTimer.durationMs / 1000) + sec)
              setSessionRest(sessionId, next)
            }
          }}
          onPause={restTimer.pause}
          onResume={restTimer.resume}
          onDefaultChange={(sec) => restTimer.applyDefault(sec)}
        />
      )}

      <div className="page page--workout" style={{ paddingBottom: workingSet || restTimer.active ? 'calc(140px + env(safe-area-inset-bottom))' : 'calc(72px + env(safe-area-inset-bottom))', fontFamily: "'DM Sans', sans-serif" }}>
       <div className="wo-layout">

        {/* Desktop sidebar rail — hidden on mobile via CSS. Mirrors the mobile
            header (title/timer/progress) and adds an exercise jump-list. */}
        <aside className="wo-sidebar">
          <p className="wo-keys">Tab between controls. Enter advances from weight and logs the set from reps.</p>
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

          <button
            type="button"
            className="press"
            data-haptic="light"
            onClick={() => requestOpenCoach({ size: 'compact' })}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--accent-text)', padding: 0,
              fontFamily: "'DM Sans', sans-serif", fontSize: '13px', fontWeight: 600,
            }}
          >
            Ask Coach
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
                <button title={ex.name}
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
                    overflowWrap: 'anywhere',
                  }}>
                    {ex.name}
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              className="wo-jump-item press wo-dashed-add"
              data-haptic="light"
              onClick={() => {
                setSwapTarget(null)
                setAddExerciseOpen(true)
              }}
              aria-label="Add an exercise to this workout"
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                width: '100%', textAlign: 'left',
                border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-sm)',
                padding: '7px 8px', cursor: 'pointer',
                marginTop: '4px',
                color: 'var(--text-secondary)',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              <span style={{
                width: '16px', height: '16px', borderRadius: '9999px', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1.5px solid var(--border-strong)',
                color: 'var(--text-muted)',
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </span>
              Add exercise
            </button>
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
              minWidth: 0,
              flex: 1,
              textAlign: 'center',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              padding: '0 4px',
            }}>
              {dayLabel(day)}
            </h1>

            <div style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              minWidth: '50px', justifyContent: 'flex-end',
            }}>
              <button
                type="button"
                className="press"
                data-haptic="light"
                aria-label="Ask Coach"
                onClick={() => requestOpenCoach({ size: 'compact' })}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '8px', minWidth: '44px', minHeight: '44px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--accent-text)',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
                  <text
                    x="12" y="12.5"
                    textAnchor="middle" dominantBaseline="middle"
                    fill="currentColor"
                    fontFamily="var(--font-display, 'Bebas Neue', sans-serif)"
                    fontSize="11" fontWeight="700"
                  >G</text>
                </svg>
              </button>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '14px', color: 'var(--text-secondary)',
                minWidth: '44px', textAlign: 'right',
              }}>
                {formatElapsed(elapsed)}
              </span>
            </div>
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
              lastSetNotes={lastSetNotes}
              priorVolume={baselineBestVolumes[ex.id]}
              editingKey={editingKey}
              nextSetKey={nextSet?.key}
              onCheck={handleCheck}
              onUpdate={updateLog}
              className={enteredExerciseId === ex.id ? 'swap-in' : undefined}
              onSwap={() => {
                setAddExerciseOpen(false)
                setSwapTarget(ex.id)
              }}
              onRename={() => setRenameTarget(ex)}
              canRemove={isSessionExtra(ex.id, originalDayIds) && exercises.length > 1}
              onRemove={() => { void handleRemoveExercise(ex.id) }}
              onSkipSet={handleSkipSet}
              onUnskipSet={handleUnskipSet}
              onDeleteSet={handleDeleteSet}
              onSkipExercise={handleSkipExercise}
              onUnskipExercise={handleUnskipExercise}
              onToggleWarmup={toggleWarmup}
              onWarmupRamp={() => applyWarmupRamp(ex.id)}
              onUndoWarmupRamp={() => { void undoWarmupRamp(ex.id) }}
              canUndoWarmup={!!warmupUndo[ex.id]}
              onAddSet={() => handleAddSet(ex.id)}
              onStartEdit={handleStartEdit}
              onSaveEdit={handleSaveEdit}
              onPersistMeta={persistSetMeta}
              onOpenPlateCalc={(key, current) => setPlateCalcTarget({ key, current })}
            />
          ))}

          <button
            type="button"
            className="press wo-dashed-add"
            data-haptic="light"
            onClick={() => {
              setSwapTarget(null)
              setAddExerciseOpen(true)
            }}
            aria-label="Add an exercise to this workout"
            style={{
              position: 'relative',
              width: '100%',
              height: '44px',
              backgroundColor: 'transparent',
              border: '1px dashed var(--border-strong)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-sans)',
              fontSize: '13px',
              fontWeight: 600,
              letterSpacing: '0.5px',
              cursor: 'pointer',
            }}
          >
            + ADD EXERCISE
          </button>

          {issue && (
            <section className="wo-sync-issue" aria-label="Workout sync issue">
              <strong>Saved changes need attention</strong>
              <p>{rejected
                ? `${exercises.find(exercise => exercise.id === rejected.exerciseId)?.name ?? 'Exercise'} · Set ${rejected.setNumber}`
                : draftError ? 'Local workout draft' : noteState?.rejected ? 'Workout note' : 'Finish request'}</p>
              <p>{issue}</p>
              <button type="button" onClick={() => {
                if (workoutOwner && currentId) {
                  void reopenWorkoutDraft(workoutOwner, currentId).then(() => {
                    if (rejected) setEditingKey(`${rejected.exerciseId}-${rejected.setNumber}`)
                    else if (noteState?.rejected) document.getElementById('workout-note')?.focus()
                    else void retryPendingSync()
                  }).catch(() => setStorageError(true))
                }
              }}>{rejected ? 'Correct saved set' : 'Resolve sync'}</button>
              {rejected && workoutOwner && currentId && (
                <button type="button" onClick={() => {
                  void removeQueuedOp(currentId, rejected.exerciseId, rejected.setNumber, workoutOwner, rejected.revision)
                    .catch(() => setStorageError(true))
                }}>Remove saved edit</button>
              )}
            </section>
          )}

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
            {lastWorkoutNote && (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                <span style={{ fontSize: '10px', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-muted)', marginRight: '6px' }}>
                  Last time
                </span>
                {lastWorkoutNote}
              </div>
            )}
            <textarea
              id="workout-note"
              value={workoutNote}
              onChange={e => changeWorkoutNote(e.target.value)}
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

      {/* Finish button — hidden while the rest bar owns the bottom edge
          (including the brief REST DONE / OK flash). Always pinned to the
          viewport bottom otherwise; the keyboard appears on top of it. */}
      {!restTimer.active && (
      <div className={`wo-fixed-bar${workingSet ? '' : ' wo-fixed-bar--compact'}`} style={{
        position: 'fixed',
        bottom: 0,
        paddingTop: workingSet ? '10px' : '5px',
        paddingLeft: '16px',
        paddingRight: '16px',
        paddingBottom: workingSet ? 'max(12px, env(safe-area-inset-bottom))' : 'max(5px, env(safe-area-inset-bottom))',
        backgroundColor: 'var(--bg)',
        borderTop: '1px solid var(--border)',
        zIndex: 50,
      }}>
        <div className="wo-finish-inner">
        {(() => {
          const pending = hasPendingSync()
          const pendingCount = pendingSyncCount()
          const store = readWorkoutStore(workoutOwner)
          const intent = sessionId ? store.finishes[sessionId] : undefined
          const pendingNote = sessionId ? store.notes[sessionId] : undefined
          const rejected = !!(sessionId && (getQueuedOps(sessionId).some(op => op.rejected) ||
            pendingNote?.rejected || intent?.rejected || store.drafts.find(draft => draft.id === sessionId)?.rejected))
          const canFinish = hasWorkingSet() && !storageError && !finishing
          if (!hasWorkingSet() && !pending && !storageError) {
            return <div className="wo-next-set-hint">{nextSet
              ? `Next · ${nextSet.exercise.name} · Set ${nextSet.number}` : 'Log a working set to finish'}</div>
          }
          return (
            <>
            <button
              onClick={handleFinish}
              disabled={!canFinish}
              className="wo-finish-btn"
              data-haptic="heavy"
              title="Save and finish this workout"
              style={{
                position: 'relative',
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
              {finishing ? 'SAVING…' : intent ? 'RETRY FINISH' : 'FINISH WORKOUT'}
            </button>
            {intent && workoutOwner && sessionId && (
              <button type="button" className="wo-next-set-hint" onClick={() => {
                void reopenWorkoutDraft(workoutOwner, sessionId).catch(() => setStorageError(true))
              }}>Resume editing</button>
            )}
            {(syncLabel || pending) && (
              <div
                role="status"
                style={{
                  marginTop: '8px',
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  textAlign: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  flexWrap: 'wrap',
                }}
              >
                <span>
                  {storageError ? 'Edits not saved' : rejected ? 'Saved edits need attention' :
                    intent ? 'Finish saved on this device' :
                    pendingCount ? `${pendingCount} ${pendingCount === 1 ? 'set' : 'sets'} saved on this device` : syncLabel}
                </span>
                {(pending || pendingNote || intent) && <><span aria-hidden="true">·</span>
                <button
                  type="button"
                  data-haptic="light"
                  onClick={() => { void retryPendingSync() }}
                  className="press"
                  style={{
                    position: 'relative',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'var(--accent-text)',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Retry
                </button></>}
              </div>
            )}
            </>
          )
        })()}
        {workingSet && <div className="wo-finish-summary" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {skipped > 0
            ? `${checked} done · ${skipped} skipped · ${total} total`
            : `${checked} / ${total} sets`}
        </div>}
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
  /** Prior-session best volume (lbs×reps). Live PR chips derive from this. */
  priorVolume: number | null | undefined
  lastSetNotes: Record<string, string>
  editingKey: string | null
  nextSetKey?: string
  onCheck: (exerciseId: string, setNumber: number) => void
  onUpdate: (key: string, field: 'weight' | 'reps' | 'note' | 'rpe', value: string) => void
  onSwap: () => void
  onRename: () => void
  canRemove: boolean
  onRemove: () => void
  onSkipSet: (exerciseId: string, setNumber: number) => void
  onUnskipSet: (exerciseId: string, setNumber: number) => void
  onDeleteSet: (exerciseId: string, setNumber: number) => void
  onSkipExercise: (exerciseId: string) => void
  onUnskipExercise: (exerciseId: string) => void
  onToggleWarmup: (exerciseId: string, setNumber: number) => void
  onWarmupRamp: () => void
  onUndoWarmupRamp: () => void
  canUndoWarmup: boolean
  onAddSet: () => void
  onStartEdit: (key: string) => void
  onSaveEdit: (exerciseId: string, setNumber: number) => void
  onPersistMeta: (
    exerciseId: string,
    setNumber: number,
    overrides?: { note?: string; rpe?: string },
  ) => void
  onOpenPlateCalc: (key: string, current: number) => void
  className?: string
}

function ExerciseCard({
  exercise, firstExercise, extraSets, logs, previousBest, priorVolume, lastSetNotes, editingKey, nextSetKey,
  onCheck, onUpdate, onSwap, onRename, canRemove, onRemove,
  onSkipSet, onUnskipSet, onDeleteSet,
  onSkipExercise, onUnskipExercise,
  onToggleWarmup, onWarmupRamp, onUndoWarmupRamp, canUndoWarmup, onAddSet, onStartEdit, onSaveEdit, onPersistMeta,
  onOpenPlateCalc,
  className,
}: ExerciseCardProps) {
  const { unitLabel, fmt, toDisplay } = useUnit()
  const warmupPercents = readWarmupPercents()
  const totalSets = exercise.sets_target + extraSets
  const setNumbers = Array.from({ length: totalSets }, (_, i) => i + 1)
  const anySkipped = setNumbers.some(s => logs[`${exercise.id}-${s}`]?.skipped)
  const allSkipped = setNumbers.every(s => logs[`${exercise.id}-${s}`]?.skipped)
  const [warmupHelpOpen, setWarmupHelpOpen] = useState(false)
  const warmupHelpBtnRef = useRef<HTMLButtonElement>(null)
  const warmupHelpTipRef = useRef<HTMLDivElement>(null)
  const warmupHelpLockUntil = useRef(0)
  const showWarmupControl = warmupPercents.length > 0 || canUndoWarmup

  useEffect(() => {
    if (!warmupHelpOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (warmupHelpBtnRef.current?.contains(t)) return
      if (warmupHelpTipRef.current?.contains(t)) return
      setWarmupHelpOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [warmupHelpOpen])

  return (
    <div id={`wo-ex-${exercise.id}`} className={className} style={{
      backgroundColor: 'var(--surface)',
      border: `1px solid ${anySkipped ? 'rgba(239,68,68,0.2)' : 'var(--border)'}`,
      borderRadius: '12px',
      // Visible so the reps PR chip (hangs 8px outside the input) isn't clipped
      // — overflow:hidden made live PRs vanish on the first set / card edge
      // while the finish screen still listed them.
      overflow: 'visible',
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
            {/* Skip/Undo exercise button */}
            <button
              type="button"
              className="wo-ghost-btn hit-44"
              onClick={() => allSkipped ? onUnskipExercise(exercise.id) : onSkipExercise(exercise.id)}
              title={allSkipped ? 'Undo skip' : 'Skip exercise'}
              aria-label={allSkipped ? `Undo skip on ${exercise.name}` : `Skip ${exercise.name}`}
              data-haptic="light"
              style={{ minHeight: '36px', padding: '0 8px', gap: '3px' }}
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

            {/* Rename button — same exercise, new label; history follows */}
            <button
              type="button"
              className="wo-ghost-btn hit-44"
              data-haptic="light"
              onClick={onRename}
              title="Rename exercise"
              aria-label={`Rename ${exercise.name}`}
              style={{ width: '36px', height: '36px', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </button>

            {/* Swap button */}
            <button
              type="button"
              className="wo-ghost-btn hit-44"
              data-onboard={firstExercise ? 'aw-swap' : undefined}
              data-haptic="light"
              onClick={onSwap}
              title="Swap exercise"
              aria-label={`Swap ${exercise.name} for another exercise`}
              style={{ width: '36px', height: '36px', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                <polyline points="17 1 21 5 17 9"/>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                <polyline points="7 23 3 19 7 15"/>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
              </svg>
            </button>
            {canRemove && (
              <button
                type="button"
                className="wo-ghost-btn"
                data-haptic="medium"
                onClick={onRemove}
                title="Remove from this workout"
                aria-label={`Remove ${exercise.name} from this workout`}
                style={{ padding: '2px 6px', gap: '3px' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--danger)' }}>
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
                <span style={{
                  fontSize: '10px',
                  color: 'var(--danger)',
                  fontFamily: "'Bebas Neue', sans-serif",
                  letterSpacing: '0.5px',
                }}>
                  REMOVE
                </span>
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {formatSetsReps(exercise.sets_target, exercise.reps_target)}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
            {previousBest !== null ? (previousBest === 0 ? 'prev: BW' : `prev: ${fmt(previousBest)} ${unitLabel}`) : 'no previous data'}
          </span>
        </div>
      </div>

      <div style={{ height: '1px', backgroundColor: 'var(--border)' }} />

      <div style={{ padding: '8px 0' }}>
        {/* Column headers. The two leading spacers mirror the SET label and W columns
           so LBS/REPS sit centered over their inputs. Plate calc lives in the
           Warm-up / plates / Add set row below — not here, where it crowded the labels. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px 6px' }}>
          <span aria-hidden style={{ minWidth: '38px', flexShrink: 0 }} />
          <span aria-hidden="true" style={{
            width: '44px', flexShrink: 0, textAlign: 'center',
            fontSize: '10px', fontWeight: 600, letterSpacing: '0.5px',
            textTransform: 'uppercase', color: 'var(--text-muted)',
            fontFamily: "'DM Sans', sans-serif",
          }}>WU</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              width: '56px', textAlign: 'center',
              fontSize: '10px', fontWeight: 600, letterSpacing: '0.5px',
              textTransform: 'uppercase', color: 'var(--text-muted)',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {unitLabel}
            </span>
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
          const logEntry = logs[key] ?? emptySetState()
          const isBonus = setNum > exercise.sets_target
          const editing = editingKey === key
          const prevReps = findCarryReps(logs, exercise.id, setNum)
          return (
            <SetRow
              key={key}
              setNumber={setNum}
              isBonus={isBonus}
              setsTarget={exercise.sets_target}
              onboardFirst={firstExercise && setNum === 1 && !isBonus}
              editing={editing}
              nextSet={key === nextSetKey}
              showPR={liveSetIsPR(logEntry, priorVolume)}
              logEntry={logEntry}
              prevReps={prevReps}
              lastNote={lastSetNotes[key] ?? ''}
              onCheck={() => onCheck(exercise.id, setNum)}
              onSaveEdit={() => onSaveEdit(exercise.id, setNum)}
              onStartEdit={() => onStartEdit(key)}
              onWeightChange={(v) => onUpdate(key, 'weight', v)}
              onRepsChange={(v) => onUpdate(key, 'reps', v)}
              onNoteChange={(v) => onUpdate(key, 'note', v)}
              onNoteBlur={() => onPersistMeta(exercise.id, setNum)}
              onRpeChange={(v) => {
                onUpdate(key, 'rpe', v)
                // Pass the new value through: `logs` in this closure predates it.
                void onPersistMeta(exercise.id, setNum, { rpe: v })
              }}
              onToggleWarmup={() => onToggleWarmup(exercise.id, setNum)}
              onSkip={() => onSkipSet(exercise.id, setNum)}
              onUnskip={() => onUnskipSet(exercise.id, setNum)}
              onDelete={() => onDeleteSet(exercise.id, setNum)}
              canDelete={isBonus || (!!logEntry.isWarmup && extraSets > 0)}
            />
          )
        })}

        <div style={{ padding: '6px 16px 10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Row is Warm-up % | plates | + Add set. Help lives inside the
              dashed Warm-up control as its own button so a tap on "?" never
              also fires the ramp. */}
          {showWarmupControl && (
          <div
            style={{
              position: 'relative',
              flex: 1,
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              minWidth: 0,
              backgroundColor: 'transparent',
              border: '1px dashed var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              padding: '0 2px 0 0',
            }}
          >
            <button
              ref={warmupHelpBtnRef}
              type="button"
              className="press hit-44"
              data-haptic="light"
              aria-label="What warm-up percent does"
              aria-expanded={warmupHelpOpen}
              aria-disabled={warmupHelpOpen}
              aria-controls={warmupHelpOpen ? `warmup-help-${exercise.id}` : undefined}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                if (warmupHelpOpen) return
                if (Date.now() < warmupHelpLockUntil.current) return
                warmupHelpLockUntil.current = Date.now() + 700
                setWarmupHelpOpen(true)
              }}
              style={{
                width: '28px',
                height: '28px',
                flexShrink: 0,
                margin: '0 4px 0 6px',
                borderRadius: '9999px',
                border: 'none',
                backgroundColor: warmupHelpOpen ? 'var(--surface-elevated)' : 'transparent',
                color: warmupHelpOpen ? 'var(--text-secondary)' : 'var(--text-muted)',
                fontFamily: 'var(--font-sans)',
                fontSize: '13px',
                fontWeight: 700,
                cursor: warmupHelpOpen ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
                padding: 0,
                pointerEvents: warmupHelpOpen ? 'none' : 'auto',
              }}
            >
              ?
            </button>
            <span
              aria-hidden
              style={{
                width: '1px',
                height: '14px',
                flexShrink: 0,
                backgroundColor: 'var(--border)',
                marginRight: '4px',
                opacity: 0.9,
              }}
            />
            <button
              type="button"
              className="press"
              data-haptic="light"
              onClick={() => {
                setWarmupHelpOpen(false)
                if (canUndoWarmup) onUndoWarmupRamp()
                else onWarmupRamp()
              }}
              aria-label={canUndoWarmup ? `Undo warm-up ramp for ${exercise.name}` : `Apply warm-up ramp for ${exercise.name}`}
              style={{
                position: 'relative',
                flex: 1,
                minWidth: 0,
                height: '100%',
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                color: canUndoWarmup ? 'var(--accent-text)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-sans)',
                fontSize: '11px',
                whiteSpace: 'nowrap',
                fontWeight: 600,
                letterSpacing: '0.5px',
                cursor: 'pointer',
                padding: '0 8px 0 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {canUndoWarmup ? 'UNDO WARM-UP' : 'WARM-UP %'}
            </button>
          </div>
          )}
          <button
            type="button"
            className="press"
            data-onboard={firstExercise ? 'aw-plate' : undefined}
            data-haptic="light"
            onClick={() => {
              setWarmupHelpOpen(false)
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
              width: '40px',
              height: '40px',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              padding: 0,
              color: 'var(--text-secondary)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="3" width="6" height="18" rx="1" />
              <line x1="6" y1="8" x2="6" y2="16" />
              <line x1="18" y1="8" x2="18" y2="16" />
            </svg>
          </button>
          <button
            type="button"
            className="press wo-dashed-add"
            data-onboard={firstExercise ? 'aw-addset' : undefined}
            data-haptic="light"
            onClick={onAddSet}
            aria-label={`Add another set to ${exercise.name}`}
            style={{
              position: 'relative',
              flex: 1,
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
            }}
          >
            + ADD SET
          </button>
        </div>
        {warmupHelpOpen && (
          <div ref={warmupHelpTipRef} id={`warmup-help-${exercise.id}`}>
            <Tooltip
              getEl={() => warmupHelpBtnRef.current}
              title="Warm-up %"
              body={
                warmupPercents.length === 0
                  ? 'Turned off. Set how many warm-up sets and what percent of your working weight in Settings.'
                  : `Fills ${warmupPercents.length} easy warm-up${warmupPercents.length === 1 ? '' : 's'} — ${formatWarmupPercentsList(warmupPercents)} of the weight you're about to lift. Your real sets stay after those. Warm-ups don't count as PRs. Tap UNDO WARM-UP if you applied by accident.`
              }
              onDismiss={() => setWarmupHelpOpen(false)}
              preferred={['top', 'bottom']}
              maxWidth={260}
            />
          </div>
        )}
      </div>
    </div>
  )
}


// ─── Set Row ───────────────────────────────────────────────────────────────────

interface SetRowProps {
  nextSet: boolean
  setNumber: number
  isBonus: boolean
  /** Working-set target count — bonus labels use setNumber - setsTarget (+1, +2…). */
  setsTarget: number
  /** First non-bonus set of the first exercise — carries the one-off hint anchors. */
  onboardFirst?: boolean
  editing: boolean
  /** Derived each render from prior-session volume — not the stored isPR flag. */
  showPR: boolean
  logEntry: SetState
  prevReps: string
  /** Note left on this set the last time this exercise was done. */
  lastNote: string
  onCheck: () => void
  onSaveEdit: () => void
  onStartEdit: () => void
  onWeightChange: (v: string) => void
  onRepsChange: (v: string) => void
  onNoteChange: (v: string) => void
  onNoteBlur: () => void
  onRpeChange: (v: string) => void
  onToggleWarmup: () => void
  onSkip: () => void
  onUnskip: () => void
  onDelete: () => void
  canDelete?: boolean
}

function SetRow({
  setNumber, isBonus, setsTarget, onboardFirst, editing, nextSet,
  showPR, logEntry, prevReps, lastNote,
  onCheck, onSaveEdit, onStartEdit,
  onWeightChange, onRepsChange, onNoteChange, onNoteBlur, onRpeChange,
  onToggleWarmup, onSkip, onUnskip, onDelete, canDelete,
}: SetRowProps) {
  const { fromDisplay, fmt } = useUnit()
  const [justChecked, setJustChecked] = useState(false)
  const [needsReps, setNeedsReps] = useState(false)
  const [needsWeight, setNeedsWeight] = useState(false)
  // Local unlock flips synchronously on the gesture that enters edit mode, so
  // inputs accept keystrokes before the parent's editingKey re-render lands.
  const [unlocked, setUnlocked] = useState(false)
  // Debounce the save action after entering edit mode — prevents the same
  // tap that opened edit (or a ghost click from the check→save restyle) from
  // immediately re-saving without the user changing anything.
  const [saveArmed, setSaveArmed] = useState(false)
  // null = auto: a row with a saved note starts open (notes can arrive after
  // mount when an in-progress session loads), an empty one starts closed.
  // The chevron under the set label sets it explicitly.
  const [noteOpen, setNoteOpen] = useState<boolean | null>(null)
  const noteVisible = noteOpen ?? (logEntry.note !== '' || logEntry.rpe !== '' || lastNote !== '')
  // logEntry.weight is stored canonically in lbs. We show it in the active display unit.
  // While the field is focused we keep the raw typed string in `rawWeight` so the user can
  // type freely (decimals, partial entries) without conversion fighting the keystrokes; on
  // blur we drop the buffer and the field re-derives from canonical state.
  const [rawWeight, setRawWeight] = useState<string | null>(null)
  const weightRef = useRef<HTMLInputElement>(null)
  const repsRef = useRef<HTMLInputElement>(null)
  const tap = useTapGesture()

  // Keep local unlock/save-arm in sync with the parent editing flag.
  // Deferred via rAF so we don't sync-setState in the effect body (cascading render lint).
  useEffect(() => {
    let armedTimer: number | undefined
    const raf = window.requestAnimationFrame(() => {
      if (editing) {
        setUnlocked(true)
        setSaveArmed(false)
        armedTimer = window.setTimeout(() => setSaveArmed(true), 350) as unknown as number
      } else {
        setUnlocked(false)
        setSaveArmed(false)
      }
    })
    return () => {
      window.cancelAnimationFrame(raf)
      if (armedTimer != null) window.clearTimeout(armedTimer)
    }
  }, [editing])

  // Clear unlock if the set gets skipped while we were mid-edit gesture.
  useEffect(() => {
    if (!logEntry.skipped) return
    const raf = window.requestAnimationFrame(() => {
      setUnlocked(false)
      setSaveArmed(false)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [logEntry.skipped])

  const inEdit = editing || unlocked
  const inputsLocked = logEntry.skipped || (logEntry.checked && !inEdit)

  function beginEdit(focus?: 'weight' | 'reps') {
    if (logEntry.skipped) return
    if (!logEntry.checked) return
    if (!inEdit) {
      setUnlocked(true)
      onStartEdit()
    }
    if (focus === 'weight') {
      window.setTimeout(() => weightRef.current?.focus(), 0)
    } else if (focus === 'reps') {
      window.setTimeout(() => repsRef.current?.focus(), 0)
    }
  }

  function handlePrimaryAction() {
    if (logEntry.skipped) return
    if (logEntry.checked && inEdit) {
      // Ignore ghost/accidental taps right after entering edit mode.
      if (!saveArmed) return
      onSaveEdit()
      return
    }
    if (logEntry.checked) {
      beginEdit()
      return
    }
    handleCheck()
  }

  function handleCheck() {
    if (logEntry.checked) return
    // Empty / invalid weight — nudge + focus (mirrors needsReps). BW is stored
    // as 0 and is a valid committed value; only blank/NaN/negative fail.
    const weightNum = logEntry.weight !== '' ? parseFloat(logEntry.weight) : NaN
    if (!Number.isFinite(weightNum) || weightNum < 0) {
      setNeedsWeight(true)
      weightRef.current?.focus()
      return
    }
    // If reps are empty but a previous set has reps, let the parent auto-fill.
    // Only block + nudge when there is genuinely nothing to copy from.
    if (logEntry.reps.trim() === '' && !prevReps) {
      setNeedsReps(true)
      repsRef.current?.focus()
      return
    }
    // The set is about to be saved (directly or via carried-forward reps) —
    // any earlier "needs reps/weight" warning no longer applies.
    if (needsReps) setNeedsReps(false)
    if (needsWeight) setNeedsWeight(false)
    setJustChecked(true)
    setTimeout(() => setJustChecked(false), 300)
    // On iOS, tapping the check button does NOT blur the input the user just
    // typed in, so the keyboard would linger (with the layout viewport panned)
    // right as the rest timer bar mounts. Dismiss it deterministically.
    if (document.activeElement === repsRef.current || document.activeElement === weightRef.current) {
      ;(document.activeElement as HTMLElement).blur()
    }
    // Haptic comes from data-haptic on the check button (iOS overlay + Android
    // delegated click). Keep post-await success buzz for PRs only.
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
    if (needsWeight && v.trim() !== '') setNeedsWeight(false)
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
      if (inEdit) {
        if (saveArmed) onSaveEdit()
      } else {
        handleCheck()
      }
    }
  }

  return (
    <div className={nextSet ? "wo-set-row wo-set-row--next" : "wo-set-row"}
      style={{
        opacity: logEntry.skipped ? 0.55 : logEntry.checked && !inEdit ? 0.75 : 1,
        transition: 'opacity 150ms ease',
        backgroundColor: inEdit ? 'var(--accent-wash)' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}>
        {/* Set label + note chevron: tapping toggles the per-set note input. */}
        <button
          type="button"
          data-onboard={onboardFirst ? 'aw-note' : undefined}
          data-haptic="light"
          onClick={() => setNoteOpen(!noteVisible)}
          aria-expanded={noteVisible}
          aria-label={noteVisible ? `Hide note for set ${setNumber}` : `Show note for set ${setNumber}`}
          style={{
            position: 'relative',
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
            {isBonus && setsTarget > 0 ? `+${setNumber - setsTarget}` : `SET ${setNumber}`}
          </span>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{
              // Accent when a note exists so it's findable while collapsed.
              color: (logEntry.note || logEntry.rpe) ? 'var(--accent-text)' : 'var(--text-muted)',
              transform: noteVisible ? 'rotate(180deg)' : 'none',
              transition: 'transform 150ms ease',
              marginLeft: '6px',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Warm-up toggle. The fixed-width column keeps the inputs aligned across rows. */}
        <div style={{
          width: '44px', flexShrink: 0, marginRight: '2px',
          display: 'flex', alignItems: 'center',
        }}>
          <button
            data-onboard={onboardFirst ? 'aw-warmup' : undefined}
            data-haptic="light"
            onClick={onToggleWarmup}
            disabled={logEntry.checked && !inEdit}
            aria-pressed={logEntry.isWarmup}
            aria-label={logEntry.isWarmup ? `Unmark set ${setNumber} as warm-up` : `Mark set ${setNumber} as warm-up`}
            title={logEntry.isWarmup ? 'Warm-up set (excluded from PRs)' : 'Mark as warm-up'}
            style={{
              // 44px tap target wrapping a visually-unchanged 28px pill — see
              // the inner span below — so the button doesn't grow on screen.
              position: 'relative',
              width: '44px', height: '44px',
              backgroundColor: 'transparent', border: 'none',
              cursor: (logEntry.checked && !inEdit) ? 'default' : 'pointer',
              flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span style={{
              width: '28px', height: '28px',
              borderRadius: '999px',
              border: `1px solid ${logEntry.isWarmup ? 'var(--accent-dim)' : 'var(--border)'}`,
              backgroundColor: logEntry.isWarmup ? 'color-mix(in srgb, var(--accent-dim) 18%, transparent)' : 'transparent',
              color: logEntry.isWarmup ? 'var(--accent-dim)' : 'var(--text-muted)',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '11px',
              fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              W
            </span>
          </button>
        </div>

        {/* Weight + reps inputs. Both are equal-sized fixed boxes with a clear gap
           so they never butt up against each other; their column labels live in the
           header above the sets. The group is flex:1 so the action buttons sit at the
           far right. */}
        {/* Weight + reps inputs. pointerDown unlocks a checked set before focus,
            so typing works immediately for both check-to-edit and tap-to-edit. */}
        <div
          className="wo-set-inputs"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            minWidth: 0,
          }}
        >
          <input
            ref={weightRef}
            type="text"
            inputMode="decimal"
            value={displayWeight}
            onChange={e => {
              if (inputsLocked) return
              handleWeightChange(e.target.value)
            }}
            onPointerDown={tap.onPointerDown}
            onPointerMove={e => {
              tap.onPointerMove(e)
              if (tap.didDrag() && document.activeElement === e.currentTarget) {
                e.currentTarget.blur()
              }
            }}
            onPointerUp={tap.onPointerEnd}
            onPointerCancel={tap.onPointerEnd}
            onClick={() => {
              if (tap.didDrag()) return
              if (logEntry.checked && !logEntry.skipped && !inEdit) {
                beginEdit('weight')
              }
            }}
            onFocus={e => {
              // Focus can arrive on touchstart before we know this is a scroll.
              // Do not unlock / select until the gesture is a tap.
              if (tap.didDrag()) {
                e.currentTarget.blur()
                return
              }
              if (inputsLocked) return
              // When BW is shown, clear the buffer so the user types a fresh value
              // rather than appending to the 'BW' text.
              if (displayWeight === 'BW') setRawWeight('')
              else e.target.select()
              ensureVisible(e.currentTarget)
            }}
            onBlur={() => { setRawWeight(null); setNeedsWeight(false) }}
            onKeyDown={handleWeightKeyDown}
            readOnly={inputsLocked}
            placeholder="—"
            aria-label={`Weight for set ${setNumber}`}
            aria-invalid={needsWeight}
            title={needsWeight ? 'Enter a weight to complete this set' : undefined}
            style={{
              width: '56px', flexShrink: 0, height: '40px',
              backgroundColor: 'var(--surface-elevated)',
              border: `1px solid ${needsWeight ? 'var(--danger)' : inputsLocked ? 'var(--border)' : 'var(--border-strong)'}`,
              borderRadius: '8px',
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '16px',
              textAlign: 'center',
              outline: 'none',
              transition: 'border-color 150ms ease',
              cursor: logEntry.skipped ? 'not-allowed' : inputsLocked ? 'pointer' : 'text',
              opacity: logEntry.skipped ? 0.5 : 1,
              pointerEvents: logEntry.skipped ? 'none' : 'auto',
            }}
          />
          <div style={{ position: 'relative', width: '56px', flexShrink: 0, overflow: 'visible' }}>
          <input
            ref={repsRef}
            type="text"
            inputMode="numeric"
            value={logEntry.reps}
            onChange={e => {
              if (inputsLocked) return
              handleRepsChange(e.target.value)
            }}
            onPointerDown={tap.onPointerDown}
            onPointerMove={e => {
              tap.onPointerMove(e)
              if (tap.didDrag() && document.activeElement === e.currentTarget) {
                e.currentTarget.blur()
              }
            }}
            onPointerUp={tap.onPointerEnd}
            onPointerCancel={tap.onPointerEnd}
            onClick={() => {
              if (tap.didDrag()) return
              if (logEntry.checked && !logEntry.skipped && !inEdit) {
                beginEdit('reps')
              }
            }}
            onFocus={e => {
              if (tap.didDrag()) {
                e.currentTarget.blur()
                return
              }
              if (inputsLocked) return
              e.target.select()
              ensureVisible(e.currentTarget)
            }}
            onBlur={() => setNeedsReps(false)}
            onKeyDown={handleRepsKeyDown}
            readOnly={inputsLocked}
            placeholder="0"
            aria-label={`Reps for set ${setNumber}`}
            aria-invalid={needsReps}
            title={needsReps ? 'Enter a rep count to complete this set' : undefined}
            style={{
              width: '56px', flexShrink: 0, height: '40px',
              backgroundColor: 'var(--surface-elevated)',
              border: `1px solid ${needsReps ? 'var(--danger)' : inputsLocked ? 'var(--border)' : 'var(--border-strong)'}`,
              borderRadius: '8px',
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '16px',
              textAlign: 'center',
              outline: 'none',
              transition: 'border-color 150ms ease',
              cursor: logEntry.skipped ? 'not-allowed' : inputsLocked ? 'pointer' : 'text',
              opacity: logEntry.skipped ? 0.5 : 1,
              pointerEvents: logEntry.skipped ? 'none' : 'auto',
            }}
          />
          {showPR && (
            <span data-onboard="aw-pr" style={{
              position: 'absolute',
              top: '-8px',
              right: '-8px',
              fontSize: '10px', fontFamily: "'Bebas Neue', sans-serif",
              color: 'var(--accent-text)',
              backgroundColor: 'var(--accent-wash)',
              border: '1px solid var(--accent-border)',
              borderRadius: '9999px', padding: '2px 7px',
              letterSpacing: '0.5px',
              lineHeight: 1.2,
              pointerEvents: 'none',
              zIndex: 2,
            }}>
              PR
            </span>
          )}
          </div>
        </div>

        {/* Bonus sets (added via + ADD SET) and ramp warm-ups can be deleted
            entirely. Planned working sets keep Skip/Undo. */}
        {canDelete ? (
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
          /* Skip / unskip set button. Unskip is always enabled. Skip is enabled
             when unchecked or when in edit mode (to skip a logged set). */
          <button
            className="press"
            data-onboard={onboardFirst ? 'aw-skip' : undefined}
            data-haptic="light"
            onClick={logEntry.skipped ? onUnskip : onSkip}
            disabled={!logEntry.skipped && logEntry.checked && !inEdit}
            title={
              logEntry.pendingSync
                ? 'Saved on this device — syncing when back online'
                : logEntry.skipped ? 'Undo skip' : 'Skip this set'
            }
            aria-label={
              logEntry.skipped
                ? `Undo skip on set ${setNumber}${logEntry.pendingSync ? ' (not yet synced)' : ''}`
                : `Skip set ${setNumber}`
            }
            style={{
              position: 'relative',
              width: '44px', height: '44px', minWidth: '44px',
              borderRadius: '9999px',
              border: `2px solid ${logEntry.skipped ? 'rgba(239,68,68,0.5)' : 'var(--border)'}`,
              backgroundColor: logEntry.skipped ? 'rgba(239,68,68,0.1)' : 'transparent',
              cursor: (!logEntry.skipped && logEntry.checked && !inEdit) ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'border-color 150ms ease, background-color 150ms ease',
              opacity: (!logEntry.skipped && logEntry.checked && !inEdit) ? 0.3 : 1,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
             style={{ color: logEntry.skipped ? 'var(--danger)' : 'var(--border-strong)' }}>
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {logEntry.skipped && logEntry.pendingSync && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute', top: '-2px', right: '-2px',
                  width: '10px', height: '10px', borderRadius: '9999px',
                  backgroundColor: 'var(--text-muted)',
                  border: '2px solid var(--bg)',
                }}
              />
            )}
          </button>
        )}

        {/* Single check / edit / save button — never remounts. Remounting a
            check→save swap used to ghost-click Save on the same tap that opened
            edit mode (especially on iOS). saveArmed gates Save for 350ms. */}
        <button
          data-onboard={onboardFirst && !inEdit ? 'aw-check' : undefined}
          data-haptic="heavy"
          onClick={handlePrimaryAction}
          disabled={logEntry.skipped || (inEdit && !saveArmed && logEntry.checked)}
          aria-label={
            logEntry.checked
              ? inEdit
                ? `Save set ${setNumber}`
                : `Edit set ${setNumber}${logEntry.pendingSync ? ' (not yet synced)' : ''}`
              : `Mark set ${setNumber} complete`
          }
          title={
            inEdit
              ? 'Save changes'
              : logEntry.pendingSync
                ? 'Saved on this device — syncing when back online'
                : undefined
          }
          aria-pressed={logEntry.checked && !inEdit}
          style={{
            position: 'relative',
            width: '44px', height: '44px', minWidth: '44px',
            borderRadius: '9999px',
            border: `2px solid ${
              inEdit ? 'var(--accent)' : logEntry.checked ? 'var(--accent)' : 'var(--border-strong)'
            }`,
            backgroundColor: inEdit
              ? 'var(--accent)'
              : logEntry.checked
                ? 'var(--accent-wash)'
                : 'transparent',
            cursor: logEntry.skipped || (inEdit && !saveArmed) ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: justChecked ? 'scale(1.2)' : 'scale(1)',
            transition: 'transform 200ms ease, border-color 150ms ease, background-color 150ms ease',
            flexShrink: 0,
            opacity: inEdit && !saveArmed ? 0.7 : 1,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{
              color: inEdit
                ? 'var(--on-accent)'
                : logEntry.checked
                  ? 'var(--accent-text)'
                  : 'var(--text-muted)',
            }}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {logEntry.checked && logEntry.pendingSync && !inEdit && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute', top: '-2px', right: '-2px',
                width: '10px', height: '10px', borderRadius: '9999px',
                backgroundColor: 'var(--text-muted)',
                border: '2px solid var(--bg)',
              }}
            />
          )}
        </button>
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
        <div inert={!noteVisible} style={{ padding: '4px 16px 8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span
              id={`rpe-${setNumber}-label`}
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 600,
                letterSpacing: '0.5px',
              }}
            >
              RPE
            </span>
            <div
              role="listbox"
              aria-labelledby={`rpe-${setNumber}-label`}
              aria-label={`RPE for set ${setNumber}`}
              aria-disabled={logEntry.skipped}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                gap: '6px',
                opacity: logEntry.skipped ? 0.5 : 1,
                pointerEvents: logEntry.skipped ? 'none' : 'auto',
              }}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => {
                const selected = logEntry.rpe === String(n)
                return (
                  <button
                    key={n}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-haptic="light"
                    disabled={logEntry.skipped}
                    onPointerDown={tap.onPointerDown}
                    onPointerMove={tap.onPointerMove}
                    onPointerUp={tap.onPointerEnd}
                    onPointerCancel={tap.onPointerEnd}
                    onClick={() => {
                      if (tap.didDrag()) return
                      if (logEntry.skipped) return
                      if (logEntry.checked && !inEdit) beginEdit()
                      onRpeChange(selected ? '' : String(n))
                    }}
                    style={{
                      position: 'relative',
                      height: '40px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                      backgroundColor: selected ? 'var(--accent)' : 'var(--surface-elevated)',
                      color: selected ? 'var(--on-accent)' : 'var(--text-primary)',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: logEntry.skipped ? 'default' : 'pointer',
                      transition: 'border-color 150ms ease, background-color 150ms ease, color 150ms ease',
                    }}
                  >
                    {n}
                  </button>
                )
              })}
            </div>
          </div>
          {lastNote && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              <span style={{ fontSize: '10px', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-muted)', marginRight: '6px' }}>
                Last time
              </span>
              {lastNote}
            </div>
          )}
          <input
            type="text"
            value={logEntry.note}
            onChange={e => onNoteChange(e.target.value)}
            onBlur={() => {
              // Persist to DB if the row is already saved (otherwise the next
              // check/save will flush the note via upsert).
              if (logEntry.checked) onNoteBlur()
              if (!logEntry.note && !logEntry.rpe && !lastNote) setNoteOpen(false)
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
