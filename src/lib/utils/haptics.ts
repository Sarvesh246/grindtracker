/**
 * Web haptics for GRIND.
 *
 * iOS PWA (Add to Home Screen) is the primary target. On iOS 26.5+ / 27,
 * Apple closed programmatic <input switch>.click() haptics — the only
 * remaining path is a real finger tap on a transparent switch overlay
 * (`data-haptic` / `attachHapticOverlay` via `setupHaptics`). Every
 * intensity is one system tick on iOS; satisfaction comes from *which*
 * actions tick, not vibrate pattern length.
 *
 * Android/Chrome: `navigator.vibrate` with intensity patterns. `setupHaptics`
 * also delegates click on `[data-haptic]` so one attr works both platforms —
 * prefer stamping `data-haptic` and dropping redundant sync `haptic()` from
 * the same handler (avoids double-buzz). Imperative `haptic()` remains for
 * non-gesture moments (rest timer end, post-await PR success) — Android only.
 *
 * Intensity ladder = Android pulse weight + shared taxonomy. Do NOT gate on
 * Reduce Motion — that preference is visual-only; system haptics have their
 * own OS toggle. Opt-in only — never default haptics on every Button.
 *
 * Usage:
 *   // Declarative (preferred for taps — works on iOS 27 + Android):
 *   <button data-haptic="heavy" onClick={...}>
 *   // Mount <HapticsSetup /> once in the app shell.
 *
 *   // Imperative (Android vibrate; iOS no-op on 26.5+):
 *   haptic('light')
 */

export type HapticIntensity = 'light' | 'medium' | 'heavy' | 'success'

const OVERLAY_ATTR = 'data-haptic-overlay'
const DATA_HAPTIC = 'data-haptic'

/** Same drift tolerance as the hold-to-remove gesture in FriendsAccordion and
 *  SwipeNavigator's axis deadzone — a few px of finger wobble is a tap, more
 *  than that is a drag/swipe. */
const TAP_DRAG_CANCEL_PX = 10

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

function parseIntensity(raw: string | null): HapticIntensity {
  if (raw === 'medium' || raw === 'heavy' || raw === 'success') return raw
  return 'light'
}

/**
 * Imperative haptic. Android: intensity patterns. iOS 26.5+: no-op (use
 * overlays). Prefer `data-haptic` for tap targets — keep this for timers /
 * post-await celebrations only.
 */
