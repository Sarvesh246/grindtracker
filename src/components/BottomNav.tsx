'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

const tabs = [
  {
    href: '/home',
    label: 'Home',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
        stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: active ? 'var(--accent-text)' : 'var(--text-muted)' }}>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    href: '/log',
    label: 'Log',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
        stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: active ? 'var(--accent-text)' : 'var(--text-muted)' }}>
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
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
        stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: active ? 'var(--accent-text)' : 'var(--text-muted)' }}>
        <polyline points="3 17 9 11 13 15 21 7" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
        stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: active ? 'var(--accent-text)' : 'var(--text-muted)' }}>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    href: '/leaderboard',
    label: 'Ranks',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
        stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: active ? 'var(--accent-text)' : 'var(--text-muted)' }}>
        <rect x="2" y="13" width="6" height="8" rx="1" />
        <rect x="9" y="9" width="6" height="12" rx="1" />
        <rect x="16" y="5" width="6" height="16" rx="1" />
      </svg>
    ),
  },
]

export default function BottomNav() {
  const pathname = usePathname()
  const params = useSearchParams()

  // Hide during an active workout so the Finish bar isn't stacked with the nav.
  if (pathname === '/log' && params.get('day')) return null

  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              height: '64px',
              textDecoration: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {tab.icon(active)}
            <span style={{
              fontSize: '11px',
              fontFamily: "'DM Sans', sans-serif",
              color: active ? 'var(--accent-text)' : 'var(--text-muted)',
              lineHeight: 1,
              transition: 'color 150ms ease',
            }}>
              {tab.label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
