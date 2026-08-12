'use client'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

export type Theme = 'dark' | 'light'

const PREF_KEY = 'grind_theme_pref'

// Mobile browser chrome color, kept in sync with --bg per theme.
export const THEME_COLOR: Record<Theme, string> = {
  dark: '#0f0f0f',
  light: '#ecebe7',
}

/** Coach page sheet / elevated chrome — matches CSS `--surface`. */
export const SURFACE_THEME_COLOR: Record<Theme, string> = {
  dark: '#1a1a1a',
  light: '#ffffff',
}

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
  /** Set theme directly (setup wizard / prefs). */
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
})

type ThemeColorEntry = { id: number; color: string }

let themeColorSeq = 0
let themeColorStack: ThemeColorEntry[] = []
let themeColorFlushTimer: ReturnType<typeof setTimeout> | null = null

function readCookieTheme(): Theme | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)grind_theme_pref=(dark|light)\b/)
  return match ? (match[1] as Theme) : null
}

function persistTheme(theme: Theme) {
  // Cookie is the source of truth so the server can emit the right <html class>
  // on the next request (no first-paint flash, no hydration mismatch).
  // localStorage is written too for resilience / backwards compatibility.
  try {
    document.cookie = `${PREF_KEY}=${theme};path=/;max-age=31536000;samesite=lax`
  } catch {
    // ignore — non-browser or restricted context
  }
  try {
    window.localStorage.setItem(PREF_KEY, theme)
  } catch {
    // ignore — private mode / sandboxed context
  }
}

function readDomTheme(): Theme {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark'
}

function effectiveThemeColor(theme: Theme): string {
  const top = themeColorStack[themeColorStack.length - 1]
  return top?.color ?? THEME_COLOR[theme]
}

/**
 * Write theme-color meta. When `force` is set (restore after a full-bleed
 * overlay), bounce through a sibling color and replace the meta node — iOS
 * standalone often ignores a no-op attribute write after sampling overlay
 * pixels under the status bar.
 */
function writeThemeColorMeta(color: string, force = false) {
  if (typeof document === 'undefined') return

  const ensureMeta = (): HTMLMetaElement => {
    let meta = document.querySelector(
      'meta[name="theme-color"]',
    ) as HTMLMetaElement | null
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    return meta
  }

  // Keep html/body paint aligned with chrome — iOS can re-sample the top
  // band after a sheet exit even when the meta tag is already correct.
  const syncShellBackground = (c: string) => {
    document.documentElement.style.backgroundColor = c
    document.body.style.backgroundColor = c
  }

  if (!force) {
    ensureMeta().setAttribute('content', color)
    syncShellBackground(color)
    return
  }

  const theme = readDomTheme()
  // Far enough from both --bg and --surface that WebKit can't treat it as a
  // no-op relative to the stuck olive/gray sample.
  const bounce = theme === 'light' ? '#d0d0d0' : '#000000'

  const metas = document.querySelectorAll('meta[name="theme-color"]')
  if (metas.length === 0) {
    const meta = ensureMeta()
    meta.setAttribute('content', bounce)
  } else {
    metas.forEach(meta => meta.setAttribute('content', bounce))
  }
  syncShellBackground(bounce)

  const paint = () => {
    // Replace the node — attribute-only tweaks are flaky in iOS PWAs.
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove())
    const fresh = document.createElement('meta')
    fresh.setAttribute('name', 'theme-color')
    fresh.setAttribute('content', color)
    document.head.appendChild(fresh)
    syncShellBackground(color)
  }

  requestAnimationFrame(() => {
    paint()
    // Second paint after layout — sheet exit / safe-area may still be settling.
    requestAnimationFrame(paint)
  })
}

function flushThemeColor(opts?: { force?: boolean }) {
  if (typeof document === 'undefined') return
  writeThemeColorMeta(effectiveThemeColor(readDomTheme()), opts?.force === true)
}

