'use client'

/**
 * Screen Wake Lock while an active workout is visible. Released on hide /
 * finish / discard. No-op when the API is missing (common on desktop).
 */
export class WorkoutWakeLock {
  private sentinel: WakeLockSentinel | null = null
  private wanted = false

  async acquire() {
    this.wanted = true
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    if (document.visibilityState !== 'visible') return
    try {
      this.sentinel = await navigator.wakeLock.request('screen')
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null
      })
    } catch {
      this.sentinel = null
    }
  }

  async release() {
    this.wanted = false
    try {
      await this.sentinel?.release()
    } catch {
      /* ignore */
    }
    this.sentinel = null
  }

  /** Re-acquire after visibility returns if we still want the lock. */
  async onVisibilityChange() {
    if (!this.wanted) return
    if (document.visibilityState === 'visible') {
      if (!this.sentinel) await this.acquire()
    }
  }
}
