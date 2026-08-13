'use client'

import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Keep Tab/Shift+Tab inside `containerRef` while `active`. Does not handle Escape —
 * callers keep their own dismiss keys (Coach morph, ShareCard, etc.).
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const root = containerRef.current
      if (!root) return

      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter(
        el =>
          !el.hasAttribute('disabled') &&
          el.tabIndex !== -1 &&
          !el.closest('[aria-hidden="true"]'),
      )

      if (nodes.length === 0) {
        e.preventDefault()
        root.focus()
        return
      }

      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const focused = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        if (!focused || focused === first || !root.contains(focused)) {
          e.preventDefault()
          last.focus()
        }
      } else if (!focused || focused === last || !root.contains(focused)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [active, containerRef])
}
