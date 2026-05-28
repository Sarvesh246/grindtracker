'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  {
    href: '/home',
    label: 'Home',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#c8f135' : '#555555'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    href: '/log',
    label: 'Log',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#c8f135' : '#555555'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#c8f135' : '#555555'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 17 9 11 13 15 21 7" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#c8f135' : '#555555'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: '64px',
      backgroundColor: '#1a1a1a',
      borderTop: '1px solid #2e2e2e',
      display: 'flex',
      alignItems: 'stretch',
      paddingBottom: 'env(safe-area-inset-bottom)',
      zIndex: 100,
    }}>
      {tabs.map((tab) => {
        const active = pathname === tab.href
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
              textDecoration: 'none',
              minHeight: '44px',
            }}
          >
            {tab.icon(active)}
            <span style={{
              fontSize: '11px',
              fontFamily: "'DM Sans', sans-serif",
              color: active ? '#c8f135' : '#555555',
              lineHeight: 1,
            }}>
              {tab.label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
