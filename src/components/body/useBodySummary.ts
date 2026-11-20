'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient, getClientUser } from '@/lib/supabase/client'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import { localDateKey } from '@/lib/utils/formatting'
import { getBodySummary, type BodySummary } from '@/lib/body/queries'

/**
 * Loads the caller's body summary after first paint, so server-rendered pages
 * (Home, Progress) hydrate exactly as before and the body surfaces simply
 * appear once there's something to show. Returns null while loading, when
 * migration 59 isn't applied, and in Demo Mode (real health data never belongs
 * on a demo screen). A failed refresh keeps the last good summary for the same
 * day; once the local day changes, an earlier day's summary is dropped (null)
 * until a read for today lands, so Home never shows yesterday's Charge.
 */
export function useBodySummary(): BodySummary | null {
  const { demoMode } = useDemoMode()
  const supabase = useMemo(() => createClient(), [])
  const [summary, setSummary] = useState<BodySummary | null>(null)

  useEffect(() => {
    if (demoMode) return
    let cancelled = false
    let generation = 0
    let owner: string | null = null
    let running = false
    let day = localDateKey()
    async function load() {
      if (running || cancelled) return
      running = true
      const request = ++generation
      try {
        const user = await getClientUser(supabase)
        if (cancelled || request !== generation) return
        if (owner !== user?.id) { owner = user?.id ?? null; setSummary(null) }
        if (!user) return
        day = localDateKey()
        const s = await getBodySummary(supabase, user.id, day)
        if (!cancelled && request === generation && s.available) setSummary(s)
      } catch {
        // A failed read keeps the last good summary; the next focus retries.
      } finally {
        running = false
        if (!cancelled && request !== generation) setTimeout(() => { if (!cancelled) void load() }, 0)
      }
    }
    const visible = () => { if (document.visibilityState === 'visible') void load() }
    const auth = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== owner) {
        ++generation
        owner = session?.user.id ?? null
        setSummary(null)
        setTimeout(() => { if (!cancelled) void load() }, 0)
      }
    })
    void load()
    const timer = setInterval(() => {
      if (localDateKey() === day) return
      setSummary(prev => (prev && prev.today !== localDateKey() ? null : prev))
      visible()
    }, 60_000)
    window.addEventListener('focus', visible)
    window.addEventListener('online', visible)
    window.addEventListener('grind:health-updated', visible)
    document.addEventListener('visibilitychange', visible)
    return () => {
      cancelled = true
      ++generation
      clearInterval(timer)
      auth.data.subscription.unsubscribe()
      window.removeEventListener('focus', visible)
      window.removeEventListener('online', visible)
      window.removeEventListener('grind:health-updated', visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [supabase, demoMode])

  // Re-checked on every render, so a summary from an earlier day never shows
  // even before the interval above has cleared it.
  const stale = summary !== null && summary.today !== localDateKey()
  return demoMode || stale ? null : summary
}

/** "arms-abs" → "Arms Abs" for sentences (dayName() is the uppercase label form). */
export function dayTitle(key: string): string {
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
