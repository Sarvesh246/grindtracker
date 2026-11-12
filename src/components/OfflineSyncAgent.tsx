'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { QUEUED_EVENT } from '@/lib/utils/offlineQueue'
import { hasUnsyncedWork, syncAllPending } from '@/lib/offline/sync'
import { browserIsOffline } from '@/lib/offline/offlineGate'

/** First retry after a failed pass; doubles each time up to the cap. */
const BASE_DELAY_MS = 5_000
const MAX_DELAY_MS = 120_000

/**
 * Keeps unsynced workout data moving to the cloud without anyone watching.
 *
 * Mounted once in the app shell so a set logged in a dead spot still reaches
 * Supabase if the user closed the workout screen (or the whole app and
 * reopened it later). It is deliberately quiet:
 *  - with nothing queued it does nothing at all — no timers, no requests;
 *  - it waits for the browser to report a connection and for the app to be
 *    visible, instead of polling a dead radio from the background;
 *  - failed passes back off exponentially (5s → 2min), and a single pass sends
 *    a handful of bulk requests, not one per set (see flushQueuedOps).
 * That keeps it from competing with music or video streaming over the same
 * weak cellular link.
 */
export default function OfflineSyncAgent() {
  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let running = false
    let stopped = false

    const clearTimer = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }

    const schedule = (delay: number) => {
      if (stopped || timer) return
      timer = setTimeout(() => {
        timer = null
        void run()
      }, delay)
    }

    async function run() {
      if (stopped || running) return
      if (!hasUnsyncedWork()) {
        attempt = 0
        return
      }
      // Resumed by the `online` / `visibilitychange` events below.
      if (browserIsOffline() || document.visibilityState === 'hidden') return
      running = true
      try {
        const more = await syncAllPending(supabase)
        if (more) {
          attempt += 1
          schedule(Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS))
        } else {
          attempt = 0
        }
      } catch {
        attempt += 1
        schedule(Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS))
      } finally {
        running = false
      }
    }

    /** Connectivity or visibility changed: try now and restart the backoff. */
    const kick = () => {
      attempt = 0
      clearTimer()
      void run()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') kick()
    }
    /** Something new was queued: give the workout screen a moment, then sync. */
    const onQueued = () => schedule(BASE_DELAY_MS)

    window.addEventListener('online', kick)
    window.addEventListener(QUEUED_EVENT, onQueued)
    document.addEventListener('visibilitychange', onVisibility)
    void run()

    return () => {
      stopped = true
      clearTimer()
      window.removeEventListener('online', kick)
      window.removeEventListener(QUEUED_EVENT, onQueued)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return null
}
