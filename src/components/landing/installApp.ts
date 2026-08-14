/**
 * Best-effort Add-to-Home-Screen / install helpers for the marketing landing.
 *
 * Reality check:
 * - iOS Safari has NO public API to open “Add to Home Screen” directly.
 *   NEVER call `navigator.share()` for Install — Web Share is a different
 *   sheet and typically does NOT include “Add to Home Screen”. Scroll to
 *   #install and show Safari toolbar Share → Add to Home Screen / Dock steps.
 * - Android Chrome may fire `beforeinstallprompt`; when captured we call
 *   `prompt()`. Otherwise scroll to #install instructions.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
let listenersReady = false

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  )
}

/** iPhone / iPad (incl. iPadOS desktop UA). Used for CTA copy, not capability claims. */
export function isAppleMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ may report as Mac with touch
  return (
    window.navigator.platform === 'MacIntel' &&
    (window.navigator.maxTouchPoints ?? 0) > 1
  )
}

/**
 * True only for actual Safari on iOS/iPadOS — not Chrome, Firefox, Edge, or
 * Opera running on the same device, which all still report "Safari" in their
 * UA string for compatibility (CriOS/FxiOS/EdgiOS/OPiOS tokens distinguish
 * them). This matters because on iOS, "Add to Home Screen" producing a real
 * standalone app (not just a browser bookmark) is a Safari-only capability —
 * every other iOS browser lacks it, and Safari's Share-icon toolbar position
 * this component describes doesn't apply to their chrome either.
 */
export function isIOSSafari(): boolean {
  if (typeof window === 'undefined') return false
  if (!isAppleMobileDevice()) return false
  const ua = window.navigator.userAgent
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|Mercury/.test(ua)
}

/** True once Chrome (etc.) has fired `beforeinstallprompt` and we captured it. */
export function hasNativeInstallPrompt(): boolean {
  return deferredPrompt != null
}

/** Register once (client). Safe to call from multiple Install buttons. */
export function ensureInstallListeners(): void {
  if (typeof window === 'undefined' || listenersReady) return
  listenersReady = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
  })
}

export function scrollToInstallSection(): void {
  const el = document.getElementById('install')
  if (!el) return
  const reduced =
    document.documentElement.classList.contains('reduce-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  const heading =
    el.querySelector<HTMLElement>('#install-heading') ??
    el.querySelector<HTMLElement>('h2')
  if (heading) {
    heading.setAttribute('tabindex', '-1')
    heading.focus({ preventScroll: true })
  }
}

export type InstallAttemptResult = 'standalone' | 'prompted' | 'scrolled'

/**
 * Prefer native install prompt; otherwise scroll to #install instructions.
 * Never opens Web Share for install — that sheet is not Add to Home Screen.
 * Must be invoked from a user gesture (click).
 */
export async function tryInstallApp(): Promise<InstallAttemptResult> {
  ensureInstallListeners()
  if (isStandalonePwa()) return 'standalone'

  // iPhone / iPad: no install API and no Web Share stand-in — instructions only.
  if (isAppleMobileDevice()) {
    scrollToInstallSection()
    return 'scrolled'
  }

  if (deferredPrompt) {
    const event = deferredPrompt
    deferredPrompt = null
    await event.prompt()
    try {
      await event.userChoice
    } catch {
      /* ignore — prompt UI already shown */
    }
    return 'prompted'
  }

  scrollToInstallSection()
  return 'scrolled'
}
