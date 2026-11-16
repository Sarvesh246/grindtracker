'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isRenderStale } from '@/lib/cache/renderFreshness'

const TRIED_KEY = 'grind_fresh_tried'
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Re-fetches a server-rendered screen that reached the user long after it was
 * rendered, and reports `true` until the fresh copy lands so the caller can
 * hold back anything that would act on old data.
 *
 * One request when the screen appears (launch, or the PWA coming back to the
 * foreground) and only if the render is past its window — not a poll.
 *
 * @param renderedAt server clock at render, passed down from the page
 */
export function useRenderFreshness(renderedAt: number, enabled = true): boolean {
  const router = useRouter()
  const [stale, setStale] = useState(false)
  // Starts on the server's clock, because that is all a replayed document
  // carries. Once a refresh lands it moves to the device's own clock, so a
  // phone whose clock runs fast can't read every fresh payload as stale.
  const knownFreshAt = useRef(renderedAt)
  const seen = useRef(renderedAt)

  useIsoLayoutEffect(() => {
    if (seen.current === renderedAt) return
    // The component stayed mounted and got new props: that only happens when a
    // refresh came back from the network.
    seen.current = renderedAt
    knownFreshAt.current = Date.now()
    setStale(false)
  }, [renderedAt])

  useIsoLayoutEffect(() => {
    if (!enabled) return
    const check = (onMount: boolean) => {
      if (document.visibilityState !== 'visible') return
      if (!isRenderStale(knownFreshAt.current, Date.now())) return
      setStale(true)
      // Offline there is nothing to fetch; `online` below picks it back up.
      if (navigator.onLine === false) return
      if (onMount) {
        // A refresh that fails outright makes Next reload the document, which
        // the service worker may answer with the same saved copy. Try once per
        // copy so a bad connection can't turn that into a reload loop.
        const stamp = String(seen.current)
        try {
          if (sessionStorage.getItem(TRIED_KEY) === stamp) return
          sessionStorage.setItem(TRIED_KEY, stamp)
        } catch {
          /* no storage — the visibility path still retries */
        }
      }
      router.refresh()
    }
    const recheck = () => check(false)
    // Before paint, so the stale screen never shows its prompts for a frame.
    check(true)
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('pageshow', recheck)
    window.addEventListener('online', recheck)
    return () => {
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('pageshow', recheck)
      window.removeEventListener('online', recheck)
    }
  }, [enabled, router])

  return stale
}
