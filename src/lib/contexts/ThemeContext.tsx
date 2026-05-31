'use client'
import { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const PREF_KEY = 'grind_theme_pref'

// Mobile browser chrome color, kept in sync with --bg per theme.
const THEME_COLOR: Record<Theme, string> = {
  dark: '#0f0f0f',
  light: '#ecebe7',
}

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
})

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

/** Apply the theme to <html> and the browser chrome meta. Safe to call client-side only. */
function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('light', theme === 'light')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[theme])
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

  function toggleTheme() {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      persistTheme(next)
      applyTheme(next)
      return next
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
