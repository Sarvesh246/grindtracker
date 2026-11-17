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
 * migration 59 isn't applied, on any failed read, and in Demo Mode (real
 * health data never belongs on a demo screen).
 */
export function useBodySummary(): BodySummary | null {
  const { demoMode } = useDemoMode()
  const supabase = useMemo(() => createClient(), [])
  const [summary, setSummary] = useState<BodySummary | null>(null)

  useEffect(() => {
    if (demoMode) return
    let cancelled = false
    void (async () => {
      const user = await getClientUser(supabase)
      if (!user || cancelled) return
      const s = await getBodySummary(supabase, user.id, localDateKey())
      if (!cancelled && s.available) setSummary(s)
    })()
    return () => { cancelled = true }
  }, [supabase, demoMode])

  return demoMode ? null : summary
}

/** "arms-abs" → "Arms Abs" for sentences (dayName() is the uppercase label form). */
export function dayTitle(key: string): string {
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
