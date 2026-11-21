'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { consumeRouteRefresh, markAppDataStale } from '@/lib/cache/appDataCache'

import { createClient } from '@/lib/supabase/client'

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
export default function RouteCacheSync({ owner }: { owner: string | null }) {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (consumeRouteRefresh(pathname)) router.refresh()
  }, [pathname, router])

  useEffect(() => {
    if (!owner || (pathname !== '/home' && !pathname.startsWith('/progress'))) return
    const supabase = createClient()
    let stopped = false
    let revision: number | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    function invalidate() {
      if (stopped || timer) return
      timer = setTimeout(() => {
        timer = undefined
        markAppDataStale(pathname === '/home' ? '/home' : undefined)
        window.dispatchEvent(new Event('grind:health-updated'))
        if (pathname === '/home') router.refresh()
      }, 200)
    }
    // Realtime can miss events while iOS suspends the app, so compare a cheap
    // count when the page returns or the channel subscribes again.
    async function checkWatch() {
      if (stopped || !navigator.onLine || document.visibilityState === 'hidden') return
      const { count, error } = await supabase.from('sessions').select('id', { head: true, count: 'exact' })
        .eq('user_id', owner).eq('source', 'watch').not('completed_at', 'is', null)
      if (stopped || error || count === null) return
      if (revision !== null && revision !== count) invalidate()
      revision = count
    }
    const channel = supabase.channel('watch-workouts:' + owner)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'sessions', filter: 'user_id=eq.' + owner,
      }, event => {
        if (event.new && 'source' in event.new && event.new.source === 'watch' && event.new.completed_at) invalidate()
      })
    try {
      channel.subscribe(status => { if (status === 'SUBSCRIBED') void checkWatch() })
    } catch {
      // Browsers that disallow WebSockets still refresh when the app resumes.
    }
    window.addEventListener('grind:workout-complete', invalidate)
    document.addEventListener('visibilitychange', checkWatch)
    window.addEventListener('online', checkWatch)
    void checkWatch()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('grind:workout-complete', invalidate)
      document.removeEventListener('visibilitychange', checkWatch)
      window.removeEventListener('online', checkWatch)
      void supabase.removeChannel(channel).catch(() => {})
    }
  }, [owner, pathname, router])

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
