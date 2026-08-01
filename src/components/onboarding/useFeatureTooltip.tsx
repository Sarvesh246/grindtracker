'use client'
import { useCallback, useEffect, useState } from 'react'
import { useOnboarding } from '@/lib/contexts/OnboardingContext'
import Tooltip from './Tooltip'
import type { Side } from './anchor'

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

  // Re-render when the coordinator's active tooltip changes, so a queued hint
  // re-arms as soon as the current one is dismissed.
  const [, force] = useState(0)
  useEffect(() => {
    const h = () => force(v => v + 1)
    window.addEventListener(COORD_EVENT, h)
    return () => window.removeEventListener(COORD_EVENT, h)
  }, [])
  const blockedByOther = activeId !== null && activeId !== id

  // Arm once the condition holds, nothing suppresses it, and no other hint is up.
  useEffect(() => {
    if (seen || visible || !when || suppressed || blockedByOther) return
    const t = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(t)
  }, [seen, visible, when, suppressed, blockedByOther, delayMs])

  // While visible: own the coordinator slot and mark seen (guarantees once-ever).
  useEffect(() => {
    if (!visible) return
    claim(id)
    markTooltipSeen(id)
    return () => release(id)
  }, [visible, id, markTooltipSeen])

  // A modal opening / rest starting mid-display pulls it (already marked seen).
  // Syncing to an external condition (a modal/rest countdown), not derived state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (visible && suppressed) setVisible(false)
  }, [visible, suppressed])

  // Transient auto-hide.
  useEffect(() => {
    if (!visible || !autoHideMs) return
    const t = window.setTimeout(() => setVisible(false), autoHideMs)
    return () => window.clearTimeout(t)
  }, [visible, autoHideMs])

  const dismiss = useCallback(() => setVisible(false), [])

  if (!visible) return null
  return <Tooltip getEl={getEl} body={body} title={title} onDismiss={dismiss} preferred={preferred} maxWidth={maxWidth} />
}
