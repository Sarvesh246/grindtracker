'use client'
import { createContext, useContext, useEffect, useState } from 'react'

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
    <UnitContext.Provider value={{ unit, unitLabel: unit === 'metric' ? 'kg' : 'lbs', toggleUnit }}>
      {children}
    </UnitContext.Provider>
  )
}

export function useUnit() {
  return useContext(UnitContext)
}
