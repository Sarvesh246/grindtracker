'use client'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import DaySelect from './DaySelect'
import ActiveWorkout from './ActiveWorkout'

function LogInner() {
  const searchParams = useSearchParams()
  const day = searchParams.get('day') as 'push' | 'pull' | 'legs' | null

  if (!day || !['push', 'pull', 'legs'].includes(day)) {
    return <DaySelect />
  }

  return <ActiveWorkout day={day} />
}

export default function LogPage() {
  return (
    <Suspense fallback={
      <div style={{ padding: '24px 16px', color: '#555555', fontFamily: "'DM Sans', sans-serif" }}>
        Loading...
      </div>
    }>
      <LogInner />
    </Suspense>
  )
}
