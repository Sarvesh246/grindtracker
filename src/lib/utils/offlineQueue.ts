import { SupabaseClient } from '@supabase/supabase-js'

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
 * Replay every queued op for a session, oldest first. Returns the slots that
 * synced successfully so the caller can clear their local "pending sync"
 * indicator. Always writes is_pr: false — server recomputes on finish.
 */
export async function flushQueuedOps(
  sessionId: string,
  supabase: SupabaseClient,
): Promise<{ exerciseId: string; setNumber: number }[]> {
  const pending = getQueuedOps(sessionId).sort((a, b) => a.queuedAt - b.queuedAt)
  const synced: { exerciseId: string; setNumber: number }[] = []
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
    }
  }
  return synced
}
