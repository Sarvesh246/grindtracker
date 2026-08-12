'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { consumeRouteRefresh } from '@/lib/cache/appDataCache'

/** Same order as BottomNav — warm these so a tab tap/swipe does not wait on RSC. */
const TAB_HREFS = ['/home', '/log', '/progress', '/profile', '/leaderboard']

/**
 * Two jobs:
 * 1. After `markAppDataStale()`, the Next.js client router may still hold a
 *    pre-mutation RSC payload for Home/Profile. Refresh that route the next
 *    time we land on it (cached paint first, then silent refresh — no
 *    `loading.tsx` flash).
 * 2. Prefetch the other top-level tabs on idle so the first visit in a
 *    session is ready before the tap.
 */
export default function RouteCacheSync() {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (consumeRouteRefresh(pathname)) router.refresh()
  }, [pathname, router])

  useEffect(() => {
    const run = () => {
      for (const href of TAB_HREFS) {
        if (href !== pathname) router.prefetch(href)
      }
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 1500 })
      return () => cancelIdleCallback(id)
    }
    const id = window.setTimeout(run, 400)
    return () => window.clearTimeout(id)
  }, [pathname, router])

  return null
}
