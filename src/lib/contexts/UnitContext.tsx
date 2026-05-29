'use client'
import { createContext, useContext, useEffect, useState } from 'react'

type Unit = 'metric' | 'imperial'

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
  unit: 'metric',
  unitLabel: 'kg',
  toggleUnit: () => {},
  toDisplay: identity,
  fromDisplay: identity,
  fmt: (n: number) => String(n),
})

/** Round to 1 decimal place and strip a trailing ".0" (e.g. 45.359 -> "45.4", 99.0 -> "99"). */
function formatDisplay(value: number): string {
  return parseFloat(value.toFixed(1)).toString()
}

export function UnitProvider({ children }: { children: React.ReactNode }) {
  // Default to imperial (lbs) — stored weights are canonical lbs, so a fresh load
  // with no saved preference shows numbers exactly as entered.
  const [unit, setUnit] = useState<Unit>('imperial')

  useEffect(() => {
    const stored = localStorage.getItem('grind_unit_pref')
    if (stored === 'imperial' || stored === 'metric') setUnit(stored)
  }, [])

  function toggleUnit() {
    setUnit(prev => {
      const next = prev === 'metric' ? 'imperial' : 'metric'
      localStorage.setItem('grind_unit_pref', next)
      return next
    })
  }

  const metric = unit === 'metric'
  // Display is intentionally lossy (rounded), but the canonical lbs store is never
  // overwritten on a toggle, so toggling a read-only value drifts zero. Drift can only
  // happen when the user actively edits a kg field and saves it — a one-time, acceptable
  // quantization. Note: fromDisplay never rounds, to keep that drift to a single edit.
  const toDisplay = (canonicalLbs: number) => (metric ? canonicalLbs / LBS_PER_KG : canonicalLbs)
  const fromDisplay = (displayValue: number) => (metric ? displayValue * LBS_PER_KG : displayValue)
  const fmt = (canonicalLbs: number) => formatDisplay(toDisplay(canonicalLbs))

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
