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
