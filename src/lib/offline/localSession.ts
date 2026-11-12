/**
 * Offline-first workout start.
 *
 * Starting a workout normally asks Postgres (`start_or_resume_session`) for a
 * session row. With no signal that call can't happen, so the client mints its
 * own session id, remembers it here (localStorage, so it survives closing the
 * app), and lets every set write go through the offline queue. When a
 * connection returns the sync layer asks the server for the real session,
 * re-points the queued writes at it, and drops this record.
 *
 * Everything here is synchronous localStorage work and imports nothing from
 * Supabase, so it is unit-testable in plain Node.
 */

const PENDING_KEY = 'grind_pending_sessions_v2'
const ALIAS_KEY = 'grind_session_alias_v1'
const SNAPSHOT_KEY = 'grind_workout_snapshot_v1'
const USER_KEY = 'grind_last_user_v1'
const LOG_CATALOG_KEY = 'grind_log_catalog_v1'

export interface PendingLocalSession {
  id: string
  day: string
  startedAt: string
  userId: string | null
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full / private mode — the app still works, just not across a restart.
  }
}

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ── Locally created sessions awaiting a server row ─────────────────────────

export function getPendingLocalSessions(): PendingLocalSession[] {
  const list = readJson<PendingLocalSession[]>(PENDING_KEY)
  return Array.isArray(list)
    ? list.filter(p => p && typeof p.id === 'string' && typeof p.day === 'string')
    : []
}

export function hasPendingLocalSession(): boolean {
  return typeof window !== 'undefined' && getPendingLocalSessions().length > 0
}

export function getPendingLocalSessionById(id: string | null | undefined): PendingLocalSession | null {
  if (!id) return null
  return getPendingLocalSessions().find(p => p.id === id) ?? null
}

/** The pending session for this day (same user), or a freshly minted one. */
export function ensurePendingLocalSession(day: string, userId: string | null): PendingLocalSession {
  const list = getPendingLocalSessions()
  const existing = list.find(
    p => p.day === day && (p.userId === userId || !p.userId || !userId),
  )
  if (existing) return existing
  const created: PendingLocalSession = {
    id: newId(),
    day,
    startedAt: new Date().toISOString(),
    userId,
  }
  writeJson(PENDING_KEY, [...list, created])
  return created
}

export function clearPendingLocalSession(id: string) {
  const rest = getPendingLocalSessions().filter(p => p.id !== id)
  if (rest.length === 0) {
    try {
      window.localStorage.removeItem(PENDING_KEY)
    } catch {
      /* ignore */
    }
  } else {
    writeJson(PENDING_KEY, rest)
  }
}

/** Is this id a session that only exists on this device so far? */
export function isPendingLocalSessionId(sessionId: string | null | undefined): boolean {
  return typeof window !== 'undefined' && getPendingLocalSessionById(sessionId) !== null
}

// ── Local id → server id aliases ────────────────────────────────────────────
// A handler that started before the swap may still hold the local id for a few
// milliseconds. The queue resolves it so such a write lands on the real session.

type AliasMap = Record<string, string>
const MAX_ALIASES = 20

export function recordSessionAlias(localId: string, serverId: string) {
  const map = readJson<AliasMap>(ALIAS_KEY) ?? {}
  map[localId] = serverId
  const keys = Object.keys(map)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ALIASES))) delete map[k]
  writeJson(ALIAS_KEY, map)
}

export function resolveSessionAlias(sessionId: string): string {
  if (typeof window === 'undefined') return sessionId
  const map = readJson<AliasMap>(ALIAS_KEY)
  return (map && map[sessionId]) || sessionId
}

// ── Which workout screen is mounted (so the swap can wait for it) ──────────

let activeScreenSessionId: string | null = null

export function setActiveWorkoutScreenSession(id: string | null) {
  activeScreenSessionId = id
}

export function getActiveWorkoutScreenSession(): string | null {
  return activeScreenSessionId
}

export function isActiveWorkoutScreenSession(id: string): boolean {
  return activeScreenSessionId === id
}

// ── Workout snapshot ────────────────────────────────────────────────────────
// What the Log screen needs to start a workout with no connection: the user's
// exercise catalog plus the "prev" / PR-bar numbers last seen for each lift.

export interface WorkoutSnapshot<E = unknown> {
  userId: string | null
  savedAt: number
  exercises: E[]
  bests: Record<string, number | null>
  bestVolumes: Record<string, number | null>
}

export function saveWorkoutSnapshot<E>(
  userId: string | null,
  exercises: E[],
  bests: Record<string, number | null>,
  bestVolumes: Record<string, number | null>,
) {
  const prev = readJson<WorkoutSnapshot<E>>(SNAPSHOT_KEY)
  // Bests are only fetched for the day being trained — keep the other days'
  // numbers from earlier snapshots (same user only).
  const sameUser = !!prev && prev.userId === userId
  const snapshot: WorkoutSnapshot<E> = {
    userId,
    savedAt: Date.now(),
    exercises,
    bests: { ...(sameUser ? prev.bests : {}), ...bests },
    bestVolumes: { ...(sameUser ? prev.bestVolumes : {}), ...bestVolumes },
  }
  writeJson(SNAPSHOT_KEY, snapshot)
}

export function readWorkoutSnapshot<E>(userId: string | null): WorkoutSnapshot<E> | null {
  const snap = readJson<WorkoutSnapshot<E>>(SNAPSHOT_KEY)
  if (!snap || !Array.isArray(snap.exercises)) return null
  if (userId && snap.userId && snap.userId !== userId) return null
  return snap
}

// ── Last known user ─────────────────────────────────────────────────────────
// `auth.getSession()` can fail offline once the access token has expired (it
// tries to refresh). The id is not a secret and only scopes local data.

export function rememberUserId(id: string) {
  try {
    window.localStorage.setItem(USER_KEY, id)
  } catch {
    /* ignore */
  }
}

export function lastKnownUserId(): string | null {
  try {
    return window.localStorage.getItem(USER_KEY)
  } catch {
    return null
  }
}

/**
 * Sign-out: drop the personal offline copies. The set queue and pending
 * sessions are deliberately kept — they are the user's unsynced workout data.
 */
export function clearOfflineWorkoutData() {
  try {
    window.localStorage.removeItem(SNAPSHOT_KEY)
    window.localStorage.removeItem(LOG_CATALOG_KEY)
    window.localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}

export const LOG_CATALOG_STORAGE_KEY = LOG_CATALOG_KEY
