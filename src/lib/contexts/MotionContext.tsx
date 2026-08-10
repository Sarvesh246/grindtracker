'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type MotionPref = 'reduce' | 'no-preference'

const PREF_KEY = 'grind_motion_pref'

interface MotionContextValue {
  /** Explicit in-app Reduce Motion preference (Profile toggle). */
  prefReduceMotion: boolean
  /**
   * Effective reduce for JS-driven motion (charts, count-ups, delays).
   * True when the in-app pref OR the OS prefers-reduced-motion media query is on —
   * matching globals.css, which already zeros CSS transitions for both.
   */
  reduceMotion: boolean
  toggleReduceMotion: () => void
}

const MotionContext = createContext<MotionContextValue>({
  prefReduceMotion: false,
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
  const [osReduce, setOsReduce] = useState(false)

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

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    // Sync OS media query into React so JS animations (Recharts, RAF count-ups)
    // honor it the same way globals.css already does for transitions/keyframes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOsReduce(mq.matches)
    const onChange = () => setOsReduce(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const toggleReduceMotion = useCallback(() => {
    setPref(prev => {
      const next: MotionPref = prev === 'reduce' ? 'no-preference' : 'reduce'
      persistPref(next)
      applyPref(next)
      return next
    })
  }, [])

  const prefReduceMotion = pref === 'reduce'
  const reduceMotion = prefReduceMotion || osReduce
  const contextValue = useMemo(
    () => ({ prefReduceMotion, reduceMotion, toggleReduceMotion }),
    [prefReduceMotion, reduceMotion, toggleReduceMotion],
  )

  return (
    <MotionContext.Provider value={contextValue}>
      {children}
    </MotionContext.Provider>
  )
}

export function useMotionPref() {
  return useContext(MotionContext)
}
