'use client'

import { Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { CoachProvider } from './CoachProvider'
import CoachFab from './CoachFab'
import CoachSheet from './CoachSheet'

/**
 * Authenticated-shell coach host.
 *
 * Live workouts and Settings have their own Coach entry points.
 * Keep the sheet mounted when the floating launcher is hidden.
 */
function CoachGate() {
  const pathname = usePathname()
  const params = useSearchParams()
  const workoutSlim = pathname === '/log' && !!params.get('day')
  const showFab = !workoutSlim && pathname !== '/profile/settings'

  return (
    <CoachProvider workoutSlim={workoutSlim}>
      {showFab && <CoachFab />}
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
