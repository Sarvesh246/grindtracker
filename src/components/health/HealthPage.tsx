'use client'
import { useEffect, useSyncExternalStore } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { localDateKey } from '@/lib/utils/formatting'
import { getUiState, setUiState } from '@/lib/cache/appDataCache'
import { validDate, type HealthMetric } from '@/lib/health/model'
import { HealthView } from './HealthView'
import { useHealthSummary } from './useHealthSummary'
import { ChevronLeft } from '@/components/ui/Icons'
import './health.css'

function subscribeDate(cb: () => void) {
  window.addEventListener('focus', cb)
  document.addEventListener('visibilitychange', cb)
  const timer = setInterval(cb, 60_000)
  return () => {
    clearInterval(timer)
    window.removeEventListener('focus', cb)
    document.removeEventListener('visibilitychange', cb)
  }
}
const serverDate = () => null

type HealthPageProps = {
  requestedDate?: string
  view?: 'overview' | 'sleep' | 'metric'
  metric?: HealthMetric
}
export default function HealthPage(props: HealthPageProps) {
  if (process.env.NEXT_PUBLIC_HEALTH_PAGE_ENABLED === 'false')
    return (
      <section className="page health-page">
        <h1>Health unavailable</h1>
        <Link href="/progress">
          <ChevronLeft size={14} />
          Progress
        </Link>
      </section>
    )
  return <HealthPageContent {...props} />
}
function HealthPageContent({ requestedDate, view = 'overview', metric }: HealthPageProps) {
  const today = useSyncExternalStore(subscribeDate, localDateKey, serverDate)
  const date = today
    ? validDate(requestedDate) && requestedDate <= today
      ? requestedDate
      : today
    : null
  const router = useRouter()
  const path = usePathname()
  useEffect(() => {
    const main = document.querySelector('.app-main')
    if (main) main.scrollTop = 0
    const restore = getUiState<{ scroll: number; ready: boolean }>('progress:health-return')
    if (restore && !restore.ready) setUiState('progress:health-return', { ...restore, ready: true })
  }, [path])
  const state = useHealthSummary(date)
  return (
    <div className="page health-page rcv-page">
      {state.demoMode ? (
        <section className="health-panel">
          <h2>Health is private</h2>
          <p>
            Turn off Demo Mode to view your own health records. Real measurements never appear in a
            demo.
          </p>
        </section>
      ) : date && today ? (
        <HealthView
          data={state.data}
          error={state.error}
          updating={state.updating}
          charges={state.charges}
          date={date}
          today={today}
          view={view}
          metric={metric}
          onRefresh={state.refresh}
          onDate={(next) => {
            if (validDate(next) && next <= today)
              router.replace(`${path}?date=${next}`, { scroll: false })
          }}
        />
      ) : (
        <div className="health-skeleton" aria-label="Loading local date" role="status">
          <div />
        </div>
      )}
    </div>
  )
}
