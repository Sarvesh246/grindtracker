'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUnit } from '@/lib/contexts/UnitContext'

const tabs = [
  {
    href: '/home',
    label: 'Home',
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    href: '/log',
    label: 'Log',
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
        <line x1="8" y1="6" x2="8" y2="18" />
        <line x1="16" y1="6" x2="16" y2="18" />
        <line x1="5" y1="9" x2="8" y2="9" />
        <line x1="16" y1="9" x2="19" y2="9" />
        <line x1="5" y1="15" x2="8" y2="15" />
        <line x1="16" y1="15" x2="19" y2="15" />
        <line x1="8" y1="9" x2="16" y2="9" />
        <line x1="8" y1="15" x2="16" y2="15" />
      </svg>
    ),
  },
  {
    href: '/progress',
    label: 'Progress',
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
        <polyline points="3 17 9 11 13 15 21 7" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    href: '/leaderboard',
    label: 'Ranks',
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
        <rect x="2" y="13" width="6" height="8" rx="1" />
        <rect x="9" y="9" width="6" height="12" rx="1" />
        <rect x="16" y="5" width="6" height="16" rx="1" />
      </svg>
    ),
  },
]

export default function TopNav() {
  const pathname = usePathname()
  const { unit, toggleUnit } = useUnit()

  return (
    <nav className="top-nav">
      {/* Wordmark */}
      <Link
        href="/home"
        style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '26px',
          color: 'var(--accent)',
          letterSpacing: '1px',
          textDecoration: 'none',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        GRIND
      </Link>

      {/* Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flex: 1 }}>
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                height: '36px',
                padding: '0 12px',
                borderRadius: 'var(--radius-pill, 9999px)',
                textDecoration: 'none',
                backgroundColor: active ? 'rgba(200, 241, 53, 0.1)' : 'transparent',
                transition: 'background-color 150ms ease',
              }}
            >
              {tab.icon(active)}
              <span style={{
                fontSize: '13px',
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: active ? 700 : 500,
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                lineHeight: 1,
              }}>
                {tab.label}
              </span>
            </Link>
          )
        })}
      </div>

      {/* Unit toggle (shared UnitContext — stays in sync with Profile) */}
      <button
        onClick={toggleUnit}
        aria-label={`Switch units — currently ${unit === 'metric' ? 'kilograms' : 'pounds'}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'var(--surface-elevated)',
          border: '1px solid var(--border)',
          borderRadius: '9999px',
          padding: '3px',
          cursor: 'pointer',
          position: 'relative',
          width: '76px',
          height: '30px',
          flexShrink: 0,
        }}
      >
        <span style={{
          flex: 1, textAlign: 'center', fontSize: '11px', fontWeight: 700,
          fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.5px',
          color: unit === 'metric' ? 'var(--bg)' : 'var(--text-muted)',
          position: 'relative', zIndex: 1,
        }}>KG</span>
        <span style={{
          flex: 1, textAlign: 'center', fontSize: '11px', fontWeight: 700,
          fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.5px',
          color: unit === 'imperial' ? 'var(--bg)' : 'var(--text-muted)',
          position: 'relative', zIndex: 1,
        }}>LBS</span>
        <div style={{
          position: 'absolute',
          top: '3px',
          left: unit === 'metric' ? '3px' : 'calc(50% + 1px)',
          width: 'calc(50% - 4px)',
          height: 'calc(100% - 6px)',
          backgroundColor: 'var(--accent)',
          borderRadius: '9999px',
          transition: 'left 150ms ease',
        }} />
      </button>
    </nav>
  )
}
