import type { SupabaseClient } from '@supabase/supabase-js'
import {
  flushQueuedOps,
  getQueuedSessionIds,
  remapQueuedSession,
  withRequestTimeout,
  type FlushResult,
} from '@/lib/utils/offlineQueue'
import {
  clearPendingLocalSession,
  getPendingLocalSessions,
  isActiveWorkoutScreenSession,
  isPendingLocalSessionId,
  recordSessionAlias,
  resolveSessionAlias,
  type PendingLocalSession,
} from './localSession'
import { browserIsOffline } from './offlineGate'

/** A locally created session received its real server id. detail: { from, to }. */
export const SESSION_REMAPPED_EVENT = 'grind:session-remapped'

let materializing: Promise<void> | null = null

async function materializeOne(supabase: SupabaseClient, pending: PendingLocalSession): Promise<void> {
  const { data, error } = await withRequestTimeout(
    Promise.resolve(supabase.rpc('start_or_resume_session', { p_day_type: pending.day })),
  )
  const session = (data as { session?: { id?: string; started_at?: string } } | null)?.session
  // Any failure (offline, timeout, auth) leaves the pending record alone: the
  // next sync attempt tries again, and nothing the user logged is lost.
  if (error || !session?.id) return
  await adoptServerSession(supabase, pending, { id: session.id, started_at: session.started_at })
}

/**
 * Point a locally created session at the server session that now stands in
 * for it: queued writes move over, the old id keeps resolving to the new one,
 * and the start time is restored.
 */
export async function adoptServerSession(
  supabase: SupabaseClient,
  pending: PendingLocalSession,
  session: { id: string; started_at?: string },
): Promise<void> {
  const serverId = session.id
  recordSessionAlias(pending.id, serverId)
  remapQueuedSession(pending.id, serverId)

  // The server stamps a brand-new session with "now"; put the real start time
  // back so duration and time-of-day badges reflect when they actually began.
  // Best effort — a resumed session that began earlier keeps its own start.
  const serverStart = Date.parse(session.started_at ?? '')
  const localStart = Date.parse(pending.startedAt)
  if (Number.isFinite(serverStart) && Number.isFinite(localStart) && localStart < serverStart - 5_000) {
    await withRequestTimeout(
      supabase.from('sessions').update({ started_at: pending.startedAt }).eq('id', serverId),
    )
  }

  // A mounted workout screen still holds the local id in its closures; it
  // clears the record itself once it has switched over, so writes in that gap
  // keep queueing instead of hitting the server with an id it has never seen.
  if (!isActiveWorkoutScreenSession(pending.id)) clearPendingLocalSession(pending.id)

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(SESSION_REMAPPED_EVENT, { detail: { from: pending.id, to: serverId } }),
    )
  }
}

/** Give every locally created session its server row. Safe to call concurrently. */
export function materializeLocalSessions(supabase: SupabaseClient): Promise<void> {
  if (materializing) return materializing
  if (browserIsOffline() || getPendingLocalSessions().length === 0) return Promise.resolve()
  materializing = (async () => {
    for (const pending of getPendingLocalSessions()) {
      // Already swapped for its server session (the screen that was holding the
      // local id has since gone away): just retire the record.
      if (resolveSessionAlias(pending.id) !== pending.id) {
        clearPendingLocalSession(pending.id)
        continue
      }
      // Started offline, nothing logged, screen gone: nothing worth creating a
      // server session for (same as opening a day and backing out).
      if (!isActiveWorkoutScreenSession(pending.id) && !getQueuedSessionIds().includes(pending.id)) {
        clearPendingLocalSession(pending.id)
        continue
      }
      await materializeOne(supabase, pending)
    }
  })().finally(() => {
    materializing = null
  })
  return materializing
}

/**
 * Sync one session now: create its server row first if it only exists locally,
 * then flush its queued writes. Returns the id to use from here on (it changes
 * when a local session is materialized).
 */
export async function syncSessionNow(
  sessionId: string,
  supabase: SupabaseClient,
): Promise<{ sessionId: string; result: FlushResult }> {
  await materializeLocalSessions(supabase)
  const sid = resolveSessionAlias(sessionId)
  if (isPendingLocalSessionId(sid)) return { sessionId: sid, result: { synced: [], rejected: [] } }
  return { sessionId: sid, result: await flushQueuedOps(sid, supabase) }
}

/**
 * Background pass over everything unsynced on this device, whether or not the
 * workout screen is open. Returns true while work remains.
 */
export async function syncAllPending(supabase: SupabaseClient): Promise<boolean> {
  if (browserIsOffline()) return hasUnsyncedWork()
  await materializeLocalSessions(supabase)
  for (const sid of getQueuedSessionIds()) {
    if (isPendingLocalSessionId(sid)) continue
    const result = await flushQueuedOps(sid, supabase)
    // Dead link: stop here rather than probing every remaining session.
    if (result.synced.length === 0 && result.rejected.length === 0 && getQueuedSessionIds().includes(sid)) {
      break
    }
  }
  return hasUnsyncedWork()
}

export function hasUnsyncedWork(): boolean {
  return getPendingLocalSessions().length > 0 || getQueuedSessionIds().length > 0
}
