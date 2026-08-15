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
  /** Pre-skip backup: preserve weight/reps/note so unskip can restore them */
  skippedWeight?: string
  skippedReps?: string
  skippedNote?: string
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
 * priors must be null so the first lift is a PR (not `undefined > n` → false).
 */
export function normalizePriorVolume(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Local volume-PR hint for open sessions (server recomputes on finish).
 * Matches grind_recompute_stats: volume > coalesce(prior_best, -1).
 * Null / undefined / non-numeric prior ⇒ first lift is a PR.
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
  return weight * reps > (prior ?? -1)
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
