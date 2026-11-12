import { SupabaseClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/utils/reportError'
import { resolveSessionAlias } from '@/lib/offline/localSession'

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
/** Fired whenever a write is queued, so the background sync agent can wake up. */
export const QUEUED_EVENT = 'grind:queued'
/** Fired after a flush settles or rejects sets, so an open workout can update its badges. */
export const FLUSHED_EVENT = 'grind:queue-flushed'

export function queueOp(op: QueuedOp) {
  // A handler that began before a local→server session swap may still carry the
  // old id; resolve it so the write lands on the real session.
  const sessionId = resolveSessionAlias(op.sessionId)
  const resolved = sessionId === op.sessionId ? op : { ...op, sessionId }
  const queue = readQueue().filter(q => !sameSlot(q, resolved))
  queue.push(resolved)
  writeQueue(queue)
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent(QUEUED_EVENT))
  }
}

export function removeQueuedOp(sessionId: string, exerciseId: string, setNumber: number) {
  const sid = resolveSessionAlias(sessionId)
  writeQueue(readQueue().filter(q => !sameSlot(q, { sessionId: sid, exerciseId, setNumber, queuedAt: 0 })))
}

export function clearQueuedOpsForSession(sessionId: string) {
  const sid = resolveSessionAlias(sessionId)
  writeQueue(readQueue().filter(q => q.sessionId !== sid))
}

export function clearQueuedOpsForExercise(sessionId: string, exerciseId: string) {
  const sid = resolveSessionAlias(sessionId)
  writeQueue(readQueue().filter(q => !(q.sessionId === sid && q.exerciseId === exerciseId)))
}

export function getQueuedOps(sessionId: string): QueuedOp[] {
  const sid = resolveSessionAlias(sessionId)
  return readQueue().filter(q => q.sessionId === sid)
}

/** Every session that currently has unsynced writes (any user, any age). */
export function getQueuedSessionIds(): string[] {
  return [...new Set(readQueue().map(q => q.sessionId))]
}

/**
 * Re-point every queued op from one session id to another — used when a
 * workout started offline under a locally minted id gets its real server
 * session. If the target already has an op for the same slot, the newer wins.
 */
export function remapQueuedSession(fromSessionId: string, toSessionId: string) {
  if (fromSessionId === toSessionId) return
  const moved = readQueue().map(q => (q.sessionId === fromSessionId ? { ...q, sessionId: toSessionId } : q))
  const bySlot = new Map<string, QueuedOp>()
  for (const q of moved) {
    const key = `${q.sessionId}|${q.exerciseId}|${q.setNumber}`
    const prev = bySlot.get(key)
    if (!prev || prev.queuedAt <= q.queuedAt) bySlot.set(key, q)
  }
  writeQueue([...bySlot.values()])
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

/** How long one sync request may hang before it counts as a dead connection. */
export const SYNC_REQUEST_TIMEOUT_MS = 12_000

/**
 * Race a request against a timer. A request that never answers (the usual
 * failure on a congested cell tower) must not leave the UI — or the next
 * retry — waiting forever. The abandoned request may still land later; every
 * write here is idempotent, so that is harmless.
 */
export function withRequestTimeout<T extends { error: unknown }>(
  request: PromiseLike<T>,
  ms = SYNC_REQUEST_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>(resolve => {
    const timer = setTimeout(() => resolve({ error: new TypeError('request timed out') } as T), ms)
    Promise.resolve(request).then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      err => {
        clearTimeout(timer)
        resolve({ error: err } as T)
      },
    )
  })
}

type SlotRef = { exerciseId: string; setNumber: number }
export type FlushResult = { synced: SlotRef[]; rejected: SlotRef[] }

const inFlight = new Map<string, Promise<FlushResult>>()

/**
 * Replay every queued op for a session. Returns the slots that synced
 * successfully so the caller can clear their local "pending sync" indicator,
 * and the slots the server permanently refused (dropped from the queue and
 * reported) so the caller can un-check them.
 * Always writes is_pr: false — server recomputes on finish.
 *
 * Built to be gentle on a bad connection (and on whatever else the phone is
 * streaming over it):
 *  - one flush per session at a time — the mount, `online`, retry button and
 *    finish paths all share a single in-flight run instead of stacking requests;
 *  - all upserts go out as ONE bulk request, deletes one per exercise, instead
 *    of a request per set;
 *  - the first transient failure ends the run — no point sending the rest down
 *    a dead link — and each request has a timeout;
 *  - nothing is attempted at all while the browser reports it is offline.
 */
