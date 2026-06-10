'use client'
import { useEffect, useState } from 'react'

// iOS (especially in standalone PWA mode) does not shrink the layout viewport
// when the on-screen keyboard opens — it shrinks the *visual* viewport and pans
// it within the layout viewport so the focused field stays visible. A
// position:fixed; bottom:0 bar is pinned to the layout viewport, so during the
// pan it visibly rides up mid-content and slides around as you scroll.
//
// This hook reports the distance (px) from the layout-viewport bottom to the
// visual-viewport bottom so fixed bottom bars can sit flush against the visible
// edge (i.e. on top of the keyboard) instead of detaching.
//
// Guard rails (this measurement has burned us before — see the git history on
// RestTimerBar): the offset engages only while a text field actually has focus
// AND the visual viewport is shorter than the layout viewport by more than a
// real keyboard's worth of pixels. Any other state — rubber-band overscroll,
// pinch-zoom remnants, safe-area quirks, stale post-dismiss values — reports 0,
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

    const measure = () => {
      raf = 0
      const keyboard = window.innerHeight - vv.height
      const next =
        keyboard > KEYBOARD_MIN_PX && editableHasFocus()
          ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
          : 0
      setInset(prev => (prev === next ? prev : next))
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
