'use client'
import { useEffect } from 'react'
import { closeGrindNotifications, syncTimezoneIfEnabled } from '@/lib/push/client'

/** Registers public/sw.js once on mount. Syncs push timezone + clears badges on focus. */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.error('Service worker registration failed:', err)
    })
  }, [])

  // Once a day, on a good connection, let the worker save the main screens so
  // the app opens fully offline. Skipped mid-workout (never compete with a live
  // set save for bandwidth) and on the login/public pages (nothing to save).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const WARM_KEY = 'grind_sw_warm_at_v2'
    const WARM_EVERY_MS = 24 * 60 * 60 * 1000
    const timer = setTimeout(async () => {
      try {
        if (navigator.onLine === false) return
        const { pathname, search } = window.location
        const onPrivatePage = ['/home', '/log', '/progress', '/profile', '/leaderboard'].some(
          p => pathname === p || pathname.startsWith(p + '/'),
        )
        if (!onPrivatePage) return
        if (pathname === '/log' && new URLSearchParams(search).get('day')) return
        const last = Number(window.localStorage.getItem(WARM_KEY) ?? 0)
        if (Date.now() - last < WARM_EVERY_MS) return
        const reg = await navigator.serviceWorker.ready
        reg.active?.postMessage({
          type: 'WARM_ROUTES',
          routes: [
            '/home',
            '/log',
            '/progress',
            '/profile',
            '/leaderboard',
            '/profile/settings',
            '/log/past',
            '/progress/photos',
          ],
        })
        window.localStorage.setItem(WARM_KEY, String(Date.now()))
      } catch {
        /* an optimisation only */
      }
    }, 10_000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    void syncTimezoneIfEnabled()

    let debounce: ReturnType<typeof setTimeout> | null = null
    function onVisibility() {
      // visibilitychange alone — focus while already visible was double-firing
      // close + timezone sync on every window focus.
      if (document.visibilityState !== 'visible') return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        debounce = null
        void closeGrindNotifications({ clearBadge: true })
        void syncTimezoneIfEnabled()
      }, 150)
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (debounce) clearTimeout(debounce)
    }
  }, [])

  return null
}
