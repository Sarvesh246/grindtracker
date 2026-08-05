'use client'
import { useEffect, useState } from 'react'

/**
 * Height (CSS px) currently hidden behind the on-screen keyboard, via the
 * visualViewport API.
 *
 * On iOS the software keyboard shrinks the *visual* viewport but leaves the
 * *layout* viewport unchanged, so a `position: fixed` bottom-anchored element
 * (a bottom sheet, a toast, an input near the bottom) stays pinned behind the
 * keyboard where the user can't see it. Measuring the gap between the layout
 * viewport (`window.innerHeight`) and the visual viewport gives the amount to
 * lift that content up by.
 *
 * Returns 0 when no keyboard is shown — or when visualViewport is unavailable —
 * so callers can use it directly as a bottom offset without branching. A small
 * threshold ignores the sub-pixel jitter and address-bar show/hide that would
 * otherwise register as a phantom keyboard.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return

    const update = () => {
      // `offsetTop` handles the case where iOS pans the page up to reveal a
      // focused field: that panned distance isn't keyboard, so subtract it out.
      const hidden = window.innerHeight - vv.height - vv.offsetTop
      const next = hidden > 60 ? Math.round(hidden) : 0
      setInset(prev => (prev === next ? prev : next))
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)

    // iOS fires `resize` when the keyboard shows/hides outright, but not when
    // only its QuickType/predictive-text toolbar changes height as the user
    // keeps typing — the lift then stays sized for the keyboard's initial
    // height and the last inch of a sheet ends up hidden behind the taller
    // bar until the keyboard is dismissed and reopened to force a fresh
    // measurement. While a text field is actively focused/being typed into,
    // poll as a fallback; it stops itself shortly after typing goes quiet so
    // it isn't running for the whole session.
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let stopTimer: ReturnType<typeof setTimeout> | null = null

    const startPolling = () => {
      if (!pollTimer) pollTimer = setInterval(update, 120)
      if (stopTimer) clearTimeout(stopTimer)
      stopTimer = setTimeout(() => {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      }, 1500)
    }

    const isTextField = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

    const onFocusIn = (e: FocusEvent) => { if (isTextField(e.target)) startPolling() }
    const onInput = (e: Event) => { if (isTextField(e.target)) startPolling() }

    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('input', onInput)

    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('input', onInput)
      if (pollTimer) clearInterval(pollTimer)
      if (stopTimer) clearTimeout(stopTimer)
    }
  }, [])

  return inset
}
