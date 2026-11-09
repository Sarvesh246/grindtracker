import { SupabaseClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/utils/reportError'

const STORAGE_KEY = 'grind_offline_set_queue_v2'

interface QueuedOpBase {
  sessionId: string
  exerciseId: string
  setNumber: number
  queuedAt: number
}

export type QueuedOp =
  | (QueuedOpBase & {
      kind: 'upsert'
      weight: number | null
      reps: number | null
      isPR: boolean
      isWarmup: boolean
      note: string | null
      isSkipped: boolean
      /** Optional RPE 1–10; omitted/undefined on older queued ops. */
      rpe?: number | null
    })
  | (QueuedOpBase & { kind: 'delete' })

function readQueue(): QueuedOp[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(queue: QueuedOp[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // ignore — private mode / storage full; the change stays applied locally
    // for this session even if it can't be queued for a later retry.
  }
}

function sameSlot(a: QueuedOpBase, b: QueuedOpBase) {
  return a.sessionId === b.sessionId && a.exerciseId === b.exerciseId && a.setNumber === b.setNumber
}

/**
 * Persist a write that failed to reach Supabase (after the caller's own
 * retries) so it survives closing the app, and can be replayed once the
 * connection comes back. Only one op per (session, exercise, set) slot is kept.
 */
export function queueOp(op: QueuedOp) {
  const queue = readQueue().filter(q => !sameSlot(q, op))
  queue.push(op)
  writeQueue(queue)
}

export function removeQueuedOp(sessionId: string, exerciseId: string, setNumber: number) {
  writeQueue(readQueue().filter(q => !sameSlot(q, { sessionId, exerciseId, setNumber, queuedAt: 0 })))
}

export function clearQueuedOpsForSession(sessionId: string) {
  writeQueue(readQueue().filter(q => q.sessionId !== sessionId))
}

export function clearQueuedOpsForExercise(sessionId: string, exerciseId: string) {
  writeQueue(readQueue().filter(q => !(q.sessionId === sessionId && q.exerciseId === exerciseId)))
}

export function getQueuedOps(sessionId: string): QueuedOp[] {
  return readQueue().filter(q => q.sessionId === sessionId)
}

/**
 * Server-side sanity bounds on a logged set. These mirror the
 * `session_logs_weight_sane` / `session_logs_reps_sane` CHECK constraints in
 * `docs/sql/10-leaderboard-authz.sql` (weight 0–2000 lb canonical, reps 0–1000).
 * Anything outside them can never be saved, so reject it before it is queued.
 */
export const MAX_SET_WEIGHT_LBS = 2000
export const MAX_SET_REPS = 1000

/**
 * Is this a failure that may succeed if tried again later (network blip,
 * server hiccup, expired token)? Anything else — a CHECK violation, an RLS
 * denial, a guard trigger — is permanent: the server has understood the write
 * and refused it, so queueing it would block Finish forever.
 *
 * postgrest-js reports failures as `{ message, details, hint, code }`; a
 * failed fetch comes back with an empty `code`. The HTTP status lives on the
 * response, but is honoured here if a caller attaches it.
 */
export function isTransientError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return true
  const e = error as { name?: unknown; code?: unknown; status?: unknown; message?: unknown }
  if (error instanceof TypeError || e.name === 'TypeError' || e.name === 'AbortError') return true
  if (typeof e.status === 'number') {
    if (e.status === 408 || e.status === 429 || e.status >= 500) return true
  }
  const code = typeof e.code === 'string' ? e.code : ''
  if (code === '') return true
  // JWT expired: the client refreshes the token, so a retry can succeed.
  if (code === 'PGRST301' || code === 'PGRST303') return true
  if (typeof e.message === 'string' && /jwt expired/i.test(e.message)) return true
  // PostgREST could not reach / get a connection from the database.
  if (/^PGRST00[0-3]$/.test(code)) return true
  return false
}

/**
 * Replay every queued op for a session, oldest first. Returns the slots that
 * synced successfully so the caller can clear their local "pending sync"
 * indicator, and the slots the server permanently refused (dropped from the
 * queue and reported) so the caller can un-check them.
 * Always writes is_pr: false — server recomputes on finish.
 */
export async function flushQueuedOps(
  sessionId: string,
  supabase: SupabaseClient,
): Promise<{
  synced: { exerciseId: string; setNumber: number }[]
  rejected: { exerciseId: string; setNumber: number }[]
}> {
  const pending = getQueuedOps(sessionId).sort((a, b) => a.queuedAt - b.queuedAt)
  const synced: { exerciseId: string; setNumber: number }[] = []
  const rejected: { exerciseId: string; setNumber: number }[] = []
  for (const op of pending) {
    const { error } =
      op.kind === 'upsert'
        ? await supabase.from('session_logs').upsert(
            {
              session_id: op.sessionId,
              exercise_id: op.exerciseId,
              set_number: op.setNumber,
              weight: op.weight,
              reps: op.reps,
              is_pr: false,
              is_warmup: op.isWarmup,
              note: op.note,
              is_skipped: op.isSkipped,
              rpe: op.rpe ?? null,
            },
            { onConflict: 'session_id,exercise_id,set_number' },
          )
        : await supabase
            .from('session_logs')
            .delete()
            .eq('session_id', op.sessionId)
            .eq('exercise_id', op.exerciseId)
            .eq('set_number', op.setNumber)
    if (!error) {
      const latest = readQueue().find(q => sameSlot(q, op))
      // A newer edit may have replaced this slot while the upsert was in flight.
      // Only drop the queue entry if it is still the op we just synced.
      if (!latest || latest.queuedAt === op.queuedAt) {
        removeQueuedOp(op.sessionId, op.exerciseId, op.setNumber)
        synced.push({ exerciseId: op.exerciseId, setNumber: op.setNumber })
      }
    } else if (!isTransientError(error)) {
      const latest = readQueue().find(q => sameSlot(q, op))
      if (!latest || latest.queuedAt === op.queuedAt) {
        removeQueuedOp(op.sessionId, op.exerciseId, op.setNumber)
        reportError(new Error(`Queued set rejected: ${error.message ?? 'unknown'}`), {
          operation: 'flushQueuedOps',
          route: '/log',
          extra: { code: error.code, kind: op.kind },
        })
        rejected.push({ exerciseId: op.exerciseId, setNumber: op.setNumber })
      }
    }
  }
  return { synced, rejected }
}
