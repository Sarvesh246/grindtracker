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
/** Pinch-zoom: treat VV scale drift as zoom, never as a keyboard. */
const ZOOM_SCALE_EPS = 0.02

/** Soft spring toward VV targets — iOS fires resize in coarse steps. */
const KB_SPRING_K = 180
const KB_SPRING_C = 26
const KB_SETTLE_POS = 0.4
const KB_SETTLE_VEL = 8

/** True when visualViewport reports pinch-zoom (not Ctrl+/- CSS zoom). */
export function isVisualViewportZoomed(scale: number | undefined | null): boolean {
  return Math.abs((scale ?? 1) - 1) > ZOOM_SCALE_EPS
}

export function isEditableElement(el: EventTarget | null): boolean {
  if (!el || typeof HTMLElement === 'undefined') return false
  if (!(el instanceof HTMLElement)) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable
  )
}

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
 *   baseline and compare VV height against that — but ONLY while an editable
 *   is focused. Browser zoom (Ctrl+/-) also shrinks CSS viewport height and
 *   used to leave a ratcheted baseline stuck "open" until refresh.
 * - Pinch-zoom (`visualViewport.scale ≠ 1`) is forced closed and ignored for
 *   baseline updates.
 * - Autofocus / focus often updates VV a beat late — we remeasure on a short
 *   schedule after `focusin`.
 * - VV resize often jumps in discrete steps; inset/occluded/visibleHeight/
 *   offsetTop are spring-smoothed so bottom-anchored UI eases with the
 *   keyboard instead of stuttering. `open` follows the raw target so layout
 *   can start transitioning as soon as the keyboard appears.
 *
 * A small threshold ignores sub-pixel jitter and address-bar show/hide.
 */
