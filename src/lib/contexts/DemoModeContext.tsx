'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type DemoModePref = 'on' | 'off'

const PREF_KEY = 'grind_demo_mode_pref'

interface DemoModeContextValue {
  demoMode: boolean
  toggleDemoMode: () => void
  setDemoMode: (on: boolean) => void
}

const DemoModeContext = createContext<DemoModeContextValue>({
  demoMode: false,
  toggleDemoMode: () => {},
  setDemoMode: () => {},
})

function readCookiePref(): DemoModePref | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)grind_demo_mode_pref=(on|off)\b/)
  return match ? (match[1] as DemoModePref) : null
}

function persistPref(pref: DemoModePref) {
  // Cookie is the source of truth so server components (profile/home/leaderboard
  // pages) can decide whether to substitute fake data before the first paint —
  // same approach as UnitContext/MotionContext.
  try {
    document.cookie = `${PREF_KEY}=${pref};path=/;max-age=31536000;samesite=lax`
  } catch {
    // ignore — non-browser or restricted context
  }
  try {
    window.localStorage.setItem(PREF_KEY, pref)
  } catch {
    // ignore — private mode / sandboxed context
  }
}

export function DemoModeProvider({
  children,
  initialDemoMode = false,
}: {
  children: React.ReactNode
  /** Resolved on the server from the cookie so the first render is deterministic. */
  initialDemoMode?: boolean
}) {
  const [pref, setPref] = useState<DemoModePref>(initialDemoMode ? 'on' : 'off')

  // One-time migration for a preference saved before the cookie existed.
  useEffect(() => {
    if (readCookiePref()) return
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(PREF_KEY)
    } catch {
      stored = null
    }
    if (stored === 'on' || stored === 'off') {
      persistPref(stored)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPref(stored)
    }
  }, [])

  const toggleDemoMode = useCallback(() => {
    setPref(prev => {
      const next: DemoModePref = prev === 'on' ? 'off' : 'on'
      persistPref(next)
      return next
    })
  }, [])

  const setDemoMode = useCallback((on: boolean) => {
    const next: DemoModePref = on ? 'on' : 'off'
    setPref(prev => {
      if (prev === next) return prev
      persistPref(next)
      return next
    })
  }, [])

  const demoMode = pref === 'on'
  const contextValue = useMemo(
    () => ({ demoMode, toggleDemoMode, setDemoMode }),
    [demoMode, toggleDemoMode, setDemoMode],
  )

  return (
    <DemoModeContext.Provider value={contextValue}>
      {children}
    </DemoModeContext.Provider>
  )
}

export function useDemoMode() {
  return useContext(DemoModeContext)
}
