'use client'

import { useEffect, useState, type MouseEvent } from 'react'
import {
  ensureInstallListeners,
  hasNativeInstallPrompt,
  isAppleMobileDevice,
  isStandalonePwa,
  scrollToInstallSection,
  tryInstallApp,
} from './installApp'

const DISMISS_KEY = 'grind_a2hs_pill_dismissed'

function ShareGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
  )
}

/**
 * Mobile-only Add-to-Home-Screen tip. Sticky header dropped Install on small
 * screens; this pill carries the Safari Share → Home Screen guidance without
 * a second header CTA. Hidden in standalone PWA, after dismiss, on desktop,
 * and while the full #install section is on screen.
 */
export default function MobileInstallPill() {
  const [ready, setReady] = useState(false)
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const [nearInstall, setNearInstall] = useState(false)
  const [label, setLabel] = useState('Install GRIND')
  const [nativeInstall, setNativeInstall] = useState(false)

  useEffect(() => {
    ensureInstallListeners()
    if (isStandalonePwa()) return
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === '1') return
    } catch {
      /* private mode — still show */
    }

    function syncCopy() {
      const canPrompt = hasNativeInstallPrompt() && !isAppleMobileDevice()
      setNativeInstall(canPrompt)
      setLabel(
        canPrompt
          ? 'Install GRIND app'
          : isAppleMobileDevice()
            ? 'Share → Add to Home Screen'
            : 'Install GRIND',
      )
    }
    syncCopy()
    window.addEventListener('beforeinstallprompt', syncCopy)
    window.addEventListener('appinstalled', syncCopy)

    // Soft entrance after the hero settles — reads as a tip, not a second CTA row.
    const showTimer = window.setTimeout(() => {
      setReady(true)
      setVisible(true)
    }, 900)

    const install = document.getElementById('install')
    let observer: IntersectionObserver | null = null
    if (install) {
      observer = new IntersectionObserver(
        ([entry]) => setNearInstall(entry.isIntersecting && entry.intersectionRatio > 0.2),
        { threshold: [0, 0.2, 0.5] },
      )
      observer.observe(install)
    }

    return () => {
      window.clearTimeout(showTimer)
      window.removeEventListener('beforeinstallprompt', syncCopy)
      window.removeEventListener('appinstalled', syncCopy)
      observer?.disconnect()
    }
  }, [])

  if (!ready || !visible) return null

  function dismiss(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    try {
      window.localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    setClosing(true)
    window.setTimeout(() => setVisible(false), 180)
  }

  async function onActivate(e: MouseEvent) {
    e.preventDefault()
    if (nativeInstall) {
      await tryInstallApp()
      return
    }
    scrollToInstallSection()
  }

  const hidden = nearInstall || closing

  return (
    <div
      className={`landing-install-pill${hidden ? ' landing-install-pill--hidden' : ''}${
        closing ? ' landing-install-pill--closing' : ''
      }`}
    >
      <button
        type="button"
        className="landing-install-pill__action press"
        data-haptic="light"
        onClick={onActivate}
      >
        <span className="landing-install-pill__icon">
          <ShareGlyph />
        </span>
        <span className="landing-install-pill__copy">
          <span className="landing-install-pill__eyebrow">Install</span>
          <span className="landing-install-pill__text">{label}</span>
        </span>
      </button>
      <button
        type="button"
        className="landing-install-pill__dismiss press"
        data-haptic="light"
        aria-label="Dismiss install tip"
        onClick={dismiss}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}
