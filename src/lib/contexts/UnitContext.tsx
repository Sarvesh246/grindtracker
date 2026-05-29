'use client'
import { createContext, useContext, useEffect, useState } from 'react'

type Unit = 'metric' | 'imperial'

const KG_TO_LBS = 2.20462
const LBS_TO_KG = 1 / KG_TO_LBS

interface UnitContextValue {
  unit: Unit
  unitLabel: 'kg' | 'lbs'
  toggleUnit: () => void
  /** Convert a canonical kg value to the current display unit. */
  toDisplay: (kg: number) => number
  /** Convert a display-unit value back to canonical kg for storage. */
  toStorage: (val: number) => number
}

const UnitContext = createContext<UnitContextValue>({
  unit: 'metric',
  unitLabel: 'kg',
  toggleUnit: () => {},
  toDisplay: (kg) => kg,
  toStorage: (val) => val,
})

function buildToDisplay(unit: Unit) {
  return (kg: number): number =>
    unit === 'imperial' ? Math.round(kg * KG_TO_LBS * 10) / 10 : Math.round(kg * 10) / 10
}

function buildToStorage(unit: Unit) {
  return (val: number): number =>
    unit === 'imperial' ? Math.round(val * LBS_TO_KG * 1000) / 1000 : val
}

export function UnitProvider({ children }: { children: React.ReactNode }) {
  const [unit, setUnit] = useState<Unit>('metric')

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

  return (
    <UnitContext.Provider value={{
      unit,
      unitLabel: unit === 'metric' ? 'kg' : 'lbs',
      toggleUnit,
      toDisplay: buildToDisplay(unit),
      toStorage: buildToStorage(unit),
    }}>
      {children}
    </UnitContext.Provider>
  )
}

export function useUnit() {
  return useContext(UnitContext)
}
