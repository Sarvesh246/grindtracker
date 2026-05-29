'use client'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type Unit = 'metric' | 'imperial'

const PREF_KEY = 'grind_unit_pref'

// All weights are stored canonically in lbs. The toggle is a display preference:
// in metric mode we convert lbs <-> kg at the display/input boundaries only.
export const LBS_PER_KG = 2.20462

interface UnitContextValue {
  unit: Unit
  unitLabel: 'kg' | 'lbs'
  toggleUnit: () => void
  /** Convert a canonical (lbs) value into the active display unit. */
  toDisplay: (canonicalLbs: number) => number
  /** Convert a value typed in the active display unit back to canonical lbs. */
  fromDisplay: (displayValue: number) => number
  /** Format a canonical (lbs) value for display: rounded to 1 decimal, trailing zeros stripped. */
  fmt: (canonicalLbs: number) => string
}

function identity(n: number) {
  return n
}

const UnitContext = createContext<UnitContextValue>({
  unit: 'imperial',
  unitLabel: 'lbs',
  toggleUnit: () => {},
  toDisplay: identity,
  fromDisplay: identity,
  fmt: (n: number) => String(n),
})

/** Round to 1 decimal place and strip a trailing ".0" (e.g. 45.359 -> "45.4", 99.0 -> "99"). */
function formatDisplay(value: number): string {
  return parseFloat(value.toFixed(1)).toString()
}

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
  // Default imperial (lbs) — stored weights are canonical lbs, so a fresh load
  // with no saved preference shows numbers exactly as entered.
  initialUnit = 'imperial',
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

  const metric = unit === 'metric'
  // Display is intentionally lossy (rounded), but the canonical lbs store is never
  // overwritten on a toggle, so toggling a read-only value drifts zero. Drift can only
  // happen when the user actively edits a kg field and saves it — a one-time, acceptable
  // quantization. Note: fromDisplay never rounds, to keep that drift to a single edit.
  //
  // Memoized so the identities are stable across renders and only change when the unit
  // changes. Consumers that close over them (e.g. progress's recomputeForMetric) can then
  // list them as deps without re-running every render or capturing a stale closure.
  const toDisplay = useCallback(
    (canonicalLbs: number) => (metric ? canonicalLbs / LBS_PER_KG : canonicalLbs),
    [metric],
  )
  const fromDisplay = useCallback(
    (displayValue: number) => (metric ? displayValue * LBS_PER_KG : displayValue),
    [metric],
  )
  const fmt = useCallback(
    (canonicalLbs: number) => formatDisplay(toDisplay(canonicalLbs)),
    [toDisplay],
  )

  return (
    <UnitContext.Provider
      value={{ unit, unitLabel: metric ? 'kg' : 'lbs', toggleUnit, toDisplay, fromDisplay, fmt }}
    >
      {children}
    </UnitContext.Provider>
  )
}

export function useUnit() {
  return useContext(UnitContext)
}
