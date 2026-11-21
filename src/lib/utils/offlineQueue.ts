import { SupabaseClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/utils/reportError'
import { lastKnownUserId, resolveSessionAlias } from '@/lib/offline/localSession'
import { changeWorkoutStore, readWorkoutStore } from '@/lib/offline/workoutStore'

interface QueuedOpBase {
  sessionId: string
  exerciseId: string
  setNumber: number
  queuedAt: number
  revision?: string
  rejected?: string
  performedAt?: string
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

function sameSlot(a: QueuedOpBase, b: Pick<QueuedOpBase, 'sessionId' | 'exerciseId' | 'setNumber'>) {
  return a.sessionId === b.sessionId && a.exerciseId === b.exerciseId && a.setNumber === b.setNumber
}

export const QUEUED_EVENT = 'grind:queued'
export const FLUSHED_EVENT = 'grind:queue-flushed'

export function queueOp(op: QueuedOp, owner = lastKnownUserId()) {
  return queueWorkoutOps([op], owner)
}

export async function queueWorkoutOps(ops: QueuedOp[], owner = lastKnownUserId()) {
  if (!owner) throw new Error('Cannot save workout without an account')
  await changeWorkoutStore(owner, state => {
    for (const op of ops) {
      const sessionId = state.aliases[op.sessionId] ?? op.sessionId
      if (state.discarded.includes(sessionId) || state.discarding.includes(sessionId) || state.finishes[sessionId]) {
        throw new Error('This workout is closing')
      }
      const next = { ...op, sessionId, revision: crypto.randomUUID() }
      const previous = state.ops.find(q => sameSlot(q, next))
      if (next.kind === 'upsert' && previous?.kind === 'upsert' && !previous.isSkipped) {
        next.performedAt = previous.performedAt ?? new Date(previous.queuedAt).toISOString()
      }
      state.ops = state.ops.filter(q => !sameSlot(q, next))
      state.ops.push(next)
    }
  })
  window.dispatchEvent(new CustomEvent(QUEUED_EVENT))
}

export async function removeQueuedOp(
  sessionId: string, exerciseId: string, setNumber: number, owner = lastKnownUserId(), revision?: string,
) {
  if (!owner) return
  const sid = resolveSessionAlias(sessionId, owner)
  const queued = getQueuedOps(sid, owner).find(q =>
    sameSlot(q, { sessionId: sid, exerciseId, setNumber }) && (!revision || q.revision === revision))
  if (queued) await changeWorkoutStore(owner, state => {
    state.ops = state.ops.filter(q => q.revision !== queued.revision)
  })
}

export async function clearQueuedOpsForExercise(sessionId: string, exerciseId: string, owner = lastKnownUserId()) {
  if (!owner) return
  await changeWorkoutStore(owner, state => {
    const sid = state.aliases[sessionId] ?? sessionId
    state.ops = state.ops.filter(q => !(q.sessionId === sid && q.exerciseId === exerciseId))
  })
}

export function getQueuedOps(sessionId: string, owner = lastKnownUserId()): QueuedOp[] {
  const sid = resolveSessionAlias(sessionId, owner)
  return readWorkoutStore(owner).ops.filter(q => q.sessionId === sid)
}

export function getQueuedSessionIds(owner: string): string[] {
  return [...new Set(readWorkoutStore(owner).ops.map(q => q.sessionId))]
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

export async function flushQueuedOps(sessionId: string, supabase: SupabaseClient, owner: string): Promise<FlushResult> {
  const result = await doFlush(sessionId, supabase, owner)
  if (result.synced.length > 0 || result.rejected.length > 0) {
    window.dispatchEvent(new CustomEvent(FLUSHED_EVENT, { detail: { sessionId, result } }))
  }
  return result
}

async function doFlush(sessionId: string, supabase: SupabaseClient, owner: string): Promise<FlushResult> {
  const synced: SlotRef[] = []
  const rejected: SlotRef[] = []
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { synced, rejected }

  const pending = getQueuedOps(sessionId, owner).filter(op => !op.rejected).sort((a, b) => a.queuedAt - b.queuedAt)
  if (pending.length === 0) return { synced, rejected }

  async function settle(op: QueuedOp, reason?: string) {
    const changed = await changeWorkoutStore(owner, state => {
      const index = state.ops.findIndex(q => q.revision === op.revision)
      if (index < 0) return false
      if (reason) state.ops[index] = { ...op, rejected: reason }
      else {
        state.ops.splice(index, 1)
        const snapshot = state.resume[op.sessionId]
        if (snapshot) {
          const match = snapshot.logs.findIndex(row => row.exercise_id === op.exerciseId && row.set_number === op.setNumber)
          if (op.kind === 'delete') {
            if (match >= 0) snapshot.logs.splice(match, 1)
          } else {
            const row = {
              id: match >= 0 ? snapshot.logs[match].id : '',
              exercise_id: op.exerciseId, set_number: op.setNumber, weight: op.weight,
              reps: op.reps, is_pr: op.isPR, is_warmup: op.isWarmup, note: op.note,
              is_skipped: op.isSkipped, rpe: op.rpe,
            }
            if (match >= 0) snapshot.logs[match] = row
            else snapshot.logs.push(row)
          }
        }
      }
      return true
    })
    if (changed) (reason ? rejected : synced).push({ exerciseId: op.exerciseId, setNumber: op.setNumber })
  }

  async function reject(op: QueuedOp, error: { message?: string; code?: string }) {
    const reason = error.message || 'Cloud refused this edit'
    reportError(new Error(reason), {
      operation: 'flushQueuedOps',
      route: '/log',
      extra: { code: error.code, kind: op.kind },
    })
    await settle(op, reason)
  }

  async function isOwner() {
    const { data } = await supabase.auth.getSession()
    return data.session?.user.id === owner
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
    performed_at: op.performedAt ?? new Date(op.queuedAt).toISOString(),
  })
  const conflict = { onConflict: 'session_id,exercise_id,set_number' }

  // Upserts first (in queue order inside the batch), then deletes — the same
  // slot never appears twice, so the relative order of the two kinds is moot.
  const upserts = pending.filter((op): op is Extract<QueuedOp, { kind: 'upsert' }> => op.kind === 'upsert')
  const deletes = pending.filter(op => op.kind === 'delete')

  if (upserts.length > 0) {
    if (!await isOwner()) return { synced, rejected }
    const batch = await withRequestTimeout(
      supabase.from('session_logs').upsert(upserts.map(upsertRow), conflict),
    )
    if (!await isOwner()) return { synced, rejected }
    if (!batch.error) {
      for (const op of upserts) await settle(op)
    } else if (isTransientError(batch.error)) {
      return { synced, rejected }
    } else if (upserts.length === 1) {
      await reject(upserts[0], batch.error)
    } else {
      // The server refused the batch: find the offending row(s) one by one so
      // the good sets still save.
      for (const op of upserts) {
        if (!await isOwner()) return { synced, rejected }
        const { error } = await withRequestTimeout(
          supabase.from('session_logs').upsert(upsertRow(op), conflict),
        )
        if (!await isOwner()) return { synced, rejected }
        if (!error) await settle(op)
        else if (isTransientError(error)) return { synced, rejected }
        else await reject(op, error)
      }
    }
  }

  const byExercise = new Map<string, QueuedOp[]>()
  for (const op of deletes) byExercise.set(op.exerciseId, [...(byExercise.get(op.exerciseId) ?? []), op])
  for (const [exerciseId, ops] of byExercise) {
    if (!await isOwner()) return { synced, rejected }
    const { error } = await withRequestTimeout(
      supabase
        .from('session_logs')
        .delete()
        .eq('session_id', sessionId)
        .eq('exercise_id', exerciseId)
        .in('set_number', ops.map(o => o.setNumber)),
    )
    if (!await isOwner()) return { synced, rejected }
    if (!error) {
      for (const op of ops) await settle(op)
    } else if (isTransientError(error)) {
      return { synced, rejected }
    } else {
      for (const op of ops) await reject(op, error)
    }
  }

  return { synced, rejected }
}
