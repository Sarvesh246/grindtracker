'use client'
import { createContext, useContext, useState } from 'react'

type Unit = 'metric' | 'imperial'

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

function readStoredUnit(): Unit {
  // Read synchronously so the very first client render already reflects the
  // saved preference — no post-mount effect that snaps 'kg' → 'lbs'.
  if (typeof window === 'undefined') return 'metric'
  try {
    const stored = window.localStorage.getItem('grind_unit_pref')
    return stored === 'imperial' || stored === 'metric' ? stored : 'metric'
  } catch {
    // localStorage can throw in private-mode / sandboxed contexts.
    return 'metric'
  }
}

export function UnitProvider({ children }: { children: React.ReactNode }) {
  const [unit, setUnit] = useState<Unit>(readStoredUnit)

  function toggleUnit() {
    setUnit(prev => {
      const next = prev === 'metric' ? 'imperial' : 'metric'
      try {
        window.localStorage.setItem('grind_unit_pref', next)
      } catch {
        // Ignore persistence failures; in-memory state still updates.
      }
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
