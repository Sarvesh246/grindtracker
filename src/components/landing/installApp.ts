/**
 * Best-effort Add-to-Home-Screen / install helpers for the marketing landing.
 *
 * Reality check:
 * - iOS Safari has NO public API to open “Add to Home Screen” directly.
 *   The closest UX is `navigator.share({ url, title, text })` from a user
 *   gesture (Share sheet). On some iOS versions that sheet can include
 *   “Add to Home Screen”; otherwise the user still gets Share and can
 *   follow the #install steps.
 * - Android Chrome may fire `beforeinstallprompt`; when captured we call
 *   `prompt()`. Otherwise we try Web Share, then scroll to #install.
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
  const heading = el.querySelector('h2')
  if (heading instanceof HTMLElement) {
    heading.setAttribute('tabindex', '-1')
    heading.focus({ preventScroll: true })
  }
}

export type InstallAttemptResult =
  | 'standalone'
  | 'prompted'
  | 'shared'
  | 'share-cancelled'
  | 'scrolled'

/**
 * Prefer native install prompt → Web Share → scroll to instructions.
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

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: 'GRIND',
        text: 'Track. Progress. Dominate. — gym tracker PWA',
        url: window.location.origin + '/',
      })
      return 'shared'
    } catch (err) {
      // User dismissed the sheet — don't dump them at #install.
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'share-cancelled'
      }
      // Share unsupported for this payload / failed — fall through.
    }
  }

  scrollToInstallSection()
  return 'scrolled'
}
