import { clearOfflineWorkoutData } from './localSession'

/** Forget device copies used for signed-in rendering; durable workout drafts stay with their owner. */
export function clearOfflineCaches(): void {
  clearOfflineWorkoutData()
  if (typeof caches !== 'undefined') void caches.delete('grind-pages-v1').catch(() => {})
}
