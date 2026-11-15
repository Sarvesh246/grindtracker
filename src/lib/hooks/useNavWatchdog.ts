'use client'
import { useCallback, useEffect, useRef } from 'react'

/**
 * How long a tab tap may sit without the page changing before we stop waiting
 * on the client router and load the page the ordinary way.
 */
export const NAV_WATCHDOG_MS = 8_000

const pathOf = (href: string) => href.split(/[?#]/)[0]

/** A tap is only "stuck" if it was heading somewhere other than where we are. */
export function shouldHardNavigate(currentPath: string, targetHref: string): boolean {
  return pathOf(targetHref) !== currentPath
}

/**
 * A client-side navigation waits for the server's render of the next page, and
 * has no timeout of its own. When that request hangs — a connection that died
 * while the installed app was backgrounded, a slow auth check — the tap
 * vibrates and then nothing happens until the browser gives up (~30s). Call the
 * returned function from a tab's onClick: if the path hasn't changed after
 * NAV_WATCHDOG_MS, fall back to a full page load, which opens a fresh
 * connection and is served by the service worker's own short timeout.
 */
export function useNavWatchdog(pathname: string): (href: string) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pathRef = useRef(pathname)

  // Landing on a new path means the navigation worked: stand down.
  useEffect(() => {
    pathRef.current = pathname
    clearTimeout(timer.current)
  }, [pathname])
  useEffect(() => () => clearTimeout(timer.current), [])

  return useCallback((href: string) => {
    clearTimeout(timer.current)
    if (!shouldHardNavigate(pathRef.current, href)) return
    timer.current = setTimeout(() => {
      // Don't yank the page if the user has since left the app, or already arrived.
      if (document.visibilityState !== 'visible') return
      if (shouldHardNavigate(pathRef.current, href)) window.location.assign(href)
    }, NAV_WATCHDOG_MS)
  }, [])
}
