'use client'
import { createContext, useContext, useEffect, useState } from 'react'

export type MotionPref = 'reduce' | 'no-preference'

const PREF_KEY = 'grind_motion_pref'

interface MotionContextValue {
  reduceMotion: boolean
  toggleReduceMotion: () => void
}

const MotionContext = createContext<MotionContextValue>({
  reduceMotion: false,
  toggleReduceMotion: () => {},
})

function readCookiePref(): MotionPref | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)grind_motion_pref=(reduce|no-preference)\b/)
  return match ? (match[1] as MotionPref) : null
}

function persistPref(pref: MotionPref) {
  // Cookie is the source of truth so the server can emit the right <html class>
  // on the next request (no first-paint flash, no hydration mismatch), same
  // approach as ThemeContext. localStorage written too for resilience.
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

/** Apply the preference to <html>. Safe to call client-side only. */
function applyPref(pref: MotionPref) {
  document.documentElement.classList.toggle('reduce-motion', pref === 'reduce')
}

export function MotionProvider({
  children,
  // Default 'no-preference' — a fresh visitor still gets the OS-level
  // `prefers-reduced-motion` media query in globals.css; this is an explicit
  // in-app override on TOP of that, not a replacement for it.
  initialPref = 'no-preference',
}: {
  children: React.ReactNode
  /** Resolved on the server from the cookie so the first render is deterministic. */
  initialPref?: MotionPref
}) {
  const [pref, setPref] = useState<MotionPref>(initialPref)

  // One-time migration for users who saved a preference before the cookie
  // existed: if the server sent no cookie but localStorage has a value, adopt
  // it after mount (no hydration mismatch — first render matched the server)
  // and write the cookie so every later server render is correct and flash-free.
  useEffect(() => {
    if (readCookiePref()) return
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(PREF_KEY)
    } catch {
      stored = null
    }
    if (stored === 'reduce' || stored === 'no-preference') {
      persistPref(stored)
      applyPref(stored)
      // Intentional post-mount sync from a browser-only store (localStorage is
      // unavailable during SSR). Reading it in the initializer would reintroduce
      // the server/client hydration mismatch this design avoids.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPref(stored)
    }
  }, [])

  function toggleReduceMotion() {
    setPref(prev => {
      const next: MotionPref = prev === 'reduce' ? 'no-preference' : 'reduce'
      persistPref(next)
      applyPref(next)
      return next
    })
  }

  return (
    <MotionContext.Provider value={{ reduceMotion: pref === 'reduce', toggleReduceMotion }}>
      {children}
    </MotionContext.Provider>
  )
}

export function useMotionPref() {
  return useContext(MotionContext)
}
