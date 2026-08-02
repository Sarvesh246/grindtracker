'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useOnboarding } from '@/lib/contexts/OnboardingContext'
import Tooltip from './Tooltip'
import { ensureVisible, type Side } from './anchor'

/**
 * One-off, use-case-based contextual hint — the ActiveWorkout onboarding model.
 * Shows a single {@link Tooltip} near a target the first time `when` becomes true,
 * marks it seen the moment it appears (so it fires at most once, ever, even if the
 * user reloads without dismissing), and never returns after that.
 *
 * No steps, no "skip tour" chrome — just a one-liner and a small ×. `suppressed`
 * defers it while it must not show (a modal is open, or a rest countdown is
 * running); an optional `autoHideMs` covers transient hints (e.g. the 5s undo).
 *
 * A process-wide coordinator shows only ONE feature tooltip at a time: on a busy
 * screen many hints can become eligible at once (the first workout has a check,
 * plate, warm-up, note, skip… all on screen), and stacking them would be naggy
 * and overlap. They queue instead — the next eligible one appears once the
 * current is dismissed.
 *
 * Unlike scripted tours, these are NOT affected by "Skip all tours" — they're
 * functional hints, opt-in per id.
 */
export interface FeatureTooltipOptions {
  /** Arm the hint (control is visible / relevant). */
  when: boolean
  /** Resolves the element to anchor to. */
  getEl: () => HTMLElement | null
  body: string
  title?: string
  /** Defer while true (modal open, rest countdown active). */
  suppressed?: boolean
  delayMs?: number
  /** Auto-hide after this many ms (for transient hints). */
  autoHideMs?: number
  preferred?: Side[]
  maxWidth?: number
}

// ── One-at-a-time coordinator ────────────────────────────────────────────────
let activeId: string | null = null
const COORD_EVENT = 'grind:feature-tooltip-active'

function claim(id: string) {
  activeId = id
  try { window.dispatchEvent(new Event(COORD_EVENT)) } catch {}
}
function release(id: string) {
  if (activeId === id) {
    activeId = null
    try { window.dispatchEvent(new Event(COORD_EVENT)) } catch {}
  }
}

export function useFeatureTooltip(id: string, opts: FeatureTooltipOptions): React.ReactNode {
  const { hasSeenTooltip, markTooltipSeen } = useOnboarding()
  const { when, getEl, body, title, suppressed = false, delayMs = 450, autoHideMs, preferred, maxWidth } = opts

  const seen = hasSeenTooltip(id)
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const EXIT_MS = 160

  // Fades the bubble out over EXIT_MS before actually unmounting it, instead
  // of every dismiss path (×, anchor click, suppression, auto-hide) cutting
  // it out instantly.
  const requestHide = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    window.setTimeout(() => {
      closingRef.current = false
      setVisible(false)
      setClosing(false)
    }, EXIT_MS)
  }, [])

  // Re-render when the coordinator's active tooltip changes, so a queued hint
  // re-arms as soon as the current one is dismissed.
  const [, force] = useState(0)
  useEffect(() => {
    const h = () => force(v => v + 1)
    window.addEventListener(COORD_EVENT, h)
    return () => window.removeEventListener(COORD_EVENT, h)
  }, [])
  const blockedByOther = activeId !== null && activeId !== id

  // Latest `getEl` in a ref rather than an effect dep: callers pass a fresh arrow
  // function every render (e.g. `() => onboardTarget('aw-check')`), and while a
  // rest-timer countdown is running ActiveWorkout re-renders every 250ms — an
  // identity-based dep would tear down and restart the arm timer on every one of
  // those renders and the hint would never survive long enough to fire.
  const getElRef = useRef(getEl)
  useEffect(() => {
    getElRef.current = getEl
  })

  // Arm once the condition holds, nothing suppresses it, and no other hint is up.
  //
  // The slot is claimed SYNCHRONOUSLY inside the timer callback, not later in the
  // "visible" effect. On a busy screen many hints arm in the same tick with the
  // same delay, so their timers fire back-to-back; claiming only after React
  // committed each one let every timer pass the guard first and they all showed
  // at once (the crowding bug). Because `activeId` is a module global set the
  // instant the first timer fires, every sibling timer that runs after it in the
  // same frame sees the slot taken and stands down — leaving exactly one hint up,
  // the rest queued behind the COORD_EVENT re-arm.
  useEffect(() => {
    if (seen || visible || !when || suppressed || blockedByOther) return
    const t = window.setTimeout(() => {
      if (activeId !== null && activeId !== id) return
      claim(id)
      ensureVisible(getElRef.current())
      setVisible(true)
    }, delayMs)
    return () => window.clearTimeout(t)
  }, [seen, visible, when, suppressed, blockedByOther, delayMs, id])

  // While visible: keep the coordinator slot (claim is idempotent) and mark seen
  // (guarantees once-ever), releasing it for the next queued hint on unmount.
  useEffect(() => {
    if (!visible) return
    claim(id)
    markTooltipSeen(id)
    return () => release(id)
  }, [visible, id, markTooltipSeen])

  // A modal opening / rest starting mid-display pulls it (already marked seen).
  // Syncing to an external condition (a modal/rest countdown), not derived state.
  useEffect(() => {
    if (visible && !closing && suppressed) requestHide()
  }, [visible, closing, suppressed, requestHide])

  // Transient auto-hide.
  useEffect(() => {
    if (!visible || !autoHideMs) return
    const t = window.setTimeout(requestHide, autoHideMs)
    return () => window.clearTimeout(t)
  }, [visible, autoHideMs, requestHide])

  // Dismiss the moment the user interacts with the anchor itself — a hint
  // pointing at a button shouldn't outlive a tap on that button. Without this
  // a hint like aw-rest-adjust stays on screen (and, being higher z-index,
  // visually covers) the panel its own target button just opened.
  useEffect(() => {
    if (!visible) return
    const handler = (e: PointerEvent) => {
      const el = getElRef.current()
      if (el && e.target instanceof Node && el.contains(e.target)) requestHide()
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [visible, requestHide])

  if (!visible) return null
  return <Tooltip getEl={getEl} body={body} title={title} onDismiss={requestHide} closing={closing} preferred={preferred} maxWidth={maxWidth} />
}
