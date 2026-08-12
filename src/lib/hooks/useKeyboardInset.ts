'use client'
import { useEffect, useState } from 'react'

export type KeyboardMetrics = {
  /**
   * Height (CSS px) to lift bottom-anchored UI. Subtracts visualViewport
   * `offsetTop` so a panned page doesn't double-count the keyboard.
   * 0 when no keyboard (or visualViewport unavailable).
   */
  inset: number
  /**
   * Raw occlusion vs a stable layout baseline (ignores iOS pan). Prefer this
   * when padding/shrinking a top-pinned full-screen sheet.
   */
  occluded: number
  /** visualViewport.offsetTop — iOS often pans to keep a focused field on-screen. */
  offsetTop: number
  /** visualViewport.height (layout viewport height when VV is unavailable). */
  visibleHeight: number
  /**
   * True when the viewport is occluded by >60px (keyboard / chrome),
   * whether or not iOS has panned (`offsetTop`) and even when `innerHeight`
   * briefly shrinks with the keyboard (baseline comparison). Prefer this over
   * `inset > 0` when shrinking a top-pinned full-screen sheet.
   */
  open: boolean
}

const IDLE: KeyboardMetrics = {
  inset: 0,
  occluded: 0,
  offsetTop: 0,
  visibleHeight: 0,
  open: false,
}

const OPEN_THRESHOLD = 60

/**
 * visualViewport keyboard / occlusion metrics.
 *
 * On iOS the software keyboard shrinks the *visual* viewport but leaves the
 * *layout* viewport unchanged, so a `position: fixed` bottom-anchored element
 * stays pinned behind the keyboard. Measuring layout vs visual viewport gives
 * the amount to lift (or the visible frame to shrink into).
 *
 * Quirks handled here:
 * - Some iOS PWA paths briefly shrink `window.innerHeight` with the keyboard,
 *   which makes `innerHeight - vv.height ≈ 0`. We keep a closed-keyboard
 *   baseline and compare VV height against that.
 * - Autofocus / focus often updates VV a beat late — we remeasure on a short
 *   schedule after `focusin`.
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
        occluded: 0,
        offsetTop: 0,
        visibleHeight: window.innerHeight,
        open: false,
      })
      return
    }

    // Largest layout height seen while the keyboard looks closed. Comparing
    // VV against this stays correct when iOS also shrinks `innerHeight`.
    let baseline = Math.max(window.innerHeight, Math.round(vv.height))
    const focusTimers: number[] = []

    const update = () => {
      const offsetTop = Math.round(vv.offsetTop)
      const visibleHeight = Math.round(vv.height)
      const layoutH = window.innerHeight
      const layoutOcc = layoutH - visibleHeight

      // Grow baseline only when nothing looks like a keyboard (no occlusion,
      // no VV pan). Shrinking never lowers the baseline mid-session.
      if (layoutOcc < OPEN_THRESHOLD && offsetTop < OPEN_THRESHOLD) {
        baseline = Math.max(baseline, layoutH, visibleHeight)
      } else if (baseline < layoutH) {
        // Orientation / split-screen can grow the layout while keyboard is up.
        baseline = layoutH
      }

      const baselineOcc = baseline - visibleHeight
      const occluded = Math.max(0, Math.round(Math.max(layoutOcc, baselineOcc)))
      const open = occluded > OPEN_THRESHOLD
      // `offsetTop` handles the case where iOS pans the page up to reveal a
      // focused field: that panned distance isn't keyboard, so subtract it out
      // for bottom-anchored lifts.
      const hidden = occluded - offsetTop
      const inset = hidden > OPEN_THRESHOLD ? Math.round(hidden) : 0
      setMetrics({ inset, occluded, offsetTop, visibleHeight, open })
    }

    const clearFocusTimers = () => {
      while (focusTimers.length) {
        window.clearTimeout(focusTimers.pop())
      }
    }

    // iOS often fires focus before VV resize settles (autofocus / tap). A few
    // delayed samples catch the keyboard animation without fighting pan lock.
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target
      if (
        !(t instanceof HTMLElement) ||
        (t.tagName !== 'INPUT' &&
          t.tagName !== 'TEXTAREA' &&
          !t.isContentEditable)
      ) {
        return
      }
      clearFocusTimers()
      update()
      requestAnimationFrame(update)
      for (const ms of [50, 150, 300, 500]) {
        focusTimers.push(window.setTimeout(update, ms))
      }
    }

    const onFocusOut = () => {
      clearFocusTimers()
      // Dismiss animation — sample again as VV grows back.
      focusTimers.push(window.setTimeout(update, 50))
      focusTimers.push(window.setTimeout(update, 300))
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('focusin', onFocusIn)
    window.addEventListener('focusout', onFocusOut)
    return () => {
      clearFocusTimers()
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('focusout', onFocusOut)
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
