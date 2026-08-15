/**
 * iOS PWA visual-viewport / touch-matrix healer.
 *
 * Standalone WebKit (especially iOS 26+) periodically desyncs where pixels
 * paint from where taps land. The miss is vertical only and usually ~status-
 * bar height (47–59px) — tapping Save hits Add Set below it. Opening the
 * keyboard forces a visualViewport reset, which is why that "fixes" hits
 * until the next drift (resume, keyboard dismiss, Coach sheet, theme-color
 * resample, overscroll).
 *
 * Same-position `scrollTo` is a no-op for the page but asks WebKit to clamp
 * a leftover VV pan and rebuild the touch/view matrix. We already used that
 * after Coach close; this mounts it app-wide. Do not put `transform` on
 * `.app-shell` — that creates a containing block and strands `position:fixed`
 * bars (see globals.css).
 */

import { isEditableElement, isVisualViewportZoomed } from '@/lib/hooks/useKeyboardInset'
import {
  lastFingerPoint,
  pickSmallestContainingHost,
  pointInRect,
  recordFinger,
  rectFromDOMRect,
  touchHitCandidates,
  type HitHost,
} from '@/lib/utils/touchHit'

const HEAL_EVENT = 'grind:viewport-heal'

/** Residual pan large enough to be a stuck keyboard/status-bar offset, not jitter. */
export const STUCK_PAN_PX = 1

const INTERACTIVE_SEL =
  'button, a[href], input, textarea, select, [role="button"], [data-haptic]'

const SKIP_RETARGET_SEL =
  '.recharts-wrapper, [data-haptic-overlay], [data-no-touch-retarget], .toast-slide, [data-swipe-ignore]'

export function isIosTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return (
    (/iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)) ||
    (navigator.maxTouchPoints > 1 && /MacIntel/.test(navigator.platform))
  )
}

export function shouldClampVisualViewportPan(opts: {
  editableFocused: boolean
  zoomed: boolean
  offsetTop: number
  offsetLeft: number
}): boolean {
  if (opts.editableFocused || opts.zoomed) return false
  return Math.abs(opts.offsetTop) > STUCK_PAN_PX || Math.abs(opts.offsetLeft) > STUCK_PAN_PX
}

/** Poke WebKit to re-clamp a leftover visual-viewport pan. Safe no-op elsewhere. */
export function healIosViewport(): void {
  if (typeof window === 'undefined') return
  try {
    window.scrollTo(0, 0)
    window.scrollTo(window.scrollX, window.scrollY)
  } catch {
    // ignore
  }
}

function healIfIdle(): void {
  if (typeof document === 'undefined') return
  if (isEditableElement(document.activeElement)) return
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  if (vv && isVisualViewportZoomed(vv.scale)) return
  healIosViewport()
  try {
    window.dispatchEvent(new Event(HEAL_EVENT))
  } catch {
    // ignore
  }
}

function scheduleHeals(delaysMs: number[]): number[] {
  const ids: number[] = []
  healIfIdle()
  if (typeof window === 'undefined') return ids
  try {
    window.requestAnimationFrame(() => healIfIdle())
  } catch {
    // ignore
  }
  for (const ms of delaysMs) {
    ids.push(window.setTimeout(healIfIdle, ms))
  }
  return ids
}

function collectInteractiveHosts(): HitHost<HTMLElement>[] {
  const hosts: HitHost<HTMLElement>[] = []
  for (const node of document.querySelectorAll<HTMLElement>(INTERACTIVE_SEL)) {
    if (node.closest(SKIP_RETARGET_SEL)) continue
    if (node.getAttribute('aria-hidden') === 'true') continue
    if (node instanceof HTMLButtonElement || node instanceof HTMLInputElement) {
      if (node.disabled) continue
    }
    if (node.getAttribute('aria-disabled') === 'true') continue
    const r = node.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    hosts.push({ el: node, rect: rectFromDOMRect(r) })
  }
  return hosts
}

export function interactiveHostAtFinger(
  x: number,
  y: number,
  offsetLeft = 0,
  offsetTop = 0,
): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return pickSmallestContainingHost(
    collectInteractiveHosts(),
    touchHitCandidates(x, y, offsetLeft, offsetTop),
  )
}

