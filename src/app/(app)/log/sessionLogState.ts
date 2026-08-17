import { getQueuedOps } from '@/lib/utils/offlineQueue'

export interface SetState {
  weight: string
  reps: string
  checked: boolean
  skipped: boolean
  isPR: boolean
  isWarmup: boolean
  note: string
  /** Optional RPE 1–10; empty string = not set. */
  rpe: string
  logId?: string
  /** Checked locally but the write to Supabase failed even after retries. */
  pendingSync?: boolean
  /** Pre-skip backup: preserve weight/reps/note/RPE so unskip can restore them */
  skippedWeight?: string
  skippedReps?: string
  skippedNote?: string
  skippedRpe?: string
}

export type LogMap = Record<string, SetState>

export function emptySetState(weight = ''): SetState {
  return {
    weight,
    reps: '',
    checked: false,
    skipped: false,
    isPR: false,
    isWarmup: false,
    note: '',
    rpe: '',
  }
}

/**
 * The reps to carry forward into a blank set: the nearest EARLIER set number
 * for this exercise that has reps filled in.
 */
export function findCarryReps(logs: LogMap, exerciseId: string, setNumber: number): string {
  for (let s = setNumber - 1; s >= 1; s--) {
    const r = logs[`${exerciseId}-${s}`]?.reps
    if (r && r !== '') return r
  }
  return ''
}

/**
 * Coerce a get_exercise_bests / state volume to a finite number.
 * PostgREST often returns Postgres `numeric` as a string; missing / invalid
 * priors must be null so the first lift is a baseline, not a PR.
 */
export function normalizePriorVolume(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Local volume-PR hint for open sessions (server recomputes on finish).
 * Matches grind_recompute_stats: volume > prior_best, and only when a prior
 * completed session exists. Null / undefined / non-numeric prior ⇒ first
 * lift is the baseline, not a PR.
 */
export function computeLocalIsPR(
  isWarmup: boolean,
  weight: number | null,
  reps: number,
  prevBestVolume?: number | null | string,
): boolean {
  if (isWarmup || weight === null || !Number.isFinite(weight) || !Number.isFinite(reps)) {
    return false
  }
  const prior = normalizePriorVolume(prevBestVolume)
  if (prior == null) return false
  return weight * reps > prior
}

/** Live reps-box badge: checked working set that beats the prior-session baseline. */
export function liveSetIsPR(
  entry: {
    checked: boolean
    skipped: boolean
    isWarmup: boolean
    weight: string
    reps: string
  },
  prevBestVolume: unknown,
): boolean {
  if (!entry.checked || entry.skipped) return false
  if (entry.weight === '' || entry.reps === '') return false
  const weight = parseFloat(entry.weight)
  const reps = parseInt(entry.reps, 10)
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return false
  return computeLocalIsPR(entry.isWarmup, weight, reps, normalizePriorVolume(prevBestVolume))
}

export function parseRpe(raw: string): number | null {
  if (!raw || raw.trim() === '') return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1 || n > 10) return null
  return n
}

/**
 * How many bonus sets past `sets_target` appear in `logs` (DB rows + overlay).
 * Keys are `${exerciseId}-${setNumber}`; exercise ids are UUIDs so we split on
 * the last hyphen.
 */
export function extraSetsFromLogs(
  logs: LogMap,
  exercises: { id: string; sets_target: number }[],
): Record<string, number> {
  const maxByEx = new Map<string, number>()
  for (const key of Object.keys(logs)) {
    const dash = key.lastIndexOf('-')
    if (dash < 0) continue
    const exId = key.slice(0, dash)
    const n = Number(key.slice(dash + 1))
    if (!Number.isFinite(n)) continue
    maxByEx.set(exId, Math.max(maxByEx.get(exId) ?? 0, n))
  }
  const extras: Record<string, number> = {}
  for (const ex of exercises) {
    extras[ex.id] = Math.max(0, (maxByEx.get(ex.id) ?? 0) - ex.sets_target)
  }
  return extras
}

/** Fill missing 1..sets_target+extras slots so overlayed bonus sets have rows. */
export function ensureLogSlots(
  logs: LogMap,
  exercises: { id: string; sets_target: number }[],
  extraSets: Record<string, number>,
  fillWeight: (exerciseId: string) => string,
): void {
  for (const ex of exercises) {
    const total = ex.sets_target + (extraSets[ex.id] ?? 0)
    for (let s = 1; s <= total; s++) {
      const key = `${ex.id}-${s}`
      if (!logs[key]) logs[key] = emptySetState(fillWeight(ex.id))
    }
  }
}

/**
 * Overlays anything still sitting in the offline queue onto a freshly-built
 * LogMap (mutates in place).
 */
