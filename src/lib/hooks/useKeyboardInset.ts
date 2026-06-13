'use client'
import { useEffect, useState } from 'react'

// On iOS (especially in a standalone PWA) the on-screen keyboard does NOT shrink
// the layout viewport — it shrinks the *visual* viewport and may pan it. A
// `position: fixed; bottom: 0` bar pins to the layout viewport, so the keyboard
// covers it. This hook returns how many px the bar must lift its `bottom` by to
// sit flush on top of the keyboard (the visible bottom edge), and 0 at rest.
//
// Why this can stay this small: the app is a fixed, non-scrolling shell
// (.app-shell) and only .app-main scrolls. The <body> never scrolls, so it can
// never be left panned after the keyboard dismisses — which is the bug all the
// old strand-timer / re-anchor machinery existed to paper over. With body scroll
// gone, the resting state is always a clean 0 and this is just: lift by whatever
// covers the bottom, drop back to 0 when it's gone.
//
//   gap = layout-viewport height − (visual-viewport height + its top offset)
//       = the slice of the layout viewport hidden at the bottom (the keyboard).
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    let raf = 0
    const measure = () => {
      raf = 0
      const gap = window.innerHeight - vv.height - vv.offsetTop
      // Sub-pixel rounding noise at rest → treat anything tiny as flush (0).
      setInset(gap > 1 ? Math.round(gap) : 0)
    }
    // Coalesce the bursty resize/scroll streams into one measurement per frame.
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }

    // 'resize' fires when the keyboard opens/closes; 'scroll' fires as the visual
    // viewport pans while scrolling with the keyboard up — re-glue on both.
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    measure()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
    }
  }, [])

  return inset
}
