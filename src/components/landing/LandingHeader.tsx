'use client'

import Link from 'next/link'
import GoogleSignInButton from '@/components/GoogleSignInButton'
import { InstallShortcut } from './InstallSection'

export default function LandingHeader() {
  return (
    <header className="landing-header">
      <a href="#top" className="landing-header__brand" aria-label="GRIND home">
        GRIND
      </a>
      <div className="landing-header__actions">
        <InstallShortcut compact className="landing-header__install" />
        <Link href="/login" className="landing-header__login press" data-haptic="light">
          Log in
        </Link>
        <GoogleSignInButton
          variant="primary"
          label="Get started"
          className="landing-btn-primary landing-header__cta"
        />
      </div>
    </header>
  )
}
