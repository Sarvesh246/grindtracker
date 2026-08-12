'use client'

import Link from 'next/link'
import GoogleSignInButton from '@/components/GoogleSignInButton'

export default function LandingHeader() {
  return (
    <header className="landing-header">
      <a href="#top" className="landing-header__brand" aria-label="GRIND home">
        GRIND
      </a>
      <div className="landing-header__actions">
        <Link href="/login" className="landing-header__login press" data-haptic="light">
          Log in
        </Link>
        <GoogleSignInButton
          variant="primary"
          label="Get started"
          className="landing-header__cta"
          style={{ height: '44px', padding: '0 16px', fontSize: '13px', gap: '8px' }}
        />
      </div>
    </header>
  )
}
