/**
 * Best-effort Add-to-Home-Screen / install helpers for the marketing landing.
 *
 * Reality check:
 * - iOS Safari has NO public API to open “Add to Home Screen” directly.
 *   Do NOT use `navigator.share()` as a stand-in — Web Share is a different
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
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
