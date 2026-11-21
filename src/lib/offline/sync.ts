import type { SupabaseClient } from '@supabase/supabase-js'
import { flushQueuedOps, getQueuedOps, isTransientError, type FlushResult, type QueuedOp } from '@/lib/utils/offlineQueue'
import { completeSession, type CompleteSessionOutcome } from '@/lib/utils/completeSession'
import { markAppDataStale } from '@/lib/cache/appDataCache'
import { browserIsOffline } from './offlineGate'
import { lastKnownUserId, resolveSessionAlias } from './localSession'
import {
  changeWorkoutStore, legacyKeys, readWorkoutStore, refreshWorkoutStore, type FinishIntent,
} from './workoutStore'

const emptyResult = (): FlushResult => ({ synced: [], rejected: [] })
const locks = new Map<string, Promise<unknown>>()

/** All commands that send durable edits share the account lock across tabs. */
export async function withWorkoutLock<T>(owner: string, work: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request('grind-workout:' + owner, work)
  const run = (locks.get(owner) ?? Promise.resolve()).catch(() => {}).then(work)
  locks.set(owner, run)
  return run.finally(() => { if (locks.get(owner) === run) locks.delete(owner) })
}

export async function authenticatedWorkoutOwner(supabase: SupabaseClient) {
  if (browserIsOffline()) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

function reason(error: unknown): string {
  return (error as { message?: string } | null)?.message || 'Cloud refused this change'
}

async function syncUnderLock(sessionId: string, supabase: SupabaseClient, owner: string): Promise<{
  sessionId: string
  result: FlushResult
  completion?: CompleteSessionOutcome
}> {
  await refreshWorkoutStore(owner)
  const sid = resolveSessionAlias(sessionId, owner)
  const empty = { sessionId: sid, result: emptyResult() }
  const state = readWorkoutStore(owner)
  if (state.discarded.includes(sid) || state.discarding.includes(sid)) return empty
  if (await authenticatedWorkoutOwner(supabase) !== owner) return empty

  const draft = state.drafts.find(entry => entry.id === sid)
  if (draft) {
    if (draft.rejected) return empty
    await changeWorkoutStore(owner, current => {
      const pending = current.drafts.find(entry => entry.id === sid)
      if (pending) pending.attempted = true
    })
    const { data, error } = await supabase.rpc('materialize_workout_draft', {
      p_owner: owner, p_session_id: sid, p_day: draft.day, p_started_at: draft.startedAt,
    })
    if (error || data !== true) {
      if (!error || !isTransientError(error)) {
        await changeWorkoutStore(owner, current => {
          const pending = current.drafts.find(entry => entry.id === sid)
          if (pending) pending.rejected = reason(error)
        })
      }
      return empty
    }
    if (await authenticatedWorkoutOwner(supabase) !== owner) return empty
    const { error: badgeError } = await supabase.rpc('mark_session_started_offline', { p_session_id: sid })
    if (badgeError && isTransientError(badgeError)) return empty
    await changeWorkoutStore(owner, current => { current.drafts = current.drafts.filter(entry => entry.id !== sid) })
  }

  const result = await flushQueuedOps(sid, supabase, owner)
  await refreshWorkoutStore(owner)
  if (await authenticatedWorkoutOwner(supabase) !== owner) return { sessionId: sid, result }

  const note = readWorkoutStore(owner).notes[sid]
  if (note && !note.rejected) {
    const { data, error } = await supabase.from('sessions').update({ note: note.text || null })
      .eq('id', sid).eq('user_id', owner).is('completed_at', null).select('id').maybeSingle()
    if (await authenticatedWorkoutOwner(supabase) !== owner || (error && isTransientError(error))) {
      return { sessionId: sid, result }
    }
    await changeWorkoutStore(owner, current => {
      if (current.notes[sid]?.revision !== note.revision) return
      if (!error && data) {
        if (current.resume[sid]) current.resume[sid].note = note.text || null
        delete current.notes[sid]
      }
      else current.notes[sid].rejected = reason(error)
    })
  }

  const intent = readWorkoutStore(owner).finishes[sid]
  if (!intent || intent.rejected || getQueuedOps(sid, owner).length > 0 || readWorkoutStore(owner).notes[sid]) {
    return { sessionId: sid, result }
  }
  if (await authenticatedWorkoutOwner(supabase) !== owner) return { sessionId: sid, result }

  const completion = await completeSession(supabase, {
    userId: owner, sessionId: sid, dayType: intent.day, note: intent.note,
    startHour: intent.startHour, intent,
  })
  if (completion.ok || !isTransientError(completion.error)) {
    await changeWorkoutStore(owner, current => {
      if (current.finishes[sid]?.id !== intent.id) return
      if (completion.ok) {
        delete current.finishes[sid]
        delete current.resume[sid]
      }
      else current.finishes[sid].rejected = reason(completion.error)
    })
  }
  if (completion.ok) {
    markAppDataStale()
    window.dispatchEvent(new CustomEvent('grind:workout-complete', { detail: sid }))
  }
  return { sessionId: sid, result, completion }
}

export async function syncSessionNow(sessionId: string, supabase: SupabaseClient, owner?: string) {
  const active = owner ?? await authenticatedWorkoutOwner(supabase)
  if (!active || browserIsOffline()) return { sessionId, result: emptyResult(), completion: undefined }
  return withWorkoutLock(active, () => syncUnderLock(sessionId, supabase, active))
}

function readySessions(owner: string) {
  const state = readWorkoutStore(owner)
  return [...new Set([
    ...state.ops.filter(op => !op.rejected).map(op => op.sessionId),
    ...Object.keys(state.notes).filter(id => !state.notes[id].rejected),
    ...Object.keys(state.finishes).filter(id => !state.finishes[id].rejected &&
      !state.ops.some(op => op.sessionId === id && op.rejected) && !state.notes[id]?.rejected),
  ])].filter(id => !state.discarding.includes(id) && !state.drafts.some(draft => draft.id === id && draft.rejected))
}

async function recoverLegacyServerEdits(supabase: SupabaseClient, owner: string) {
  if (readWorkoutStore(owner).legacyScanned) return
  const parsed: unknown = JSON.parse(localStorage.getItem(legacyKeys[2]) ?? '[]')
  const edits = Array.isArray(parsed) ? (parsed as QueuedOp[]).filter(op =>
    op && op.sessionId && (op.kind === 'upsert' || op.kind === 'delete')) : []
  const ids = [...new Set(edits.map(op => op.sessionId))]
  const owned = new Map<string, boolean>()
  for (let index = 0; index < ids.length; index += 100) {
    if (await authenticatedWorkoutOwner(supabase) !== owner) return
    const { data, error } = await supabase.from('sessions').select('id,completed_at')
      .eq('user_id', owner).in('id', ids.slice(index, index + 100))
    if (error) return
    for (const session of data ?? []) owned.set(session.id, !!session.completed_at)
  }
  if (await authenticatedWorkoutOwner(supabase) !== owner) return
  await changeWorkoutStore(owner, state => {
    if (state.legacyScanned) return
    for (const op of edits) {
      if (!owned.has(op.sessionId) || state.discarded.includes(op.sessionId) ||
        state.ops.some(q => q.sessionId === op.sessionId && q.exerciseId === op.exerciseId && q.setNumber === op.setNumber)) continue
      state.ops.push({ ...op, revision: crypto.randomUUID(),
        rejected: owned.get(op.sessionId) ? 'This edit belongs to a completed workout' : undefined })
    }
    state.legacyScanned = true
  })
}

export async function syncAllPending(supabase: SupabaseClient): Promise<boolean> {
  const owner = await authenticatedWorkoutOwner(supabase)
  if (!owner) return false
  await refreshWorkoutStore(owner)
  await withWorkoutLock(owner, () => recoverLegacyServerEdits(supabase, owner))
  for (const id of readySessions(owner)) {
    if (await authenticatedWorkoutOwner(supabase) !== owner) return false
    await syncSessionNow(id, supabase, owner)
  }
  return readySessions(owner).length > 0
}

export function hasUnsyncedWork(): boolean {
  const owner = lastKnownUserId()
  return owner !== null && readySessions(owner).length > 0
}

export async function saveWorkoutNote(owner: string, sessionId: string, text: string) {
  await changeWorkoutStore(owner, state => {
    const sid = state.aliases[sessionId] ?? sessionId
    if (state.discarded.includes(sid) || state.discarding.includes(sid) || state.finishes[sid]) {
      throw new Error('This workout is closing')
    }
    state.notes[sid] = { text, revision: crypto.randomUUID() }
  })
}

export async function requestWorkoutFinish(owner: string, sessionId: string, args: Omit<FinishIntent, 'id' | 'rejected'>) {
  await changeWorkoutStore(owner, state => {
    const sid = state.aliases[sessionId] ?? sessionId
    if (state.discarded.includes(sid) || state.discarding.includes(sid)) throw new Error('This workout is closing')
    if (!state.finishes[sid] || state.finishes[sid].rejected) {
      state.finishes[sid] = { ...args, id: crypto.randomUUID() }
    }
  })
}

export async function reopenWorkoutDraft(owner: string, sessionId: string) {
  await withWorkoutLock(owner, () => changeWorkoutStore(owner, state => {
    delete state.finishes[resolveSessionAlias(sessionId, owner)]
    const draft = state.drafts.find(entry => entry.id === sessionId)
    if (draft) delete draft.rejected
  }))
}

export async function finishWorkout(
  supabase: SupabaseClient, owner: string, sessionId: string, day: string, startedAt: Date,
) {
  await refreshWorkoutStore(owner)
  const sid = resolveSessionAlias(sessionId, owner)
  await requestWorkoutFinish(owner, sid, {
    day, note: readWorkoutStore(owner).notes[sid]?.text ?? null,
    startHour: startedAt.getHours(), offsetMinutes: -startedAt.getTimezoneOffset(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  return (await syncSessionNow(sid, supabase, owner)).completion
}
