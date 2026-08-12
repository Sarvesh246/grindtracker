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

export function getCached<T>(key: string): T | undefined {
  return store.get(key)?.data as T | undefined
}

export function isFresh(key: string): boolean {
  const entry = store.get(key)
  return !!entry && entry.generation === generation
}

export function setCached<T>(key: string, data: T): void {
  store.set(key, { data, generation })
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

/** Test-only: wipe store + generation. */
export function resetAppDataCache(): void {
  generation = 0
  store.clear()
  uiStore.clear()
  routeGeneration.clear()
}