export function haptic(intensity: HapticIntensity = 'light'): void {
  if (typeof window === 'undefined') return
  if (!supportsVibrate()) return

  switch (intensity) {
    case 'light':
      tryVibrate(10)
      break
    case 'medium':
      tryVibrate(30)
      break
    case 'heavy':
      tryVibrate([28, 45, 55])
      break
    case 'success':
      tryVibrate([12, 70, 35, 40, 25])
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
 * Hosts that own their own drag gesture (Coach FAB, sheet grabbers, etc.).
 * Their overlay must not steal pans for scroll-forwarding — pointer events
 * bubble to the host's handlers instead.
 */
function hostOwnsDragGesture(host: HTMLElement): boolean {
  if (host.classList.contains('coach-fab')) return true
  try {
    return getComputedStyle(host).touchAction === 'none'
  } catch {
    return false
  }
}

/** Nearest ancestor that can scroll on the given axis (overflow + overflow size). */
function nearestScrollParent(
  from: HTMLElement,
  axis: 'x' | 'y',
): HTMLElement | null {
  let node: HTMLElement | null = from.parentElement
  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node)
    if (axis === 'y') {
      const oy = style.overflowY
      if (
        (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
        node.scrollHeight > node.clientHeight + 1
      ) {
        return node
      }
    } else {
      const ox = style.overflowX
      if (
        (ox === 'auto' || ox === 'scroll' || ox === 'overlay') &&
        node.scrollWidth > node.clientWidth + 1
      ) {
        return node
      }
    }
    node = node.parentElement
  }
  return null
}

/**
 * Inject a transparent switch overlay covering `el` so a finger tap ticks iOS
 * system haptics, then re-dispatch click to the host so React onClick runs.
 * No-op on Android (delegated vibrate via `setupHaptics`).
 * Returns a detach function.
 *
 * Scroll-from-button: WebKit's `appearance: switch` keeps a native
 * slide-to-toggle recognizer that often swallows pans even with
 * `touch-action: pan-y` (the earlier CSS-only fix). For ordinary hosts we set
 * `touch-action: none` on the overlay and forward pans past
 * {@link TAP_DRAG_CANCEL_PX} to the nearest scroll parent, canceling the
 * click. Drag-owned hosts (e.g. `.coach-fab`) skip forwarding so their own
 * pointer handlers keep working.
 */
export function attachHapticOverlay(el: HTMLElement): () => void {
  if (typeof document === 'undefined') return () => {}
  if (!isIosHaptics()) return () => {}
  if (el.querySelector(`[${OVERLAY_ATTR}]`)) return () => {}

  ensurePositioned(el)

  const ownsDrag = hostOwnsDragGesture(el)

  const sw = document.createElement('input')
  sw.type = 'checkbox'
  sw.setAttribute('switch', '')
  sw.setAttribute(OVERLAY_ATTR, '')
  sw.setAttribute('aria-hidden', 'true')
  sw.tabIndex = -1
  // opacity:0 keeps the switch hittable; appearance keeps iOS treating it as a switch.
  // touch-action:none — WebKit's switch slide gesture ignores pan-y and claims
  // the touch, blocking parent scroll. We own the gesture and either forward
  // scroll (normal hosts) or let pointer events bubble to a drag host (FAB).
  sw.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;' +
    '-webkit-appearance:switch;appearance:auto;opacity:0;cursor:inherit;pointer-events:auto;z-index:1;' +
    'outline:none;box-shadow:none;-webkit-tap-highlight-color:transparent;touch-action:none;'

  const syncPointerEvents = () => {
    sw.style.pointerEvents = hostIsDisabled(el) ? 'none' : 'auto'
  }
  syncPointerEvents()

  // Per-gesture drag state — a swipe that started on this overlay must not
  // re-dispatch a click (setupTapDragGuard is belt-and-suspenders for the rest).
  let gesture:
    | {
        x: number
        y: number
        lastX: number
        lastY: number
        axis: 'x' | 'y' | null
        scrollEl: HTMLElement | null
      }
    | null = null
  let gestureDragged = false

  const onTouchStart = (e: TouchEvent) => {
    if (ownsDrag) return
    if (e.touches.length !== 1) {
      gesture = null
      gestureDragged = false
      return
    }
    const t = e.touches[0]
    gestureDragged = false
    gesture = {
      x: t.clientX,
      y: t.clientY,
      lastX: t.clientX,
      lastY: t.clientY,
      axis: null,
      scrollEl: null,
    }
  }

  const onTouchMove = (e: TouchEvent) => {
    if (ownsDrag || !gesture || e.touches.length !== 1) return
    const t = e.touches[0]
    const dx = t.clientX - gesture.x
    const dy = t.clientY - gesture.y

    if (!gesture.axis) {
      if (Math.hypot(dx, dy) <= TAP_DRAG_CANCEL_PX) {
        gesture.lastX = t.clientX
        gesture.lastY = t.clientY
        return
      }
      gestureDragged = true
      gesture.axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x'
      gesture.scrollEl = nearestScrollParent(el, gesture.axis)
    } else {
      gestureDragged = true
    }

    if (gesture.scrollEl) {
      // Claim the gesture from the switch so the toggle slide can't win.
      e.preventDefault()
      if (gesture.axis === 'y') {
        gesture.scrollEl.scrollTop -= t.clientY - gesture.lastY
      } else {
        gesture.scrollEl.scrollLeft -= t.clientX - gesture.lastX
      }
    }

    gesture.lastX = t.clientX
    gesture.lastY = t.clientY
  }

  const onTouchEnd = () => {
    gesture = null
    // gestureDragged stays until click so onClick can suppress re-dispatch.
  }

  const onClick = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const wasDragged = gestureDragged
    gestureDragged = false
    gesture = null
    // Reset switch chrome so a checked/focused state can't flash a visible box.
    sw.checked = false
    try {
      sw.blur()
    } catch {
      /* ignore */
    }
    if (wasDragged || hostIsDisabled(el)) return
    // One system tick already fired from the direct tap on the switch.
    // Re-dispatch so the host's React onClick / navigation still runs.
    // Don't leave focus on <a> hosts — iOS/Safari keeps :focus-visible on the
    // tapped nav link and paints a lasting lime square around the active tab.
    try {
      if (!(el instanceof HTMLAnchorElement)) {
        el.focus({ preventScroll: true })
      }
    } catch {
      /* non-focusable hosts are fine */
    }
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    if (el instanceof HTMLAnchorElement) {
      queueMicrotask(() => el.blur())
    }
  }

  sw.addEventListener('click', onClick)
  if (!ownsDrag) {
    sw.addEventListener('touchstart', onTouchStart, { passive: true })
    // Non-passive: we preventDefault once a pan is claimed for scroll-forward.
    sw.addEventListener('touchmove', onTouchMove, { passive: false })
    sw.addEventListener('touchend', onTouchEnd, { passive: true })
    sw.addEventListener('touchcancel', onTouchEnd, { passive: true })
  }
  el.appendChild(sw)

  const attrObs = new MutationObserver(syncPointerEvents)
  attrObs.observe(el, { attributes: true, attributeFilter: ['disabled', 'aria-disabled'] })

  return () => {
    attrObs.disconnect()
    sw.removeEventListener('click', onClick)
    if (!ownsDrag) {
      sw.removeEventListener('touchstart', onTouchStart)
      sw.removeEventListener('touchmove', onTouchMove)
      sw.removeEventListener('touchend', onTouchEnd)
      sw.removeEventListener('touchcancel', onTouchEnd)
    }
    sw.remove()
  }
}

