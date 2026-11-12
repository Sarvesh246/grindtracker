import { clearOfflineWorkoutData } from './localSession'

/** Must match PAGES_CACHE in public/sw.js. */
const PAGES_CACHE = 'grind-pages-v1'

/**
 * Sign-out / account delete: forget the saved screens and the device copy of the
 * user's catalog, so the next person on this phone never sees them. Unsynced set
 * writes are deliberately left alone (see clearOfflineWorkoutData).
 */
export function clearOfflineCaches(): void {
  clearOfflineWorkoutData()
  if (typeof caches !== 'undefined') {
    void caches.delete(PAGES_CACHE).catch(() => {})
  }
}
