import type { UserStats } from '@/lib/types'

/**
 * Last-known `user_stats`, persisted per user so a failed read at launch can
 * still paint real numbers instead of an error card.
 *
 * The server retries the stats read and the client retries again on top of that
 * (see HomeDashboard), but neither helps while the device is genuinely offline
 * — and an established user opening the app should see their level and streak,
 * not a placeholder. These are the user's own values from their last successful
 * load, replaced the moment a fresh read lands.
 *
 * localStorage rather than the in-memory `appDataCache`: this has to survive a
 * cold PWA launch, which is exactly when it's needed.
 */

const STORAGE_KEY = 'grind_last_stats'
/** Beyond this, "your last known level" stops being a useful answer. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

interface StoredStats {
  /** Keyed to the owner so a shared device never paints one user's numbers for another. */
  userId: string
  savedAt: number
  stats: UserStats
}

export function readLastKnownStats(userId: string, now: number = Date.now()): UserStats | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredStats | null
    if (!parsed || parsed.userId !== userId || !parsed.stats) return null
    if (!Number.isFinite(parsed.savedAt) || now - parsed.savedAt > MAX_AGE_MS) return null
    return parsed.stats
  } catch {
    return null
  }
}

export function writeLastKnownStats(userId: string, stats: UserStats, now: number = Date.now()): void {
  try {
    const payload: StoredStats = { userId, savedAt: now, stats }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Private mode / quota — the cache is an optimization, never a requirement.
  }
}

/** Sign-out and account-delete, alongside `resetAppDataCache()`. */
export function clearLastKnownStats(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {}
}
