import { HealthEntry } from '../../src/components/health/HealthEntry'
import React, { useState } from 'react'
import { date, data } from './healthData'
import { createRoot } from 'react-dom/client'
import { emptyBodySummary } from '../../src/lib/body/queries'
import { HealthDateHeader, HealthView } from '../../src/components/health/HealthView'
import { subscribeOpenCoach } from '../../src/lib/coach/openCoachBus'

declare global {
  interface Window {
    healthFixture: { draft?: string; sent?: string; refreshes: number }
  }
}
window.healthFixture = { refreshes: 0 }
subscribeOpenCoach((detail) => {
  window.healthFixture.draft = detail.draft
  window.healthFixture.sent = detail.message
})
function Fixture() {
  const params = new URLSearchParams(location.search)
  const state = params.get('state') ?? 'populated'
  const view = (params.get('view') ?? 'overview') as 'overview' | 'sleep' | 'metric'
  const [selected, setSelected] = useState(date)
  const value =
    state === 'disconnected'
      ? {
          ...data,
          body: { ...emptyBodySummary(date), available: true },
          sleeps: [],
          history: [],
          sleepState: 'not_enabled' as const
        }
      : state === 'partial'
        ? { ...data, sleeps: [], sleepState: 'not_enabled' as const }
        : state === 'garmin' ? {
          ...data,
          garmin: {
            history: [{ local_date: date, overnight_hrv: 49, weight_kg: 80, sleep_spo2: 96 }],
            selected: { hrv_status: 'BALANCED', hrv_baseline_low: 45, hrv_baseline_high: 55 }
          }
        } : data
  return (
    <div className="page health-page">
      <p className="health-muted" style={{ marginBottom: 16 }}>
        SYNTHETIC DATA · UI REVIEW ONLY
      </p>
      {view === 'overview' && (
        <div style={{ marginBottom: 24 }}>
          <HealthEntry body={value.body} />
        </div>
      )}
      <HealthDateHeader date={selected} today="2026-11-17" view={view} onDate={setSelected} />
      <HealthView
        data={state === 'loading' || state === 'error' ? null : value}
        date={selected}
        today="2026-11-17"
        view={view}
        metric="resting_hr"
        error={state === 'error' || state === 'delayed'}
        updating={state === 'loading'}
        onRefresh={() => {
          window.healthFixture.refreshes++
        }}
      />
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
