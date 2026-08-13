/**
 * Short TTL in-memory cache for coach USER_DATA JSON between turns.
 * Keyed by user + local calendar day (+ unit). Module-scoped — fine for a
 * single Node serverless instance; misses on cold start are OK.
 */

const TTL_MS = 60_000

type Entry = { json: string; expiresAt: number }

const store = new Map<string, Entry>()

export function coachContextCacheKey(
  userId: string,
  localDate: string,
  unit: string,
): string {
  return `${userId}|${localDate}|${unit}`
}

export function getCachedCoachContext(key: string): string | null {
  const hit = store.get(key)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    store.delete(key)
    return null
  }
  return hit.json
}

export function setCachedCoachContext(key: string, json: string): void {
  store.set(key, { json, expiresAt: Date.now() + TTL_MS })
  if (store.size > 200) {
    const now = Date.now()
    for (const [k, v] of store) {
      if (v.expiresAt <= now) store.delete(k)
    }
    if (store.size > 200) {
      const oldest = store.keys().next().value
      if (oldest) store.delete(oldest)
    }
  }
}

/** Drop cached context for a user (any day/unit). */
export function invalidateCoachContextCache(userId: string): void {
  const prefix = `${userId}|`
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k)
  }
}
