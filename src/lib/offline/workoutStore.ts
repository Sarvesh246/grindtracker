import type { QueuedOp } from '@/lib/utils/offlineQueue'

export type PendingLocalSession = { id: string; day: string; startedAt: string; userId: string; attempted?: boolean; rejected?: string }
export type DraftNote = { text: string; revision: string; rejected?: string }
export type FinishIntent = {
  id: string
  day: string
  note: string | null
  startHour: number
  offsetMinutes: number
  timezone: string
  rejected?: string
}

export type SavedSet = {
  id: string
  exercise_id: string
  set_number: number
  weight: number | null
  reps: number | null
  is_pr: boolean
  is_warmup?: boolean
  note?: string | null
  is_skipped?: boolean
  rpe?: number | null
}

export type WorkoutResume = {
  id: string
  day: string
  startedAt: string
  note: string | null
  logs: SavedSet[]
}

export type WorkoutState = {
  migrated: boolean
  legacyScanned: boolean
  ops: QueuedOp[]
  drafts: PendingLocalSession[]
  aliases: Record<string, string>
  resume: Record<string, WorkoutResume>
  notes: Record<string, DraftNote>
  finishes: Record<string, FinishIntent>
  discarded: string[]
  discarding: string[]
}

const empty = (): WorkoutState => ({
  migrated: false, legacyScanned: false, ops: [], drafts: [], aliases: {}, resume: {}, notes: {}, finishes: {}, discarded: [], discarding: [],
})
const owners = new Map<string, WorkoutState>()
const opening = new Map<string, Promise<void>>()
export const legacyKeys = ['grind_pending_sessions_v2', 'grind_session_alias_v1', 'grind_offline_set_queue_v2']
export const WORKOUT_STORE_EVENT = 'grind:workout-store'
let database: Promise<IDBDatabase> | undefined
let channel: BroadcastChannel | undefined

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('grind-workouts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('accounts')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        database = undefined
      }
      resolve(request.result)
    }
  }).catch(error => {
    database = undefined
    throw error
  })
  return database
}

function notify(owner: string) {
  window.dispatchEvent(new CustomEvent(WORKOUT_STORE_EVENT, { detail: owner }))
}

function startChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return
  channel = new BroadcastChannel('grind-workouts')
  channel.onmessage = ({ data }: MessageEvent<string>) => {
    if (typeof data !== 'string' || !owners.has(data)) return
    void transact(data).then(() => notify(data)).catch(() => {})
  }
}

async function transact<T>(owner: string, mutate?: (state: WorkoutState) => T): Promise<T | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = mutate
      ? db.transaction('accounts', 'readwrite', { durability: 'strict' })
      : db.transaction('accounts', 'readonly')
    const store = tx.objectStore('accounts')
    const request = store.get(owner)
    let state: WorkoutState
    let result: T | undefined
    tx.onabort = () => reject(tx.error ?? new Error('Workout storage transaction aborted'))
    tx.oncomplete = () => {
      owners.set(owner, state)
      if (mutate) {
        notify(owner)
        channel?.postMessage(owner)
      }
      resolve(result)
    }
    request.onsuccess = () => {
      state = { ...empty(), ...request.result }
      if (!mutate) return
      try {
        result = mutate(state)
        store.put(state, owner)
      } catch (error) {
        tx.abort()
        reject(error)
      }
    }
  })
}

function migrateLegacy(owner: string, state: WorkoutState) {
  if (state.migrated) return
  const [drafts, aliases, ops] = legacyKeys.map(key => JSON.parse(localStorage.getItem(key) ?? 'null'))
  const owned = Array.isArray(drafts) ? (drafts as PendingLocalSession[]).filter(draft => draft?.userId === owner) : []
  const ids = new Set(owned.map(draft => draft.id))
  for (const draft of owned) {
    const alias = aliases && Object.hasOwn(aliases, draft.id) && aliases[draft.id]
    if (typeof alias === 'string') {
      state.aliases[draft.id] = alias
      ids.add(alias)
    } else {
      state.drafts.push(draft)
    }
  }
  if (Array.isArray(ops)) {
    for (const op of ops as QueuedOp[]) {
      if (!op || !ids.has(op.sessionId)) continue
      state.ops.push({ ...op, sessionId: state.aliases[op.sessionId] ?? op.sessionId, revision: crypto.randomUUID() })
    }
  }
  // Keep the source keys for older tabs and for entries whose owner cannot be proved.
  state.migrated = true
}

export function loadWorkoutStore(owner: string): Promise<void> {
  if (owners.has(owner)) return Promise.resolve()
  const pending = opening.get(owner)
  if (pending) return pending
  startChannel()
  const run = transact(owner, state => migrateLegacy(owner, state))
    .then(() => {})
    .finally(() => { opening.delete(owner) })
  opening.set(owner, run)
  return run
}

export function readWorkoutStore(owner: string | null): WorkoutState {
  return (owner && owners.get(owner)) || empty()
}

export async function refreshWorkoutStore(owner: string) {
  await loadWorkoutStore(owner)
  await transact(owner)
}

export async function changeWorkoutStore<T>(owner: string, mutate: (state: WorkoutState) => T) {
  await loadWorkoutStore(owner)
  return transact(owner, mutate) as Promise<T>
}

export async function purgeWorkoutStore(owner: string) {
  const ids = await changeWorkoutStore(owner, state => {
    const known = new Set([
      ...state.drafts.map(draft => draft.id), ...Object.keys(state.resume),
      ...Object.keys(state.aliases), ...Object.values(state.aliases), ...state.ops.map(op => op.sessionId),
    ])
    Object.assign(state, empty(), { migrated: true, legacyScanned: true })
    return known
  })
  // Strip only legacy rows whose owner is known.
  const drafts = JSON.parse(localStorage.getItem(legacyKeys[0]) ?? '[]') as PendingLocalSession[]
  const aliases = JSON.parse(localStorage.getItem(legacyKeys[1]) ?? '{}') as Record<string, string>
  const ops = JSON.parse(localStorage.getItem(legacyKeys[2]) ?? '[]') as QueuedOp[]
  for (const draft of drafts) {
    if (draft.userId !== owner) continue
    ids.add(draft.id)
    if (aliases[draft.id]) ids.add(aliases[draft.id])
    delete aliases[draft.id]
  }
  localStorage.setItem(legacyKeys[0], JSON.stringify(drafts.filter(draft => draft.userId !== owner)))
  localStorage.setItem(legacyKeys[1], JSON.stringify(aliases))
  localStorage.setItem(legacyKeys[2], JSON.stringify(ops.filter(op => !ids.has(op.sessionId))))
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(`grind.rest.active_timer:${owner}:`)) localStorage.removeItem(key)
  }
}
