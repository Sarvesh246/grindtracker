'use client'
import { useCallback, useEffect, useState } from 'react'
import { useOnboarding } from '@/lib/contexts/OnboardingContext'
import { onboardTarget } from './anchor'
import CoachMark from './CoachMark'
import { claimTour, releaseTour, useRunningTourId } from './tourLock'

export interface TourStep {
  /** `data-onboard` attribute value of the element this step highlights. */
  target: string
  title: string
  body: string
}

export interface UseTourOptions {
  /**
   * Gate: the tour only starts (and only stays visible) while this is true.
   * Pages pass `loaded && noModalOpen && noUndoToast` — so the tour waits for
   * content and pauses/defers instead of ever drawing over a modal or toast.
   */
  active: boolean
  /** Settle delay after `active` first becomes true, so nothing shifts under a finger. */
  settleMs?: number
}

/**
 * Orchestrates an ordered array of coach-mark steps: tracks the current index,
 * persists completion/skip via OnboardingContext (so nothing shows twice), and
 * respects the `active` gate. Returns the node to render (or null).
 *
 * - Next / Done / × advance; the last step's Done finishes and marks this tour seen.
 * - "Skip tour" ends onboarding entirely — every future scripted tour on every
 *   page, not just this one. It used to mark only the current tour seen, so
 *   skipping Home still meant getting stopped by Log's, Profile's, etc. as you
 *   explored — from the user's seat that reads as "skip didn't actually skip
 *   anything", so bailing out of any one walkthrough now opts out of all of them.
 *
 * Only one scripted tour runs at a time (`tourLock`). A waiting tour retries
 * once the slot is free (e.g. Coach after Home).
 */
export function useTour(tourId: string, steps: TourStep[], opts: UseTourOptions): React.ReactNode {
  const { hasSeenTour, markTourSeen, skipAllTours } = useOnboarding()
  const { active, settleMs = 500 } = opts
  const running = useRunningTourId()

  const seen = hasSeenTour(tourId)
  const [started, setStarted] = useState(false)
  const [index, setIndex] = useState(0)
  const blocked = running != null && running !== tourId

  // Start once, after the gate opens and a short settle delay. If the gate closes
  // (a modal opens) before the timer fires, the start is cancelled. If another
  // tour owns the slot, wait — `running` in the deps re-arms when it releases.
  useEffect(() => {
    if (seen || started || !active || blocked || steps.length === 0) return
    const t = window.setTimeout(() => {
      if (!claimTour(tourId)) return
      setStarted(true)
    }, settleMs)
    return () => window.clearTimeout(t)
  }, [seen, started, active, blocked, steps.length, settleMs, tourId])

  useEffect(() => {
    if (!started) return
    return () => releaseTour(tourId)
  }, [started, tourId])

  const finish = useCallback(() => {
    setStarted(false)
    markTourSeen(tourId)
  }, [markTourSeen, tourId])

  const advance = useCallback(() => {
    setIndex(i => {
      if (i >= steps.length - 1) {
        finish()
        return i
      }
      return i + 1
    })
  }, [steps.length, finish])

  const back = useCallback(() => setIndex(i => Math.max(0, i - 1)), [])

  const skipTour = useCallback(() => {
    setStarted(false)
    skipAllTours()
  }, [skipAllTours])

  const step = steps[index]
  const getEl = useCallback(() => (step ? onboardTarget(step.target) : null), [step])

  // Render only while genuinely running and the gate is open (pause on modal/toast).
  if (seen || !started || !active || !step) return null

  return (
    <CoachMark
      key={step.target}
      getEl={getEl}
      step={index + 1}
      total={steps.length}
      title={step.title}
      body={step.body}
      isLast={index === steps.length - 1}
      onAdvance={advance}
      onBack={index > 0 ? back : undefined}
      onSkipTour={skipTour}
    />
  )
}
