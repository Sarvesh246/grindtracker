'use client'
import { useEffect, useState } from 'react'

// iOS (especially in standalone PWA mode) does not shrink the layout viewport
// when the on-screen keyboard opens — it shrinks the *visual* viewport and pans
// it within the layout viewport so the focused field stays visible. A
// position:fixed; bottom:0 bar is pinned to the layout viewport, so during the
// pan it visibly rides up mid-content and slides around as you scroll.
//
// This hook reports the offset (px) that a fixed bottom bar must apply to sit
// flush against the *visible* bottom edge:
//   - positive while the keyboard is up (bar rides on top of the keyboard),
//     tracking the visual-viewport bottom continuously as you scroll;
//   - negative ONLY for a genuine stranded pan — when iOS leaves the layout
//     viewport panned past its resting position after the keyboard dismisses (a
//     standalone-PWA WebKit bug) — and only once the viewport has settled;
//   - 0 in every other state, i.e. plain bottom:0.
//
// History / guard rails (this measurement has burned us repeatedly — see the
// git log on RestTimerBar and this file):
//   * The keyboard-closed resting target is ALWAYS 0. A negative `gap` while the
//     keyboard is closed is usually transient rubber-band overscroll, which
//     springs back within a few hundred ms. Applying it per-scroll-frame yanked
//     the bar off the bottom edge and made it slide on every springy scroll
//     (the exact bug). So the negative (strand) correction now engages only
//     after the viewport has been SETTLED for STRAND_SETTLE_MS, distinguishing a
//     persistent stranded pan from a transient overscroll bounce.
//   * The stranded-pan WebKit bug is standalone-only, so the negative correction
//     is gated to standalone display-mode. Regular mobile Safari (dynamic URL
//     toolbar, different mechanics) therefore always resolves to 0 and behaves
//     exactly like the rock-solid dashboard bottom nav.
//   * The positive (keyboard) offset engages only while a text field actually
//     has focus AND the visual viewport is shorter than the layout viewport by
//     more than a real keyboard's worth of pixels.

const KEYBOARD_MIN_PX = 100
// Residual layout-viewport pan (px) worth correcting. Tiny negatives flicker by
// while WebKit settles; a genuine stranding is keyboard-sized.
const STRAND_MIN_PX = 2
// How long the viewport must hold a misaligned reading before we treat it as a
// real stranded pan rather than a transient overscroll bounce.
const STRAND_SETTLE_MS = 300

function editableHasFocus(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

// The stranded-pan correction only models a standalone-PWA WebKit quirk. In a
// regular browser tab the negative branch is pure downside, so we gate it off.
function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  const displayModeStandalone =
    typeof window.matchMedia === 'function' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches)
  return iosStandalone || displayModeStandalone
}

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const standalone = isStandaloneDisplay()
    let raf = 0
    let keyboardWasOpen = false
    let healTimers: number[] = []
    let strandTimer = 0

    // A same-position scrollTo is a no-op for the page but forces WebKit to
    // clamp a leftover viewport pan and re-anchor its fixed layers.
    const reanchor = () => window.scrollTo(window.scrollX, window.scrollY)

    const apply = (next: number) => setInset(prev => (prev === next ? prev : next))

    const gapNow = () => window.innerHeight - vv.height - vv.offsetTop
    const keyboardOpenNow = () => window.innerHeight - vv.height > KEYBOARD_MIN_PX

    const measure = () => {
      raf = 0
      const keyboardOpen = keyboardOpenNow()

      if (keyboardOpen) {
        // Keyboard up: glue continuously to the visible bottom while a field is
        // focused (so it tracks the pan as you scroll); otherwise rest at 0.
        clearTimeout(strandTimer)
        strandTimer = 0
        apply(editableHasFocus() ? Math.max(0, Math.round(gapNow())) : 0)
      } else {
        // Keyboard down: the resting target is plain bottom:0. A negative gap is
        // almost always transient overscroll — never act on it inline. Only a
        // *persistent* misalignment in a standalone PWA is a genuine stranded
        // pan, and even then we re-anchor first and fall back to a negative
        // offset only if WebKit refuses to clamp.
        if (standalone && gapNow() < -STRAND_MIN_PX) {
          if (!strandTimer) {
            strandTimer = window.setTimeout(() => {
              strandTimer = 0
              if (keyboardOpenNow()) return
              if (gapNow() >= -STRAND_MIN_PX) { apply(0); return }
              // Held misaligned with the keyboard closed → real strand. Clamp it.
              reanchor()
              const finalGap = gapNow()
              apply(finalGap < -STRAND_MIN_PX ? Math.round(finalGap) : 0)
            }, STRAND_SETTLE_MS)
          }
          // Leave the current offset untouched while we wait for it to settle —
          // do NOT apply the live negative gap (that's the overscroll slide bug).
        } else {
          clearTimeout(strandTimer)
          strandTimer = 0
          apply(0)
        }
      }

      // Keyboard just closed. Re-anchor now and again after the dismissal
      // animation — a single attempt mid-animation can be a true no-op that
      // never clamps the pan, which is exactly the stranded state above.
      if (keyboardWasOpen && !keyboardOpen) {
        healTimers.forEach(clearTimeout)
        healTimers = [0, 250, 600].map(ms =>
          window.setTimeout(() => {
            reanchor()
            schedule()
          }, ms)
        )
      }
      keyboardWasOpen = keyboardOpen
    }
    // Coalesce the bursty vv scroll/resize streams into one measure per frame.
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }

    vv.addEventListener('resize', schedule)
    // 'scroll' fires when vv.offsetTop changes — i.e. while the user scrolls
    // with the keyboard open — which is exactly when the bar must re-glue.
    vv.addEventListener('scroll', schedule)
    // Page scrolls don't move vv.offsetTop, but they're when WebKit may clamp
    // (or fail to clamp) a stranded pan — re-measure so the bar tracks either way.
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('focusin', schedule)
    window.addEventListener('focusout', schedule)
    measure()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (strandTimer) clearTimeout(strandTimer)
      healTimers.forEach(clearTimeout)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('focusin', schedule)
      window.removeEventListener('focusout', schedule)
    }
  }, [])

  return inset
}
