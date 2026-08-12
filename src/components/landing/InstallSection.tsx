'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import GoogleSignInButton from '@/components/GoogleSignInButton'

/** Local copy — avoid pulling the whole push client into the landing chunk. */
function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  )
}

/**
 * iOS Add to Home Screen guidance. Collapses when already running as a
 * standalone PWA (installed users shouldn't see install steps).
 */
export default function InstallSection() {
  const [standalone, setStandalone] = useState(false)

  useEffect(() => {
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
