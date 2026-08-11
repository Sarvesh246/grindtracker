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
 * Local volume-PR hint for open sessions (server recomputes on finish).
 * Null prior best ⇒ first lift is a PR (matches grind_recompute_stats).
 */
export function computeLocalIsPR(
  isWarmup: boolean,
  weight: number | null,
  reps: number,
  prevBestVolume: number | null,
): boolean {
  return (
    !isWarmup &&
    weight !== null &&
    (prevBestVolume === null || weight * reps > prevBestVolume)
  )
}

export function parseRpe(raw: string): number | null {
  if (!raw || raw.trim() === '') return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1 || n > 10) return null
  return n
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
