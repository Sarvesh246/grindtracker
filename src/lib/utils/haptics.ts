/**
 * Web haptics for GRIND.
 *
 * iOS 26.5+ / 27: Apple closed programmatic <input switch>.click() haptics.
 * The only remaining path is a real finger tap on a switch — so we overlay a
 * transparent `<input type="checkbox" switch>` on interactive targets
 * (`data-haptic` / `attachHapticOverlay`). The finger lands on the switch
 * (one system tick), then we re-dispatch click to the host. Multi-pulse via
 * setTimeout is impossible on 26.5+; every intensity is one tick.
 *
 * Android/Chrome: `navigator.vibrate` with intensity patterns (still works
 * from timers and post-await — no user-gesture requirement like iOS).
 *
 * Do NOT gate on Reduce Motion — that preference is visual-only; system
 * haptics have their own OS toggle.
 *
 * Usage:
 *   // Declarative (preferred for taps — works on iOS 27):
 *   <button data-haptic="light" onClick={...}>
 *   // Mount <HapticsSetup /> once in the app shell.
 *
 *   // Imperative (Android vibrate; iOS no-op on 26.5+):
 *   haptic('light')
 */

export type HapticIntensity = 'light' | 'medium' | 'heavy' | 'success'

const OVERLAY_ATTR = 'data-haptic-overlay'
const DATA_HAPTIC = 'data-haptic'

type NavWithVibrate = Navigator & {
  vibrate?: (p: number | number[]) => boolean
}

let _isIos: boolean | null = null
let _canVibrate: boolean | null = null

/** True when Vibration API is present (Android Chrome etc.). iOS Safari omits it. */
export function supportsVibrate(): boolean {
  if (_canVibrate === null) {
    _canVibrate =
      typeof navigator !== 'undefined' &&
      typeof (navigator as NavWithVibrate).vibrate === 'function'
  }
  return _canVibrate
}

/**
 * iOS / iPadOS Safari (incl. iPad pretending to be Mac). Used to decide whether
 * to inject switch overlays — not for Reduce Motion or any visual preference.
 */
export function isIosHaptics(): boolean {
  if (_isIos === null) {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      _isIos = false
    } else {
      // Prefer capability: if vibrate exists we're on Android/desktop Chrome.
      // iOS is the engine that needs the switch overlay.
      _isIos =
        !supportsVibrate() &&
        ((/iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)) ||
          (navigator.maxTouchPoints > 1 && /MacIntel/.test(navigator.platform)))
    }
  }
  return _isIos
}

function tryVibrate(pattern: number | number[]): boolean {
  if (!supportsVibrate()) return false
  try {
    return !!(navigator as NavWithVibrate).vibrate?.(pattern)
  } catch {
    return false
  }
}

/**
 * Imperative haptic. Android: intensity patterns. iOS 26.5+: no-op (use
 * overlays). Older iOS may still get nothing useful from a programmatic path.
 */
export function haptic(intensity: HapticIntensity = 'light'): void {
  if (typeof window === 'undefined') return
  if (!supportsVibrate()) return

  switch (intensity) {
    case 'light':
      tryVibrate(10)
      break
    case 'medium':
      tryVibrate(25)
      break
    case 'heavy':
      tryVibrate([18, 40, 40])
      break
    case 'success':
      tryVibrate([10, 60, 30])
      break
  }
}

/** Helper for spreading onto elements: `{...hapticAttrs('heavy')}`. */
export function hapticAttrs(
  intensity: HapticIntensity = 'light',
): { [DATA_HAPTIC]: HapticIntensity } {
  return { [DATA_HAPTIC]: intensity }
}

function ensurePositioned(host: HTMLElement): void {
  const pos = getComputedStyle(host).position
  if (pos !== 'absolute' && pos !== 'relative' && pos !== 'fixed' && pos !== 'sticky') {
    host.style.position = 'relative'
  }
}

