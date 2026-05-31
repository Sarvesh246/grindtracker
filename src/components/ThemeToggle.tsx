'use client'
import { useTheme } from '@/lib/contexts/ThemeContext'

/**
 * Circular light/dark toggle. A single button whose sun and moon glyphs
 * cross-fade and rotate as the theme flips (150ms ease, per the design system;
 * the global prefers-reduced-motion rule zeroes the transition automatically).
 * Sized to sit beside the kg/lb pill in both the TopNav and Profile settings.
 */
export default function ThemeToggle({ size = 30 }: { size?: number }) {
  const { theme, toggleTheme } = useTheme()
  const isLight = theme === 'light'
  const icon = Math.round(size * 0.56)

  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${isLight ? 'dark' : 'light'} mode`}
      title={`Switch to ${isLight ? 'dark' : 'light'} mode`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--surface-elevated)',
        border: '1px solid var(--border)',
        borderRadius: '9999px',
        width: `${size}px`,
        height: `${size}px`,
        padding: 0,
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        color: 'var(--text-primary)',
      }}
    >
      {/* Sun + moon are stacked; the active one is shown, the other rotates out. */}
      <span
        style={{
          position: 'absolute',
          display: 'flex',
          transition: 'opacity 150ms ease, transform 150ms ease',
          opacity: isLight ? 1 : 0,
          transform: isLight ? 'rotate(0deg) scale(1)' : 'rotate(-90deg) scale(0.4)',
        }}
      >
        {/* Sun */}
        <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      </span>
      <span
        style={{
          position: 'absolute',
          display: 'flex',
          transition: 'opacity 150ms ease, transform 150ms ease',
          opacity: isLight ? 0 : 1,
          transform: isLight ? 'rotate(90deg) scale(0.4)' : 'rotate(0deg) scale(1)',
        }}
      >
        {/* Moon */}
        <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </span>
    </button>
  )
}
