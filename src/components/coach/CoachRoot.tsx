'use client'

import { Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { CoachProvider } from './CoachProvider'
import CoachFab from './CoachFab'
import CoachSheet from './CoachSheet'

/**
 * Authenticated-shell coach host. Hidden during ActiveWorkout
 * (`/log?day=…`) — same gate as BottomNav.
 */
function CoachGate() {
  const pathname = usePathname()
  const params = useSearchParams()

  if (pathname === '/log' && params.get('day')) return null

  return (
    <CoachProvider>
      <CoachFab />
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
