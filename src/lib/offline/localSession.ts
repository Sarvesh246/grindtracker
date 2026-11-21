import { changeWorkoutStore, readWorkoutStore, type PendingLocalSession } from './workoutStore'

const SNAPSHOT_KEY = 'grind_workout_snapshot_v1'
const USER_KEY = 'grind_last_user_v1'
const LOG_CATALOG_KEY = 'grind_log_catalog_v1'

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

export type { PendingLocalSession } from './workoutStore'

export function getPendingLocalSessions(owner = lastKnownUserId()): PendingLocalSession[] {
  return readWorkoutStore(owner).drafts
}

export function hasPendingLocalSession(): boolean {
  return typeof window !== 'undefined' && getPendingLocalSessions().length > 0
}

export function getPendingLocalSessionById(id: string | null | undefined): PendingLocalSession | null {
  return getPendingLocalSessions().find(p => p.id === id) ?? null
}

export async function ensurePendingLocalSession(day: string, userId: string): Promise<PendingLocalSession> {
  return changeWorkoutStore(userId, state => {
    const existing = state.drafts.find(p => p.day === day)
    if (existing) return existing
    const created = { id: crypto.randomUUID(), day, startedAt: new Date().toISOString(), userId }
    state.drafts.push(created)
    return created
  })
}

export function isPendingLocalSessionId(sessionId: string | null | undefined): boolean {
  return getPendingLocalSessionById(sessionId) !== null
}

export function resolveSessionAlias(sessionId: string, owner = lastKnownUserId()): string {
  const aliases = readWorkoutStore(owner).aliases
  return Object.hasOwn(aliases, sessionId) ? aliases[sessionId] : sessionId
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
  if (!userId || snap.userId !== userId) return null
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
