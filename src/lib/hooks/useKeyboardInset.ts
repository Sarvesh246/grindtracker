'use client'
import { useEffect, useState } from 'react'

// On iOS (especially in a standalone PWA) the on-screen keyboard does NOT shrink
// the layout viewport — it shrinks the *visual* viewport and may pan it. A
// `position: fixed; bottom: 0` bar pins to the layout viewport, so the keyboard
// covers it. This hook returns how many px the bar must lift its `bottom` by to
// sit on top of the keyboard while typing, and 0 in EVERY other state.
//
// The hard rule: a positive lift is only ever returned while a text field is
// actually focused (i.e. the keyboard is genuinely up). With nothing focused the
// answer is always 0 — the bottom — so returning from the background, rotating,
// switching apps, or any stale visualViewport reading can never strand the bar
// mid-screen. (That foreground-resume case is exactly the bug this guards: iOS
// frequently does not fire a visualViewport event when a PWA is re-foregrounded,
// which used to leave a phantom positive offset stuck on screen.)
//
// Resting stability of the bars themselves comes from the fixed, non-scrolling
// app shell (.app-shell) — see globals.css. This hook only handles the keyboard.

function editableFocused(): boolean {
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
      // No field focused → the keyboard cannot be up → pin to the bottom.
      if (!editableFocused()) {
        setInset(0)
        return
      }
      // gap = the slice of the layout viewport hidden at the bottom = the
      // keyboard's height. Lift the bar by exactly that so it rides on top of it.
      const gap = window.innerHeight - vv.height - vv.offsetTop
      setInset(gap > 1 ? Math.round(gap) : 0)
    }
    // Coalesce the bursty event streams into one measurement per frame.
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }

    // Keyboard open/close + pan while scrolling with it up.
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    // Focus changes flip whether a lift is even allowed.
    window.addEventListener('focusin', schedule)
    window.addEventListener('focusout', schedule)
    // Foreground-resume / rotation: force a clean re-measure even when iOS
    // doesn't fire a visualViewport event, so a stale lift can't persist.
    const onVisible = () => { if (!document.hidden) schedule() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', schedule)
    window.addEventListener('focus', schedule)
    window.addEventListener('orientationchange', schedule)

    measure()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('focusin', schedule)
      window.removeEventListener('focusout', schedule)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', schedule)
      window.removeEventListener('focus', schedule)
      window.removeEventListener('orientationchange', schedule)
    }
  }, [])

  return inset
}