export function useKeyboardMetrics(): KeyboardMetrics {
  const [metrics, setMetrics] = useState<KeyboardMetrics>(IDLE)

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) {
      // Synchronizing with an external system (the browser's visualViewport
      // API) on mount when it's unsupported — the same "no VV, use a static
      // fallback" case handled below for the supported branch, not a
      // derived-from-props reset.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMetrics({
        inset: 0,
        occluded: 0,
        offsetTop: 0,
        visibleHeight: window.innerHeight,
        open: false,
      })
      return
    }

    // Largest layout height seen while an editable is focused and the keyboard
    // looks closed. Comparing VV against this stays correct when iOS also
    // shrinks `innerHeight`. Recalibrated whenever nothing is focused so
    // browser zoom cannot leave a stale tall baseline stuck open.
    let baseline = Math.max(window.innerHeight, Math.round(vv.height))
    const focusTimers: number[] = []

    let target: KeyboardMetrics = {
      inset: 0,
      occluded: 0,
      offsetTop: 0,
      visibleHeight: Math.round(vv.height),
      open: false,
    }
    let display = { ...target }
    let vInset = 0
    let vOccluded = 0
    let vOffsetTop = 0
    let vVisibleHeight = 0
    let raf: number | null = null
    let preferReducedMotion = false
    try {
      preferReducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches
    } catch {
      preferReducedMotion = false
    }

    const motionReduced = () =>
      preferReducedMotion ||
      document.documentElement.classList.contains('reduce-motion')

    const publish = (next: KeyboardMetrics) => {
      setMetrics(prev =>
        prev.inset === next.inset &&
        prev.occluded === next.occluded &&
        prev.offsetTop === next.offsetTop &&
        prev.visibleHeight === next.visibleHeight &&
        prev.open === next.open
          ? prev
          : next,
      )
    }

    const stepAxis = (
      cur: number,
      goal: number,
      vel: number,
      dt: number,
    ): [number, number] => {
      const a = -KB_SPRING_K * (cur - goal) - KB_SPRING_C * vel
      const nextV = vel + a * dt
      return [cur + nextV * dt, nextV]
    }

    const tick = () => {
      raf = null
      if (motionReduced()) {
        display = { ...target }
        vInset = vOccluded = vOffsetTop = vVisibleHeight = 0
        publish(display)
        return
      }

      const dt = 1 / 60
      ;[display.inset, vInset] = stepAxis(display.inset, target.inset, vInset, dt)
      ;[display.occluded, vOccluded] = stepAxis(
        display.occluded,
        target.occluded,
        vOccluded,
        dt,
      )
      ;[display.offsetTop, vOffsetTop] = stepAxis(
        display.offsetTop,
        target.offsetTop,
        vOffsetTop,
        dt,
      )
      ;[display.visibleHeight, vVisibleHeight] = stepAxis(
        display.visibleHeight,
        target.visibleHeight,
        vVisibleHeight,
        dt,
      )

      const settled =
        Math.abs(display.inset - target.inset) < KB_SETTLE_POS &&
        Math.abs(display.occluded - target.occluded) < KB_SETTLE_POS &&
        Math.abs(display.offsetTop - target.offsetTop) < KB_SETTLE_POS &&
        Math.abs(display.visibleHeight - target.visibleHeight) < KB_SETTLE_POS &&
        Math.abs(vInset) < KB_SETTLE_VEL &&
        Math.abs(vOccluded) < KB_SETTLE_VEL &&
        Math.abs(vOffsetTop) < KB_SETTLE_VEL &&
        Math.abs(vVisibleHeight) < KB_SETTLE_VEL

      if (settled) {
        display = { ...target }
        vInset = vOccluded = vOffsetTop = vVisibleHeight = 0
        publish(display)
        return
      }

      // Keep `open` latched to the raw target so CSS/layout can start easing
      // as soon as VV reports a keyboard, while dimensions catch up smoothly.
      publish({ ...display, open: target.open })
      raf = requestAnimationFrame(tick)
    }

    const kickSpring = () => {
      if (motionReduced()) {
        display = { ...target }
        publish(display)
        return
      }
      if (raf == null) raf = requestAnimationFrame(tick)
    }

    const closedTarget = (
      visibleHeight: number,
      offsetTop: number,
    ): KeyboardMetrics => ({
      inset: 0,
      occluded: 0,
      offsetTop,
      visibleHeight,
      open: false,
    })

    const update = () => {
      const offsetTop = Math.round(vv.offsetTop)
      const visibleHeight = Math.round(vv.height)
      const layoutH = window.innerHeight
      const layoutOcc = layoutH - visibleHeight
      const editableFocused = isEditableElement(document.activeElement)

      // Pinch-zoom shrinks VV height like a keyboard — never treat it as one.
      if (isVisualViewportZoomed(vv.scale)) {
        target = closedTarget(visibleHeight, offsetTop)
        kickSpring()
        return
      }

      // No focused field: recalibrate baseline and force closed. Browser zoom
      // (Ctrl+/-) changes CSS viewport size without focusing an input; a
      // ratcheted baseline would otherwise stick `open` until refresh.
      if (!editableFocused) {
        baseline = Math.max(layoutH, visibleHeight)
        target = closedTarget(visibleHeight, offsetTop)
        kickSpring()
        return
      }

      // Grow baseline only when nothing looks like a keyboard (no occlusion,
      // no VV pan). Shrinking never lowers the baseline mid-session while
      // focused — iOS may shrink innerHeight with the keyboard.
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
      target = { inset, occluded, offsetTop, visibleHeight, open }
      kickSpring()
    }

    const clearFocusTimers = () => {
      while (focusTimers.length) {
        window.clearTimeout(focusTimers.pop())
      }
    }

    // iOS often fires focus before VV resize settles (autofocus / tap). A few
    // delayed samples catch the keyboard animation without fighting pan lock.
    const onFocusIn = (e: FocusEvent) => {
      if (!isEditableElement(e.target)) return
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
      if (raf != null) cancelAnimationFrame(raf)
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
