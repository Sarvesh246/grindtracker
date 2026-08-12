'use client'

import { useEffect, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import GoogleSignInButton from '@/components/GoogleSignInButton'
import LandingRise from './LandingRise'
import {
  ensureInstallListeners,
  hasNativeInstallPrompt,
  isAppleMobileDevice,
  isStandalonePwa,
  scrollToInstallSection,
  tryInstallApp,
} from './installApp'

export { isStandalonePwa } from './installApp'

/**
 * Secondary Install control for header / footer / install section.
 * Hides when already running as a standalone PWA.
 * Android: `beforeinstallprompt` → `prompt()` when available.
 * Otherwise (incl. all iOS): scroll to #install — never Web Share.
 */
export function InstallShortcut({
  className,
  label,
  compact,
}: {
  className?: string
  label?: string
  /** Tighter padding for sticky header. */
  compact?: boolean
}) {
  const [standalone, setStandalone] = useState(false)
  const [resolvedLabel, setResolvedLabel] = useState(label ?? 'How to install')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ensureInstallListeners()
    // Client-only display-mode / UA checks; SSR shows a generic control then may refine.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStandalone(isStandalonePwa())

    function syncLabel() {
      if (label != null) {
        setResolvedLabel(label)
        return
      }
      if (hasNativeInstallPrompt() && !isAppleMobileDevice()) {
        setResolvedLabel('Install app')
      } else {
        // iOS and browsers without BIP: this only scrolls to instructions.
        setResolvedLabel('How to install')
      }
    }
    syncLabel()
    window.addEventListener('beforeinstallprompt', syncLabel)
    window.addEventListener('appinstalled', syncLabel)
    return () => {
      window.removeEventListener('beforeinstallprompt', syncLabel)
      window.removeEventListener('appinstalled', syncLabel)
    }
  }, [label])

  if (standalone) return null

  async function onInstallClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      // Belt-and-suspenders: Apple never hits BIP / share — scroll only.
      if (isAppleMobileDevice()) {
        scrollToInstallSection()
        return
      }
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
      {resolvedLabel}
    </a>
  )
}

/**
 * Add to Home Screen guidance. Collapses when already running as a
 * standalone PWA (installed users shouldn't see install steps).
 */
export default function InstallSection() {
  const [standalone, setStandalone] = useState(false)
  const [showNativeInstall, setShowNativeInstall] = useState(false)
  const [appleDevice, setAppleDevice] = useState(true)

  useEffect(() => {
    ensureInstallListeners()
    // Client-only display-mode check; SSR always shows the section.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStandalone(isStandalonePwa())
    setAppleDevice(isAppleMobileDevice())

    const syncPrompt = () => setShowNativeInstall(hasNativeInstallPrompt())
    syncPrompt()
    window.addEventListener('beforeinstallprompt', syncPrompt)
    window.addEventListener('appinstalled', syncPrompt)
    return () => {
      window.removeEventListener('beforeinstallprompt', syncPrompt)
      window.removeEventListener('appinstalled', syncPrompt)
    }
  }, [])

  if (standalone) return null

  return (
    <section className="landing-section landing-install" id="install">
      <div className="landing-section__inner landing-section__inner--split">
        <LandingRise className="landing-section__copy">
          <p className="landing-eyebrow">Install</p>
          <h2 className="landing-h2" id="install-heading">
            Add GRIND to your Home Screen
          </h2>
          <p className="landing-lead">
            The full gym experience is a PWA — no App Store. On your phone it feels like a native app
            once it lives on the Home Screen.
          </p>
          {appleDevice ? (
            <>
              <p className="landing-install__note">
                <strong>How to install</strong> on this page only scrolls here — it cannot open Safari’s
                Share menu or Add to Home Screen. You must use the <strong>Share</strong> icon in{' '}
                <strong>Safari’s own browser chrome</strong> (on iPhone: bottom center of the screen),
                then choose <strong>Add to Home Screen</strong> or <strong>Add to Dock</strong>.
              </p>
              <ol className="landing-install__steps">
                <li>
                  <span className="landing-install__step-n">1</span>
                  <span>
                    In <strong>Safari</strong>, tap the <strong>Share</strong> icon in the browser
                    toolbar
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
                    — on iPhone that’s the box with the upward arrow at the{' '}
                    <strong>bottom center</strong> of Safari, not a button on this page
                  </span>
                </li>
                <li>
                  <span className="landing-install__step-n">2</span>
                  <span>
                    In that Safari menu, choose <strong>Add to Home Screen</strong> or{' '}
                    <strong>Add to Dock</strong> (wording varies by iOS version)
                  </span>
                </li>
                <li>
                  <span className="landing-install__step-n">3</span>
                  <span>
                    Open <strong>GRIND</strong> from your Home Screen — full screen, offline-ready
                  </span>
                </li>
              </ol>
            </>
          ) : (
            <>
              <p className="landing-install__note">
                On Chrome or Edge, use the browser’s <strong>Install app</strong> prompt when it
                appears, or open the menu and choose <strong>Install app</strong> /{' '}
                <strong>Add to Home Screen</strong>.
              </p>
              {showNativeInstall ? (
                <div className="landing-install__actions">
                  <InstallShortcut label="Install app" />
                </div>
              ) : null}
              <ol className="landing-install__steps">
                <li>
                  <span className="landing-install__step-n">1</span>
                  <span>
                    Tap <strong>Install</strong> when this page offers it, or open the browser menu
                    (⋮) and choose <strong>Install app</strong>
                  </span>
                </li>
                <li>
                  <span className="landing-install__step-n">2</span>
                  <span>Confirm the install — GRIND appears on your Home Screen like a native app</span>
                </li>
                <li>
                  <span className="landing-install__step-n">3</span>
                  <span>
                    Open <strong>GRIND</strong> from the icon — full screen, offline-ready
                  </span>
                </li>
              </ol>
              <p className="landing-install__android">
                On iPhone, open this page in <strong>Safari</strong> and use Share →{' '}
                <strong>Add to Home Screen</strong>.
              </p>
            </>
          )}
          {appleDevice && showNativeInstall ? (
            <div className="landing-install__actions">
              <InstallShortcut label="Install app" />
            </div>
          ) : null}
        </LandingRise>
      </div>
    </section>
  )
}

export function FinalCta() {
  return (
    <section className="landing-section landing-final" id="start">
      <LandingRise className="landing-section__inner landing-final__inner">
        <h2 className="landing-h2 landing-final__title">Free to start. Built for serious lifters.</h2>
        <p className="landing-lead landing-final__lead">
          Log sets in seconds, keep your streak honest, and watch the scoreboard climb — no paywall
          in the way of your next PR.
        </p>
        <div className="landing-final__actions">
          <GoogleSignInButton variant="google" fullWidth style={{ maxWidth: '320px' }} />
          <Link href="/login" className="landing-final__login press" data-haptic="light">
            Already have an account? Log in
          </Link>
        </div>
      </LandingRise>
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
          <InstallShortcut className="landing-footer__install" label="How to install" />
        </nav>
        <p className="landing-footer__legal">© {year} GRIND · Free to start</p>
      </div>
    </footer>
  )
}
