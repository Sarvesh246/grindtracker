'use client'

import { Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { CoachProvider } from './CoachProvider'
import CoachFab from './CoachFab'
import CoachSheet from './CoachSheet'

/**
 * Authenticated-shell coach host.
 *
 * Mid-workout (`/log?day=…`): stay mounted (sheet can open via Ask Coach /
 * `requestOpenCoach`) but hide the default FAB — same route gate as BottomNav
 * for chrome density, without unmounting Coach entirely.
 */
function CoachGate() {
  const pathname = usePathname()
  const params = useSearchParams()
  const workoutSlim = pathname === '/log' && !!params.get('day')

  return (
    <CoachProvider workoutSlim={workoutSlim}>
      {!workoutSlim ? <CoachFab /> : null}
      <CoachSheet />
    </CoachProvider>
  )
}

export default function CoachRoot() {
  return (
    <Suspense fallback={null}>
      <CoachGate />
    </Suspense>
  )
}
