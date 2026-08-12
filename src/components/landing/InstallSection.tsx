'use client'

import { useEffect, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import GoogleSignInButton from '@/components/GoogleSignInButton'
import {
  ensureInstallListeners,
  isStandalonePwa,
  tryInstallApp,
} from './installApp'

export { isStandalonePwa } from './installApp'

/**
 * Secondary Install control for header / install section / footer.
 * Hides when already running as a standalone PWA.
 * Tries Android `beforeinstallprompt`, then Web Share (iOS Share sheet),
 * then scrolls to #install instructions — see installApp.ts.
 */
export function InstallShortcut({
  className,
  label = 'Install',
  compact,
}: {
  className?: string
  label?: string
  /** Tighter padding for sticky header. */
  compact?: boolean
}) {
  const [standalone, setStandalone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ensureInstallListeners()
    // Client-only display-mode check; SSR renders the control then may hide.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStandalone(isStandalonePwa())
  }, [])

  if (standalone) return null

  async function onInstallClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await tryInstallApp()
    } finally {
      setBusy(false)
    }
  }

  return (
    <a
      href="#install"
      className={`landing-install-btn press${compact ? ' landing-install-btn--compact' : ''} ${className ?? ''}`}
      data-haptic="light"
      aria-busy={busy || undefined}
      onClick={onInstallClick}
    >
      {label}
    </a>
  )
}

/**
 * iOS Add to Home Screen guidance. Collapses when already running as a
 * standalone PWA (installed users shouldn't see install steps).
 */
export default function InstallSection() {
  const [standalone, setStandalone] = useState(false)

  useEffect(() => {
    ensureInstallListeners()
    // Client-only display-mode check; SSR always shows the section.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStandalone(isStandalonePwa())
  }, [])

  if (standalone) return null

  return (
    <section className="landing-section landing-install" id="install">
      <div className="landing-section__inner landing-section__inner--split">
        <div className="landing-section__copy landing-rise">
          <p className="landing-eyebrow">Install</p>
          <h2 className="landing-h2">Add GRIND to your Home Screen</h2>
          <p className="landing-lead">
            The full gym experience is a PWA — no App Store. On iPhone it feels like a native app
            once it lives on your Home Screen.
          </p>
          <div className="landing-install__actions">
            <InstallShortcut label="Add to Home Screen" />
          </div>
          <ol className="landing-install__steps">
            <li>
              <span className="landing-install__step-n">1</span>
              <span>
                Tap <strong>Share</strong> in Safari
                <span className="landing-install__share" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 3v12M8 7l4-4 4 4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </span>
            </li>
            <li>
              <span className="landing-install__step-n">2</span>
              <span>
                Choose <strong>Add to Home Screen</strong>
              </span>
            </li>
            <li>
              <span className="landing-install__step-n">3</span>
              <span>
                Open <strong>GRIND</strong> from your Home Screen — full screen, offline-ready
              </span>
            </li>
          </ol>
          <p className="landing-install__android">
            On Android Chrome: menu → <strong>Install app</strong> or Add to Home Screen.
          </p>
        </div>
      </div>
    </section>
  )
}

export function FinalCta() {
  return (
    <section className="landing-section landing-final" id="start">
      <div className="landing-section__inner landing-final__inner landing-rise">
        <h2 className="landing-h2 landing-final__title">Free to start. Built for serious lifters.</h2>
        <p className="landing-lead landing-final__lead">
          Log sets in seconds, keep your streak honest, and watch the scoreboard climb — no paywall
          in the way of your next PR.
        </p>
        <div className="landing-final__actions">
          <GoogleSignInButton variant="google" fullWidth style={{ maxWidth: '320px' }} />
          <Link href="/login" className="landing-final__login press" data-haptic="light">
            Already grinding? Log in
          </Link>
        </div>
      </div>
    </section>
  )
}

/** Compact site footer — not a sticky header clone. */
export function LandingFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="landing-footer">
      <div className="landing-footer__inner">
        <div className="landing-footer__brand-block">
          <a href="#top" className="landing-footer__brand" aria-label="GRIND home">
            GRIND
          </a>
          <p className="landing-footer__tagline">
            Gym tracker for lifters who want speed, streaks, and a private scoreboard.
          </p>
        </div>
        <nav className="landing-footer__nav" aria-label="Footer">
          <Link href="/login" className="landing-footer__link press" data-haptic="light">
            Log in
          </Link>
          <a href="#start" className="landing-footer__link press" data-haptic="light">
            Get started
          </a>
          <InstallShortcut className="landing-footer__install" label="Add to Home Screen" />
        </nav>
        <p className="landing-footer__legal">© {year} GRIND · Free to start</p>
      </div>
    </footer>
  )
}
