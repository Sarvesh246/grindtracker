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

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        void closeGrindNotifications({ clearBadge: true })
        void syncTimezoneIfEnabled()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [])

  return null
}