export function flushQueuedOps(sessionId: string, supabase: SupabaseClient): Promise<FlushResult> {
  const sid = resolveSessionAlias(sessionId)
  const running = inFlight.get(sid)
  if (running) return running
  const run = doFlush(sid, supabase)
    .then(result => {
      if (
        (result.synced.length > 0 || result.rejected.length > 0) &&
        typeof window !== 'undefined' &&
        typeof window.dispatchEvent === 'function' &&
        typeof CustomEvent === 'function'
      ) {
        window.dispatchEvent(new CustomEvent(FLUSHED_EVENT, { detail: { sessionId: sid, result } }))
      }
      return result
    })
    .finally(() => {
      inFlight.delete(sid)
    })
  inFlight.set(sid, run)
  return run
}

async function doFlush(sessionId: string, supabase: SupabaseClient): Promise<FlushResult> {
  const synced: SlotRef[] = []
  const rejected: SlotRef[] = []
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { synced, rejected }

  const pending = getQueuedOps(sessionId).sort((a, b) => a.queuedAt - b.queuedAt)
  if (pending.length === 0) return { synced, rejected }

  /** Drop a queue entry only if it is still the op we just sent (a newer edit may have replaced it). */
  const settle = (op: QueuedOp, outcome: 'synced' | 'rejected') => {
    const latest = readQueue().find(q => sameSlot(q, op))
    if (latest && latest.queuedAt !== op.queuedAt) return
    removeQueuedOp(op.sessionId, op.exerciseId, op.setNumber)
    ;(outcome === 'synced' ? synced : rejected).push({ exerciseId: op.exerciseId, setNumber: op.setNumber })
  }

  const reject = (op: QueuedOp, error: { message?: string; code?: string }) => {
    reportError(new Error(`Queued set rejected: ${error.message ?? 'unknown'}`), {
      operation: 'flushQueuedOps',
      route: '/log',
      extra: { code: error.code, kind: op.kind },
    })
    settle(op, 'rejected')
  }

  const upsertRow = (op: Extract<QueuedOp, { kind: 'upsert' }>) => ({
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
  })
  const conflict = { onConflict: 'session_id,exercise_id,set_number' }

  // Upserts first (in queue order inside the batch), then deletes — the same
  // slot never appears twice, so the relative order of the two kinds is moot.
  const upserts = pending.filter((op): op is Extract<QueuedOp, { kind: 'upsert' }> => op.kind === 'upsert')
  const deletes = pending.filter(op => op.kind === 'delete')

  if (upserts.length > 0) {
    const batch = await withRequestTimeout(
      supabase.from('session_logs').upsert(upserts.map(upsertRow), conflict),
    )
    if (!batch.error) {
      for (const op of upserts) settle(op, 'synced')
    } else if (isTransientError(batch.error)) {
      return { synced, rejected }
    } else if (upserts.length === 1) {
      reject(upserts[0], batch.error)
    } else {
      // The server refused the batch: find the offending row(s) one by one so
      // the good sets still save.
      for (const op of upserts) {
        const { error } = await withRequestTimeout(
          supabase.from('session_logs').upsert(upsertRow(op), conflict),
        )
        if (!error) settle(op, 'synced')
        else if (isTransientError(error)) return { synced, rejected }
        else reject(op, error)
      }
    }
  }

  const byExercise = new Map<string, QueuedOp[]>()
  for (const op of deletes) byExercise.set(op.exerciseId, [...(byExercise.get(op.exerciseId) ?? []), op])
  for (const [exerciseId, ops] of byExercise) {
    const { error } = await withRequestTimeout(
      supabase
        .from('session_logs')
        .delete()
        .eq('session_id', sessionId)
        .eq('exercise_id', exerciseId)
        .in('set_number', ops.map(o => o.setNumber)),
    )
    if (!error) {
      for (const op of ops) settle(op, 'synced')
    } else if (isTransientError(error)) {
      return { synced, rejected }
    } else {
      for (const op of ops) reject(op, error)
    }
  }

  return { synced, rejected }
}
