'use client'
import { useEffect, useState } from 'react'

export type KeyboardMetrics = {
  /**
   * Height (CSS px) to lift bottom-anchored UI. Subtracts visualViewport
   * `offsetTop` so a panned page doesn't double-count the keyboard.
   * 0 when no keyboard (or visualViewport unavailable).
   */
  inset: number
  /** visualViewport.offsetTop — iOS often pans to keep a focused field on-screen. */
  offsetTop: number
  /** visualViewport.height (layout viewport height when VV is unavailable). */
  visibleHeight: number
  /**
   * True when the layout viewport is occluded by >60px (keyboard / chrome),
   * whether or not iOS has panned (`offsetTop`). Prefer this over `inset > 0`
   * when shrinking a top-pinned full-screen sheet.
   */
  open: boolean
}

const IDLE: KeyboardMetrics = {
  inset: 0,
  offsetTop: 0,
  visibleHeight: 0,
  open: false,
}

/**
 * visualViewport keyboard / occlusion metrics.
 *
 * On iOS the software keyboard shrinks the *visual* viewport but leaves the
 * *layout* viewport unchanged, so a `position: fixed` bottom-anchored element
 * stays pinned behind the keyboard. Measuring layout vs visual viewport gives
 * the amount to lift (or the visible frame to shrink into).
 *
 * A small threshold ignores sub-pixel jitter and address-bar show/hide.
 */
export function useKeyboardMetrics(): KeyboardMetrics {
  const [metrics, setMetrics] = useState<KeyboardMetrics>(IDLE)

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) {
      setMetrics({
        inset: 0,
        offsetTop: 0,
        visibleHeight: window.innerHeight,
        open: false,
      })
      return
    }

    const update = () => {
      const offsetTop = Math.round(vv.offsetTop)
      const visibleHeight = Math.round(vv.height)
      // Raw occlusion — still true when iOS pans (offsetTop ≈ keyboard).
      const occluded = window.innerHeight - vv.height
      const open = occluded > 60
      // `offsetTop` handles the case where iOS pans the page up to reveal a
      // focused field: that panned distance isn't keyboard, so subtract it out
      // for bottom-anchored lifts.
      const hidden = occluded - vv.offsetTop
      const inset = hidden > 60 ? Math.round(hidden) : 0
      setMetrics({ inset, offsetTop, visibleHeight, open })
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return metrics
}

/**
 * Height (CSS px) currently hidden behind the on-screen keyboard, via the
 * visualViewport API — suitable for lifting bottom-anchored UI.
 *
 * Returns 0 when no keyboard is shown — or when visualViewport is unavailable —
 * so callers can use it directly as a bottom offset without branching.
 */
export function useKeyboardInset(): number {
  return useKeyboardMetrics().inset
}
