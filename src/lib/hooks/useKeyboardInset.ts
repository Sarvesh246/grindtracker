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
//   - positive while the keyboard is up (bar rides on top of the keyboard);
//   - negative when the keyboard is closed but WebKit left the layout viewport
//     panned past its resting position — a standalone-PWA bug that otherwise
//     strands fixed bars mid-screen, sliding around on every scroll;
//   - 0 in the normal aligned state, i.e. plain bottom:0.
//
// Guard rails (this measurement has burned us before — see the git history on
// RestTimerBar): the positive (keyboard) offset engages only while a text field
// actually has focus AND the visual viewport is shorter than the layout
// viewport by more than a real keyboard's worth of pixels. The negative
// (stranded-pan) offset engages only when the keyboard is fully closed and the
// misalignment exceeds a couple of pixels, so rubber-band overscroll and
// safe-area quirks still report 0.

const KEYBOARD_MIN_PX = 100
// Residual layout-viewport pan (px) worth correcting. Tiny negatives can
// flicker by while WebKit settles; a genuine stranding is keyboard-sized.
const STRAND_MIN_PX = 2

function editableHasFocus(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let raf = 0
    let keyboardWasOpen = false
    let healTimers: number[] = []

    // A same-position scrollTo is a no-op for the page but forces WebKit to
    // clamp a leftover viewport pan and re-anchor its fixed layers.
    const reanchor = () => window.scrollTo(window.scrollX, window.scrollY)

    const measure = () => {
      raf = 0
      // Distance from the layout-viewport bottom down to the visual-viewport
      // bottom. Positive = keyboard covering the bottom; negative = layout
      // viewport panned up past its resting position (stranded fixed bars).
      const gap = window.innerHeight - vv.height - vv.offsetTop
      const keyboardOpen = window.innerHeight - vv.height > KEYBOARD_MIN_PX
      let next = 0
      if (keyboardOpen) {
        if (editableHasFocus()) next = Math.max(0, Math.round(gap))
      } else if (gap < -STRAND_MIN_PX) {
        next = Math.round(gap)
      }
      setInset(prev => (prev === next ? prev : next))

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
