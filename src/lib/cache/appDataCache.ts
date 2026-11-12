/**
 * In-memory session cache for client-fetched tab data.
 *
 * Next.js 15+ defaults `staleTimes.dynamic` to 0, so every tab switch
 * remounts the page and (for client components) refetches from scratch.
 * This store keeps the last successful payload so a remount can paint
 * immediately, then revalidate only when `markAppDataStale()` has run
 * (workout finished, catalog edited, etc.) or the entry was never filled.
 *
 * Module-level on purpose: it must survive App Router unmounts. It is
 * per-tab JavaScript heap, not shared across devices or full reloads.
 */

type Entry<T> = {
  data: T
  generation: number
}

let generation = 0
const store = new Map<string, Entry<unknown>>()
const uiStore = new Map<string, unknown>()
/** Last cache generation a given route already refreshed for. */
const routeGeneration = new Map<string, number>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export const CACHE_KEYS = {
  exercises: 'exercises',
  progressLogs: (exerciseId: string) => `progress:logs:${exerciseId}`,
  progressPhotos: 'progress:photos',
  progressSelection: 'progress:selection',
  logCatalog: 'log:catalog',
  leaderboard: (category: string, friendSig: string) =>
    `leaderboard:${category}:${friendSig}`,
  friends: 'friends',
  bodyWeights: 'bodyWeights',
} as const

export function getGeneration(): number {
  return generation
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// ── Device copy ─────────────────────────────────────────────────────────────
// The in-memory store dies with the tab, so a cold open with no signal had
// nothing to paint. Successful payloads are mirrored to localStorage and read
// back on a miss as STALE entries (generation -1): they paint instantly, and
// the usual revalidation replaces them when the network answers. Cleared with
// the rest of the cache on sign-out.
const PERSIST_PREFIX = 'grind_qc_v1:'
const PERSIST_MAX_CHARS = 400_000

function persist(key: string, data: unknown) {
  if (typeof window === 'undefined') return
  try {
    const json = JSON.stringify(data)
    if (json.length <= PERSIST_MAX_CHARS) window.localStorage.setItem(PERSIST_PREFIX + key, json)
  } catch {
    /* storage full / unserialisable — memory copy still works */
  }
}

function readPersisted(key: string): unknown {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(PERSIST_PREFIX + key)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

export function getCached<T>(key: string): T | undefined {
  const hit = store.get(key)
  if (hit) return hit.data as T
  const saved = readPersisted(key)
  if (saved === undefined) return undefined
  // Stored once so repeated snapshot reads return the same reference.
  store.set(key, { data: saved, generation: -1 })
  return saved as T
}

export function isFresh(key: string): boolean {
  const entry = store.get(key)
  return !!entry && entry.generation === generation
}

export function setCached<T>(key: string, data: T): void {
  store.set(key, { data, generation })
  persist(key, data)
  notify()
}

export function getUiState<T>(key: string): T | undefined {
  return uiStore.get(key) as T | undefined
}

export function setUiState<T>(key: string, value: T): void {
  uiStore.set(key, value)
}

/**
 * Bump the cache generation so every stored payload is treated as stale.
 * Cached values are kept for instant paint; the next mount/subscriber
 * revalidates in the background.
 *
 * Pass `freshPath` when the current route already called `router.refresh()`
 * (or is itself the source of the new data) so RouteCacheSync doesn't
 * refresh it a second time.
 */
export function markAppDataStale(freshPath?: string): void {
  generation += 1
  if (freshPath) routeGeneration.set(normalizePath(freshPath), generation)
  notify()
}

/**
 * True when this pathname was last shown at an older generation — i.e. the
 * Next.js client router may still be holding a pre-mutation RSC payload.
 * Records the current generation so a later visit at the same generation
 * does not refresh again.
 */
export function consumeRouteRefresh(pathname: string): boolean {
  const path = normalizePath(pathname)
  const prev = routeGeneration.get(path)
  routeGeneration.set(path, generation)
  return prev !== undefined && prev !== generation
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

/**
 * Wipe the entire store + generation counter. Call on sign-out — this cache
 * is a module-level singleton with no user id in its keys, so without this
 * the next account to sign in on the same tab/device can paint a prior
 * user's cached exercises/history/body-weights until an unrelated write
 * happens to bump the generation.
 */
export function resetAppDataCache(): void {
  generation = 0
  store.clear()
  if (typeof window !== 'undefined') {
    try {
      for (const k of Object.keys(window.localStorage)) {
        if (k.startsWith(PERSIST_PREFIX)) window.localStorage.removeItem(k)
      }
    } catch {
      /* ignore */
    }
  }
  uiStore.clear()
  routeGeneration.clear()
}