/**
 * Capture-phase click retarget: if the native target's box does not contain
 * the finger, fire the control that visually does. Skips haptic overlays
 * (those retarget inside `attachHapticOverlay` so the system tick still
 * counts) and charts.
 */
function setupClickRetarget(): () => void {
  let retargeting = false

  const onClickCapture = (e: MouseEvent) => {
    if (retargeting) return
    if (!e.isTrusted) return
    const finger = lastFingerPoint()
    if (!finger) return
    const raw = e.target
    if (!(raw instanceof Element)) return
    if (raw.closest(SKIP_RETARGET_SEL)) return

    const vv = window.visualViewport
    const offsetLeft = vv?.offsetLeft ?? 0
    const offsetTop = vv?.offsetTop ?? 0
    const points = touchHitCandidates(finger.x, finger.y, offsetLeft, offsetTop)

    const closest = raw.closest(INTERACTIVE_SEL)
    if (closest instanceof HTMLElement) {
      const r = rectFromDOMRect(closest.getBoundingClientRect())
      if (points.some(p => pointInRect(p, r))) return
      // This bug is vertical-down only (status bar / leftover VV pan). Don't
      // steal a click that landed above or beside the finger.
      if (r.top <= finger.y + 2) return
    }

    const hit = interactiveHostAtFinger(finger.x, finger.y, offsetLeft, offsetTop)
    if (!hit || hit === closest) return
    if (closest instanceof HTMLElement && (hit.contains(closest) || closest.contains(hit))) {
      return
    }

    e.stopImmediatePropagation()
    e.preventDefault()
    retargeting = true
    try {
      try {
        hit.focus({ preventScroll: true })
      } catch {
        // non-focusable is fine
      }
      hit.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
      )
    } finally {
      retargeting = false
    }
  }

  const root = document.documentElement
  root.addEventListener('click', onClickCapture, true)
  return () => {
    root.removeEventListener('click', onClickCapture, true)
  }
}

/**
 * Mount once (HapticsSetup). iOS only — other engines don't have this pan/hit
 * desync. Records the real finger point, clamps leftover VV pan when nothing
 * is focused, and retargets clicks whose native target doesn't match the
 * pixels.
 */
export function setupIosViewportHeal(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {}
  }
  if (!isIosTouchDevice()) return () => {}

  const timers: number[] = []
  const clearTimers = () => {
    while (timers.length) window.clearTimeout(timers.pop())
  }
  const bump = () => {
    clearTimers()
    timers.push(...scheduleHeals([50, 300, 500]))
  }

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return
    recordFinger(e.touches[0].clientX, e.touches[0].clientY)
  }

  const onVvScroll = () => {
    const vv = window.visualViewport
    if (!vv) return
    if (
      shouldClampVisualViewportPan({
        editableFocused: isEditableElement(document.activeElement),
        zoomed: isVisualViewportZoomed(vv.scale),
        offsetTop: vv.offsetTop,
        offsetLeft: vv.offsetLeft,
      })
    ) {
      healIosViewport()
    }
  }

  const onFocusOut = (e: FocusEvent) => {
    // Stay out of the way while iOS pans between fields (weight → reps).
    if (isEditableElement(e.relatedTarget)) return
    bump()
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') bump()
  }

  document.documentElement.addEventListener('touchstart', onTouchStart, {
    capture: true,
    passive: true,
  })
  window.addEventListener('pageshow', bump)
  window.addEventListener('focus', bump)
  window.addEventListener('orientationchange', bump)
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('focusout', onFocusOut)
  const vv = window.visualViewport
  vv?.addEventListener('scroll', onVvScroll)
  vv?.addEventListener('resize', onVvScroll)

  const stopRetarget = setupClickRetarget()
  bump()

  return () => {
    clearTimers()
    stopRetarget()
    document.documentElement.removeEventListener('touchstart', onTouchStart, true)
    window.removeEventListener('pageshow', bump)
    window.removeEventListener('focus', bump)
    window.removeEventListener('orientationchange', bump)
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('focusout', onFocusOut)
    vv?.removeEventListener('scroll', onVvScroll)
    vv?.removeEventListener('resize', onVvScroll)
  }
}
