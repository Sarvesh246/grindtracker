'use client'
import { useEffect, useState } from 'react'

// iOS (especially in standalone PWA mode) does not shrink the layout viewport
// when the on-screen keyboard opens — it shrinks the *visual* viewport and pans
// it within the layout viewport so the focused field stays visible. A
// position:fixed; bottom:0 bar is pinned to the layout viewport, so during the
// pan it visibly rides up mid-content and slides around as you scroll.
//
// This hook reports the signed distance (px) from the layout-viewport bottom
// (where `bottom: 0` pins) to the visual-viewport bottom (the visible screen
// edge) so fixed bottom bars can sit flush against the visible edge.
//
//   gap = innerHeight − vv.height − vv.offsetTop
//
// Two failure states, one number:
// - Keyboard OPEN (gap > 0): the visual viewport is shorter than the layout
//   viewport, so the bar must be lifted to sit on top of the keyboard.
// - Residual pan (gap < 0): after the keyboard closes, standalone-PWA WebKit
//   can leave the layout viewport panned UP (vv.offsetTop > 0 at rest, no
//   keyboard), stranding bottom:0 bars mid-screen with content visible below
//   them — and plain scrolling does not always clamp the pan back. A negative
//   inset pushes the bar back down to the visible bottom edge for as long as
//   the pan persists.
//
// Guard rails (this measurement has burned us before — see the git history on
// RestTimerBar): the POSITIVE inset engages only while a text field actually
// has focus AND the visual viewport is shorter than the layout viewport by
// more than a real keyboard's worth of pixels; the NEGATIVE inset engages only
// when the gap itself is negative, which none of the previously-burned states
// produce — rubber-band overscroll keeps offsetTop at 0 (gap 0), and
// pinch-zoom shrinks vv.height (gap positive). Every other state reports 0,
// which leaves the bar exactly where plain bottom:0 puts it.

const KEYBOARD_MIN_PX = 100

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

    const measure = () => {
      raf = 0
      const keyboard = window.innerHeight - vv.height
      const keyboardOpen = keyboard > KEYBOARD_MIN_PX
      const gap = Math.round(window.innerHeight - vv.height - vv.offsetTop)
      const next =
        keyboardOpen && editableHasFocus()
          ? Math.max(0, gap) // keyboard up — lift the bar onto it
          : Math.min(0, gap) // residual pan — push the bar back to the edge
      setInset(prev => (prev === next ? prev : next))

      // Keyboard just closed. In standalone iOS PWAs WebKit can leave the
      // layout viewport panned past its resting position, which strands
      // position:fixed elements mid-screen until the next real scroll. A
      // same-position scrollTo is a no-op for the page but forces WebKit to
      // clamp the pan and re-anchor its fixed layers.
      if (keyboardWasOpen && !keyboardOpen) {
        requestAnimationFrame(() => window.scrollTo(window.scrollX, window.scrollY))
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
    window.addEventListener('focusin', schedule)
    window.addEventListener('focusout', schedule)
    measure()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('focusin', schedule)
      window.removeEventListener('focusout', schedule)
    }
  }, [])

  return inset
}
