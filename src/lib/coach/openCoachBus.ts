/**
 * Open Coach from anywhere in the authenticated shell (e.g. ActiveWorkout),
 * even when the caller is not under CoachProvider.
 *
 * Prefer:
 *   import { requestOpenCoach } from '@/lib/coach/openCoachBus'
 *   requestOpenCoach() // compact sheet
 *   requestOpenCoach({ size: 'compact' })
 *   requestOpenCoach({ message: 'How was that workout?' })
 *
 * Or the window event:
 *   window.dispatchEvent(new CustomEvent('grind:open-coach', {
 *     detail: { message: 'How was that workout?', size: 'compact' },
 *   }))
 *
 * CoachProvider subscribes via `subscribeOpenCoach`. If nothing is listening
 * yet (e.g. Coach still mounting / lazy-loading), the request is queued until
 * a subscriber mounts.
 */

export type OpenCoachDetail = {
  /** Prefill+send as a normal user turn (burns quota). */
  message?: string
  /** Default compact — mid-workout / Ask Coach entry uses compact. */
  size?: 'compact' | 'page'
}

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
      size:
        detail.size === 'page' || detail.size === 'compact'
          ? detail.size
          : undefined,
    })
  }
  window.addEventListener(GRIND_OPEN_COACH_EVENT, onEvent)
  return () => window.removeEventListener(GRIND_OPEN_COACH_EVENT, onEvent)
}
