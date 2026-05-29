'use client'
import { createContext, useContext, useEffect, useState } from 'react'

type Unit = 'metric' | 'imperial'

const PREF_KEY = 'grind_unit_pref'

interface UnitContextValue {
  unit: Unit
  unitLabel: 'kg' | 'lbs'
  toggleUnit: () => void
}

const UnitContext = createContext<UnitContextValue>({
  unit: 'metric',
  unitLabel: 'kg',
  toggleUnit: () => {},
})

function readCookieUnit(): Unit | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)grind_unit_pref=(metric|imperial)\b/)
  return match ? (match[1] as Unit) : null
}

function persistUnit(unit: Unit) {
  // Cookie is the source of truth so the server can render the right unit on
  // the next request (no first-paint flash, no hydration mismatch). localStorage
  // is written too for resilience / backwards compatibility.
  try {
    document.cookie = `${PREF_KEY}=${unit};path=/;max-age=31536000;samesite=lax`
  } catch {
    // ignore — non-browser or restricted context
  }
  try {
    window.localStorage.setItem(PREF_KEY, unit)
  } catch {
    // ignore — private mode / sandboxed context
  }
}

export function UnitProvider({
  children,
  initialUnit = 'metric',
}: {
  children: React.ReactNode
  /** Resolved on the server from the cookie so the first render is deterministic. */
  initialUnit?: Unit
}) {
  const [unit, setUnit] = useState<Unit>(initialUnit)

  // One-time migration for users who saved a preference before the cookie
  // existed: if the server sent no cookie but localStorage has a value, adopt
  // it after mount (no hydration mismatch — first render matched the server)
  // and write the cookie so every later server render is correct and flash-free.
  useEffect(() => {
    if (readCookieUnit()) return
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(PREF_KEY)
    } catch {
      stored = null
    }
    if (stored === 'imperial' || stored === 'metric') {
      persistUnit(stored)
      // Intentional post-mount sync from a browser-only store (localStorage is
      // unavailable during SSR). Reading it in the initializer instead would
      // reintroduce the server/client hydration mismatch this design avoids.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUnit(stored)
    }
  }, [])

  function toggleUnit() {
    setUnit(prev => {
      const next = prev === 'metric' ? 'imperial' : 'metric'
      persistUnit(next)
      return next
    })
  }

  return (
    <UnitContext.Provider value={{ unit, unitLabel: unit === 'metric' ? 'kg' : 'lbs', toggleUnit }}>
      {children}
    </UnitContext.Provider>
  )
}

export function useUnit() {
  return useContext(UnitContext)
}
