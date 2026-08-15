/**
 * Geometry helpers for iOS PWA tap retargeting.
 *
 * WebKit can desync the native hit-test matrix from what you see (leftover
 * visualViewport pan, iOS 26 status-bar offset ~47–59px). Finger coordinates
 * from touch events stay correct; `getBoundingClientRect()` usually matches
 * the pixels. Native `<input switch>` hit-testing (haptic overlays) and
 * `elementFromPoint` can land ~a status-bar lower — which is why Save can
 * fire Add Set, and why opening the keyboard (forcing a VV reset) "fixes"
 * touch points until it drifts again.
 */

export type HitPoint = { x: number; y: number }

export type HitRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type HitHost<T> = { el: T; rect: HitRect }

/** Treat a few CSS px of finger wobble as still inside the control. */
export const TOUCH_HIT_SLOP_PX = 2

const FINGER_TTL_MS = 1500

let lastFinger: { x: number; y: number; at: number } | null = null

export function recordFinger(x: number, y: number): void {
  lastFinger = { x, y, at: Date.now() }
}

export function lastFingerPoint(): HitPoint | null {
  if (!lastFinger) return null
  if (Date.now() - lastFinger.at > FINGER_TTL_MS) {
    lastFinger = null
    return null
  }
  return { x: lastFinger.x, y: lastFinger.y }
}

export function clearLastFinger(): void {
  lastFinger = null
}

export function pointInRect(
  p: HitPoint,
  r: HitRect,
  slop: number = TOUCH_HIT_SLOP_PX,
): boolean {
  return (
    p.x >= r.left - slop &&
    p.x <= r.right + slop &&
    p.y >= r.top - slop &&
    p.y <= r.bottom + slop
  )
}

export function rectFromDOMRect(r: DOMRect): HitRect {
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  }
}

/**
 * Candidate points in case touch `clientY` and layout rects disagree by a
 * leftover visualViewport pan (offsetTop / offsetLeft).
 */
export function touchHitCandidates(
  x: number,
  y: number,
  offsetLeft = 0,
  offsetTop = 0,
): HitPoint[] {
  const pts: HitPoint[] = [{ x, y }]
  if (offsetLeft !== 0 || offsetTop !== 0) {
    pts.push({ x: x + offsetLeft, y: y + offsetTop })
    pts.push({ x: x - offsetLeft, y: y - offsetTop })
  }
  return pts
}

/**
 * Prefer the smallest control whose box contains any of `points`.
 *
 * Rank the **raw finger point first** (points[0]). ±visualViewport candidates
 * are a fallback for leftover pan, not a second chance to pick a stacked
 * sibling: Sign Out and Delete My Data are the same size, 14px apart, so
 * `y - offsetTop` on a Delete tap lands on Sign Out and used to win.
 */
export function pickSmallestContainingHost<T>(
  hosts: HitHost<T>[],
  points: HitPoint[],
  slop: number = TOUCH_HIT_SLOP_PX,
): T | null {
  if (points.length === 0) return null
  const raw = pickSmallestContainingAny(hosts, points.slice(0, 1), slop)
  if (raw) return raw
  return pickSmallestContainingAny(hosts, points.slice(1), slop)
}

function pickSmallestContainingAny<T>(
  hosts: HitHost<T>[],
  points: HitPoint[],
  slop: number,
): T | null {
  let best: { el: T; area: number } | null = null
  for (const host of hosts) {
    if (host.rect.width < 1 || host.rect.height < 1) continue
    if (!points.some(p => pointInRect(p, host.rect, slop))) continue
    const area = host.rect.width * host.rect.height
    if (!best || area < best.area) best = { el: host.el, area }
  }
  return best?.el ?? null
}