function scheduleForcedThemeColorHeals(delaysMs: number[]) {
  if (themeColorFlushTimer != null) clearTimeout(themeColorFlushTimer)
  flushThemeColor({ force: true })
  let i = 0
  const scheduleNext = () => {
    if (i >= delaysMs.length) {
      themeColorFlushTimer = null
      return
    }
    const delay = delaysMs[i++]
    themeColorFlushTimer = setTimeout(() => {
      flushThemeColor({ force: true })
      scheduleNext()
    }, delay)
  }
  scheduleNext()
}

/** Apply the theme to <html> and the browser chrome meta. Safe to call client-side only. */
function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('light', theme === 'light')
  flushThemeColor()
}

/**
 * Re-assert the effective theme-color (stack top, else theme default).
 * Prefer `useThemeColor` for overlays; this remains for one-shot heal paths
 * (Coach page close — force iOS to drop a stuck surface/olive sample).
 */
export function refreshThemeColor() {
  // Coach exit is ~560ms; a late pass catches post-unmount safe-area settle.
  scheduleForcedThemeColorHeals([600, 700])
}

function pushThemeColor(color: string): number {
  const id = ++themeColorSeq
  themeColorStack.push({ id, color })
  flushThemeColor()
  return id
}

function popThemeColor(id: number) {
  const before = themeColorStack.length
  themeColorStack = themeColorStack.filter(e => e.id !== id)
  if (themeColorStack.length === before) return
  // Restoring default (or a lower overlay) after Coach — force iOS re-sample.
  scheduleForcedThemeColorHeals([600, 700])
}

/**
 * Push an override onto the theme-color stack while `color` is non-null.
 * Cleanup pops that entry and force-restores the previous/default color.
 * Prefer for transient overlays that intentionally recolor chrome.
 * Coach page sheet deliberately does NOT use this (keeps app --bg) — pushing
 * --surface was the root cause of stuck olive/gray status bars on iOS PWAs.
 */
export function useThemeColor(color: string | null) {
  const idRef = useRef<number | null>(null)

  useEffect(() => {
    if (color == null) {
      if (idRef.current != null) {
        popThemeColor(idRef.current)
        idRef.current = null
      }
      return
    }

    if (idRef.current != null) {
      // Update in place when the override color changes (theme toggle).
      const entry = themeColorStack.find(e => e.id === idRef.current)
      if (entry && entry.color !== color) {
        entry.color = color
        flushThemeColor()
      }
      return () => {
        if (idRef.current != null) {
          popThemeColor(idRef.current)
          idRef.current = null
        }
      }
    }

    idRef.current = pushThemeColor(color)
    return () => {
      if (idRef.current != null) {
        popThemeColor(idRef.current)
        idRef.current = null
      }
    }
  }, [color])
}

export function ThemeProvider({
  children,
  // Default dark — a fresh visitor with no saved preference always opens in dark.
  initialTheme = 'dark',
}: {
  children: React.ReactNode
  /** Resolved on the server from the cookie so the first render is deterministic. */
  initialTheme?: Theme
}) {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  // One-time migration for users who saved a preference before the cookie
  // existed: if the server sent no cookie but localStorage has a value, adopt
  // it after mount (no hydration mismatch — first render matched the server)
  // and write the cookie so every later server render is correct and flash-free.
  useEffect(() => {
    if (readCookieTheme()) return
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(PREF_KEY)
    } catch {
      stored = null
    }
    if (stored === 'dark' || stored === 'light') {
      persistTheme(stored)
      applyTheme(stored)
      // Intentional post-mount sync from a browser-only store (localStorage is
      // unavailable during SSR). Reading it in the initializer would reintroduce
      // the server/client hydration mismatch this design avoids.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTheme(stored)
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      persistTheme(next)
      applyTheme(next)
      return next
    })
  }, [])

  const setThemePref = useCallback((next: Theme) => {
    setTheme(prev => {
      if (prev === next) return prev
      persistTheme(next)
      applyTheme(next)
      return next
    })
  }, [])

  const contextValue = useMemo(
    () => ({ theme, toggleTheme, setTheme: setThemePref }),
    [theme, toggleTheme, setThemePref],
  )

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
