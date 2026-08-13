/**
 * Open Coach with an optional prefilled message (spends quota when sent).
 *
 * Prefer the window event from app UI:
 *   window.dispatchEvent(new CustomEvent('grind:open-coach', {
 *     detail: { message: 'How was that workout?' },
 *   }))
 *
 * CoachProvider subscribes via `subscribeOpenCoach`. If nothing is listening
 * yet (e.g. right after navigating off ActiveWorkout where Coach is gated),
 * the request is queued until a subscriber mounts.
 */

export type OpenCoachDetail = { message?: string }

type Listener = (detail: OpenCoachDetail) => void

const listeners = new Set<Listener>()
let pending: OpenCoachDetail | null = null

export const GRIND_OPEN_COACH_EVENT = 'grind:open-coach'

export function requestOpenCoach(detail: OpenCoachDetail = {}): void {
  if (listeners.size === 0) {
    pending = detail
    return
  }
  for (const fn of listeners) fn(detail)
}

export function subscribeOpenCoach(fn: Listener): () => void {
  listeners.add(fn)
  if (pending) {
    const detail = pending
    pending = null
    fn(detail)
  }
  return () => {
    listeners.delete(fn)
  }
}

/** Bridge CustomEvent → bus (call once from CoachProvider). */
export function bindOpenCoachWindowEvent(): () => void {
  if (typeof window === 'undefined') return () => {}
  function onEvent(e: Event) {
    const ce = e as CustomEvent<OpenCoachDetail>
    const detail =
      ce.detail && typeof ce.detail === 'object' ? ce.detail : {}
    requestOpenCoach({
      message:
        typeof detail.message === 'string' ? detail.message : undefined,
    })
  }
  window.addEventListener(GRIND_OPEN_COACH_EVENT, onEvent)
  return () => window.removeEventListener(GRIND_OPEN_COACH_EVENT, onEvent)
}
