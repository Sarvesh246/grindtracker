'use client'
import { useEffect } from 'react'

/** Registers public/sw.js once on mount. Renders nothing. */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.error('Service worker registration failed:', err)
    })
  }, [])

  return null
}
