'use client'
import { useEffect, useState } from 'react'

/**
 * Height (CSS px) currently hidden behind the on-screen keyboard, via the
 * visualViewport API.
 *
 * On iOS the software keyboard shrinks the *visual* viewport but leaves the
 * *layout* viewport unchanged, so a `position: fixed` bottom-anchored element
 * (a bottom sheet, a toast, an input near the bottom) stays pinned behind the
 * keyboard where the user can't see it. Measuring the gap between the layout
 * viewport (`window.innerHeight`) and the visual viewport gives the amount to
 * lift that content up by.
 *
 * Returns 0 when no keyboard is shown — or when visualViewport is unavailable —
 * so callers can use it directly as a bottom offset without branching. A small
 * threshold ignores the sub-pixel jitter and address-bar show/hide that would
 * otherwise register as a phantom keyboard.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return

    const update = () => {
      // `offsetTop` handles the case where iOS pans the page up to reveal a
      // focused field: that panned distance isn't keyboard, so subtract it out.
      const hidden = window.innerHeight - vv.height - vv.offsetTop
      setInset(hidden > 60 ? Math.round(hidden) : 0)
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