/**
 * Watch `root` for `[data-haptic]` hosts.
 * - iOS: inject switch overlays (MutationObserver).
 * - Android: capture-phase click delegation → vibrate by intensity attr.
 * Prefer `data-haptic` alone; drop redundant sync `haptic()` on the same tap.
 * Returns teardown. Mount once via `<HapticsSetup />`.
 */
export function setupHaptics(root: ParentNode = document): () => void {
  if (typeof document === 'undefined') return () => {}

  // Android / desktop Chrome: one delegated listener for all [data-haptic] taps.
  if (!isIosHaptics()) {
    if (!supportsVibrate()) return () => {}

    const onClick = (e: Event) => {
      const t = e.target
      if (!(t instanceof Element)) return
      // Ignore synthetic / non-trusted clicks if any; real finger taps are trusted.
      if (e instanceof MouseEvent && e.isTrusted === false) return
      // Coach FAB press/drag — body class also kills BottomNav pointer-events;
      // skip vibrate if a click somehow still lands.
      if (document.body.classList.contains('coach-fab-dragging')) return
      const host = t.closest(`[${DATA_HAPTIC}]`)
      if (!(host instanceof HTMLElement)) return
      if (hostIsDisabled(host)) return
      haptic(parseIntensity(host.getAttribute(DATA_HAPTIC)))
    }

    const observeTarget = root instanceof Document ? root.documentElement : (root as HTMLElement)
    observeTarget.addEventListener('click', onClick, true)
    return () => {
      observeTarget.removeEventListener('click', onClick, true)
    }
  }

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
      // Coach FAB clears `data-haptic` while dragging — must detach the iOS
      // switch overlay, not leave it hittable under the finger / on release.
      if (m.type === 'attributes' && m.attributeName === DATA_HAPTIC) {
        const el = m.target
        if (!(el instanceof HTMLElement)) continue
        if (el.hasAttribute(DATA_HAPTIC)) attachOne(el)
        else detachOne(el)
        continue
      }
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
  observer.observe(observeTarget, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [DATA_HAPTIC],
  })

  return () => {
    observer.disconnect()
    for (const d of detachers.values()) d()
    detachers.clear()
  }
}

