'use client'
import { useEffect, useRef, useState } from 'react'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || document.documentElement.classList.contains('reduce-motion')
  } catch {
    return false
  }
}

/**
 * Keeps the last non-null value around for `exitMs` after it goes null, with
 * a `closing` flag flipped for that window — lets a toast/pill play an exit
 * animation instead of vanishing the instant its owning state clears.
 */
export function useExitingValue<T>(value: T | null, exitMs: number): { data: T | null; closing: boolean } {
  const [data, setData] = useState<T | null>(value)
  const [closing, setClosing] = useState(false)
  // Tracks the latest `data` without being an effect dependency — reading it
  // directly there would mean setting it inside the same effect loops forever.
  const dataRef = useRef(data)
  useEffect(() => { dataRef.current = data })

  useEffect(() => {
    if (value !== null) {
      // Syncing local state to the `value` prop transitioning non-null —
      // an external-value sync, not derived render state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(value)
      setClosing(false)
      return
    }
    if (dataRef.current === null) return // never shown — nothing to exit
    setClosing(true)
    // CSS already zeros exit keyframes under reduce-motion; don't wait the full
    // exitMs before unmounting or the toast feels stuck.
    const wait = prefersReducedMotion() ? 0 : exitMs
    const t = setTimeout(() => {
      setData(null)
      setClosing(false)
    }, wait)
    return () => clearTimeout(t)
  }, [value, exitMs])

  return { data, closing }
}