export function overlayQueuedOps(map: LogMap, sid: string) {
  for (const q of getQueuedOps(sid)) {
    const key = `${q.exerciseId}-${q.setNumber}`
    if (q.kind === 'delete') {
      // Unskip queues a delete of the skip marker — reset to a blank unchecked
      // row instead of removing the key. Deleting the key left handleCheck
      // bailing on `!logs[key]` after offline unskip → remount.
      map[key] = {
        ...emptySetState(),
        pendingSync: true,
      }
      continue
    }
    map[key] = {
      ...map[key],
      weight: q.weight !== null ? String(q.weight) : '',
      reps: q.reps !== null ? String(q.reps) : '',
      checked: !q.isSkipped,
      skipped: q.isSkipped,
      isPR: q.isPR,
      isWarmup: q.isWarmup,
      note: q.note ?? '',
      rpe: q.rpe != null ? String(q.rpe) : (map[key]?.rpe ?? ''),
      pendingSync: true,
    }
  }
}

const SESSION_EXTRAS_KEY = (sessionId: string) => `grind-session-extras:${sessionId}`

/** Parse persisted extra exercise ids (localStorage JSON array of strings). */
export function parseSessionExtraIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0) : []
  } catch {
    return []
  }
}

export function readSessionExtraIds(sessionId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    return parseSessionExtraIds(localStorage.getItem(SESSION_EXTRAS_KEY(sessionId)))
  } catch {
    return []
  }
}

export function writeSessionExtraIds(sessionId: string, ids: string[]) {
  if (typeof window === 'undefined') return
  const unique = [...new Set(ids)]
  try {
    if (unique.length === 0) localStorage.removeItem(SESSION_EXTRAS_KEY(sessionId))
    else localStorage.setItem(SESSION_EXTRAS_KEY(sessionId), JSON.stringify(unique))
  } catch {
    /* quota / private mode */
  }
}

export function clearSessionExtraIds(sessionId: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(SESSION_EXTRAS_KEY(sessionId))
  } catch {
    /* ignore */
  }
}

/**
 * Exercises logged (or queued) on this session that aren't already in the day's
 * list — typically an other-day movement swapped or added mid-workout. Appended
 * after the day's own rows so resume doesn't drop them.
 */
export function mergeSessionExercises<T extends { id: string }>(
  dayExercises: T[],
  catalog: T[],
  extraIds: Iterable<string>,
): T[] {
  const have = new Set(dayExercises.map(e => e.id))
  const byId = new Map(catalog.map(e => [e.id, e]))
  const extra: T[] = []
  for (const id of extraIds) {
    if (have.has(id)) continue
    const row = byId.get(id)
    if (!row) continue
    extra.push(row)
    have.add(id)
  }
  return extra.length === 0 ? dayExercises : [...dayExercises, ...extra]
}

/** True when this exercise was added/swapped in for this session, not the day's catalog. */
export function isSessionExtra(exerciseId: string, originalDayIds: Iterable<string>): boolean {
  const orig = originalDayIds instanceof Set ? originalDayIds : new Set(originalDayIds)
  return !orig.has(exerciseId)
}

export function sessionExtraIdsFor(
  sessionExerciseIds: string[],
  originalDayIds: Iterable<string>,
): string[] {
  const orig = originalDayIds instanceof Set ? originalDayIds : new Set(originalDayIds)
  return sessionExerciseIds.filter(id => !orig.has(id))
}

/**
 * Reconstruct the day's original active ids on resume: everything that was
 * already on the day, minus extras persisted for this session (including
 * newly created this-day rows that would otherwise look like catalog).
 */
export function originalDayIdsFromCatalog(
  dayActiveIds: string[],
  extraIds: Iterable<string>,
): string[] {
  const extras = extraIds instanceof Set ? extraIds : new Set(extraIds)
  return dayActiveIds.filter(id => !extras.has(id))
}

/** Non-warmup, non-skipped set with weight + reps — same bar as finishing a workout. */
export function extraHasWorkingSet(
  logs: LogMap,
  exerciseId: string,
  setCount: number,
): boolean {
  for (let s = 1; s <= setCount; s++) {
    const l = logs[`${exerciseId}-${s}`]
    if (!l?.checked || l.skipped || l.isWarmup) continue
    if (l.weight === '' || l.reps === '') continue
    const w = parseFloat(l.weight)
    const r = parseInt(l.reps, 10)
    if (Number.isFinite(w) && Number.isFinite(r)) return true
  }
  return false
}

/**
 * Keep a live-session extra on this day's catalog only when it is still in
 * the session at finish AND was actually trained. Removing it (or leaving it
 * blank/skipped) must not bring it back next time.
 */
export function shouldPersistSessionExtra(
  stillInSession: boolean,
  hasWorkingSet: boolean,
): boolean {
  return stillInSession && hasWorkingSet
}