/**
 * Cancels the click a touch would otherwise fire once it's dragged more than
 * a few px — a swipe (page-nav swipe, scroll, or just a finger sliding off a
 * button mid-scroll) should never also activate whatever it started or
 * passed over. Covers every element, not just `[data-haptic]` hosts: on iOS
 * this is what actually matters, since `attachHapticOverlay`'s switch
 * overlay fires its own native `click` on touch release regardless of how
 * far the finger travelled first — a plain `<button>` doesn't reliably get
 * that same click-after-scroll cancellation from WebKit either once
 * `touch-action: pan-y` is in play (see globals.css). A capture-phase click
 * listener on the document root runs before any element's own click
 * handler (including the switch overlay's), so `stopImmediatePropagation`
 * here reliably kills the whole chain.
 *
 * Listens to both pointer *and* touch move events: when a control swallows
 * the gesture, pointermove can go quiet while touchmove still reports the
 * finger — without the touch path, `dragged` stayed false and the click
 * still fired after a failed scroll attempt.
 *
 * Chart interactions (Recharts `<Line>` dot tap/scrub) manage their own
 * touch handling and are excluded — this guard would otherwise fight them.
 * Mount once via `<HapticsSetup />`, alongside `setupHaptics`.
 */
export function setupTapDragGuard(root: ParentNode = document): () => void {
  if (typeof document === 'undefined') return () => {}

  let start: { x: number; y: number } | null = null
  let dragged = false

  const begin = (x: number, y: number) => {
    start = { x, y }
    dragged = false
  }

  const move = (x: number, y: number) => {
    if (!start) return
    if (Math.hypot(x - start.x, y - start.y) > TAP_DRAG_CANCEL_PX) dragged = true
  }

  const end = () => {
    start = null
  }

  const onPointerDown = (e: PointerEvent) => begin(e.clientX, e.clientY)
  const onPointerMove = (e: PointerEvent) => move(e.clientX, e.clientY)
  const onPointerEnd = () => end()

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return
    begin(e.touches[0].clientX, e.touches[0].clientY)
  }
  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 1) return
    move(e.touches[0].clientX, e.touches[0].clientY)
  }
  const onTouchEnd = () => end()

  const onClickCapture = (e: MouseEvent) => {
    if (!dragged) return
    const t = e.target
    if (t instanceof Element && t.closest('.recharts-wrapper')) return
    e.stopImmediatePropagation()
    e.preventDefault()
  }

  const target = root instanceof Document ? root.documentElement : (root as HTMLElement)
  target.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
  target.addEventListener('pointermove', onPointerMove, { capture: true, passive: true })
  target.addEventListener('pointerup', onPointerEnd, { capture: true, passive: true })
  target.addEventListener('pointercancel', onPointerEnd, { capture: true, passive: true })
  target.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
  target.addEventListener('touchmove', onTouchMove, { capture: true, passive: true })
  target.addEventListener('touchend', onTouchEnd, { capture: true, passive: true })
  target.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true })
  target.addEventListener('click', onClickCapture, true)

  return () => {
    target.removeEventListener('pointerdown', onPointerDown, true)
    target.removeEventListener('pointermove', onPointerMove, true)
    target.removeEventListener('pointerup', onPointerEnd, true)
    target.removeEventListener('pointercancel', onPointerEnd, true)
    target.removeEventListener('touchstart', onTouchStart, true)
    target.removeEventListener('touchmove', onTouchMove, true)
    target.removeEventListener('touchend', onTouchEnd, true)
    target.removeEventListener('touchcancel', onTouchEnd, true)
    target.removeEventListener('click', onClickCapture, true)
  }
}
