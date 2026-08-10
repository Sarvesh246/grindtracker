import { SupabaseClient } from '@supabase/supabase-js'

const STORAGE_KEY = 'grind_offline_set_queue_v1'

export interface QueuedSetLog {
  sessionId: string
  exerciseId: string
  setNumber: number
  weight: number | null
  reps: number | null
  isPR: boolean
  isWarmup: boolean
  note: string | null
  queuedAt: number
}

function readQueue(): QueuedSetLog[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(queue: QueuedSetLog[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // ignore — private mode / storage full; the set stays checked locally
    // for this session even if it can't be queued for a later retry.
  }
}

/**
 * Persist a set log that failed to reach Supabase (after runWithRetry's own
 * attempts) so it survives closing the app, and can be replayed once the
 * connection comes back — instead of the set silently reverting to
 * unchecked/unsaved the moment the user navigates away.
 */
export function queueSetLog(entry: QueuedSetLog) {
  const queue = readQueue().filter(
    q => !(q.sessionId === entry.sessionId && q.exerciseId === entry.exerciseId && q.setNumber === entry.setNumber),
  )
  queue.push(entry)
  writeQueue(queue)
}

export function removeQueuedSetLog(sessionId: string, exerciseId: string, setNumber: number) {
  writeQueue(
    readQueue().filter(
      q => !(q.sessionId === sessionId && q.exerciseId === exerciseId && q.setNumber === setNumber),
    ),
  )
}

export function getQueuedSetLogs(sessionId: string): QueuedSetLog[] {
  return readQueue().filter(q => q.sessionId === sessionId)
}

/**
 * Replay every queued write for a session. Returns the ones that synced
 * successfully (by exerciseId-setNumber key) so the caller can clear their
 * local "pending sync" indicator.
 */
export async function flushQueuedSetLogs(
  sessionId: string,
  supabase: SupabaseClient,
): Promise<{ exerciseId: string; setNumber: number }[]> {
  const pending = getQueuedSetLogs(sessionId)
  const synced: { exerciseId: string; setNumber: number }[] = []
  for (const entry of pending) {
    const { error } = await supabase.from('session_logs').upsert(
      {
        session_id: entry.sessionId,
        exercise_id: entry.exerciseId,
        set_number: entry.setNumber,
        weight: entry.weight,
        reps: entry.reps,
        is_pr: entry.isPR,
        is_warmup: entry.isWarmup,
        note: entry.note,
        is_skipped: false,
      },
      { onConflict: 'session_id,exercise_id,set_number' },
    )
    if (!error) {
      removeQueuedSetLog(entry.sessionId, entry.exerciseId, entry.setNumber)
      synced.push({ exerciseId: entry.exerciseId, setNumber: entry.setNumber })
    }
  }
  return synced
}