function hostIsDisabled(host: HTMLElement): boolean {
  if (host instanceof HTMLButtonElement || host instanceof HTMLInputElement) {
    return host.disabled
  }
  return host.getAttribute('aria-disabled') === 'true'
}

/**
 * Inject a transparent switch overlay covering `el` so a finger tap ticks iOS
 * system haptics, then re-dispatch click to the host so React onClick runs.
 * No-op on Android (use `haptic()` / `data-haptic` click vibrate instead).
 * Returns a detach function.
 */
export function attachHapticOverlay(el: HTMLElement): () => void {
  if (typeof document === 'undefined') return () => {}
  if (!isIosHaptics()) return () => {}
  if (el.querySelector(`[${OVERLAY_ATTR}]`)) return () => {}

  ensurePositioned(el)

  const sw = document.createElement('input')
  sw.type = 'checkbox'
  sw.setAttribute('switch', '')
  sw.setAttribute(OVERLAY_ATTR, '')
  sw.setAttribute('aria-hidden', 'true')
  sw.tabIndex = -1
  // opacity:0 keeps the switch hittable; appearance keeps iOS treating it as a switch.
  sw.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;' +
    '-webkit-appearance:switch;appearance:auto;opacity:0;cursor:inherit;pointer-events:auto;z-index:1;'

  const syncPointerEvents = () => {
    sw.style.pointerEvents = hostIsDisabled(el) ? 'none' : 'auto'
  }
  syncPointerEvents()

  const onClick = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (hostIsDisabled(el)) return
    // One system tick already fired from the direct tap on the switch.
    // Re-dispatch so the host's React onClick / navigation still runs.
    try {
      el.focus({ preventScroll: true })
    } catch {
      /* non-focusable hosts are fine */
    }
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  }

  sw.addEventListener('click', onClick)
  el.appendChild(sw)

  const attrObs = new MutationObserver(syncPointerEvents)
  attrObs.observe(el, { attributes: true, attributeFilter: ['disabled', 'aria-disabled'] })

  return () => {
    attrObs.disconnect()
    sw.removeEventListener('click', onClick)
    sw.remove()
  }
}

/**
 * Watch `root` for `[data-haptic]` hosts and inject iOS switch overlays.
 * Android is a no-op here — call `haptic()` synchronously in the handler
 * (before any await) so we don't double-buzz with an overlay listener.
 * Returns teardown. Mount once via `<HapticsSetup />`.
 */
export function setupHaptics(root: ParentNode = document): () => void {
  if (typeof document === 'undefined') return () => {}
  // Overlays are an iOS-only requirement; Android uses navigator.vibrate.
  if (!isIosHaptics()) return () => {}

  const detachers = new Map<HTMLElement, () => void>()

  const attachOne = (el: HTMLElement) => {
    if (detachers.has(el)) return
    detachers.set(el, attachHapticOverlay(el))
  }

  const detachOne = (el: HTMLElement) => {
    const d = detachers.get(el)
    if (d) {
      d()
      detachers.delete(el)
    }
  }

  for (const el of root.querySelectorAll<HTMLElement>(`[${DATA_HAPTIC}]`)) {
    attachOne(el)
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (node.hasAttribute(DATA_HAPTIC)) attachOne(node)
        for (const el of node.querySelectorAll<HTMLElement>(`[${DATA_HAPTIC}]`)) {
          attachOne(el)
        }
      }
      for (const node of m.removedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (detachers.has(node)) detachOne(node)
        for (const el of node.querySelectorAll<HTMLElement>(`[${DATA_HAPTIC}]`)) {
          detachOne(el)
        }
      }
    }
  })

  const observeTarget = root instanceof Document ? root.documentElement : (root as HTMLElement)
  observer.observe(observeTarget, { childList: true, subtree: true })

  return () => {
    observer.disconnect()
    for (const d of detachers.values()) d()
    detachers.clear()
  }
}
