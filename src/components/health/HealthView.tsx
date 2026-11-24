'use client'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { BodySignalsPanel } from './BodySignalsPanel'
import { GarminHealthDetails } from './GarminHealthDetails'
import ReadinessTrend from './ReadinessTrend'
import type { Charge } from '@/lib/body/charge'
import { receivedText } from '@/lib/health/intraday'
import type { HealthSummary } from '@/lib/health/queries'
import { clockLabel, dateLabel, METRICS, type HealthMetric } from '@/lib/health/model'
import { connectionErrorText, latestSync, relativeTime, SOURCE_LABEL } from '@/lib/health/reconcile'
import { ChevronRight } from '@/components/ui/Icons'
import { CoachButton, RecoveryHeader, WeekStrip, type SyncState } from './recovery/Chrome'
import { weekCharges } from './recovery/model'
import {
  ChargeHero,
  DataSources,
  DayCard,
  DriversCard,
  LongGame,
  MoreSection,
  SleepCard,
  Vitals
} from './recovery/Overview'
import { SleepDetail } from './recovery/SleepDetail'
import { MetricDetail } from './recovery/MetricDetail'
import './recovery/recovery.css'

const STATUS_TEXT = {
  active: 'Connected',
  paused: 'Paused',
  revoked: 'Revoked',
  error: 'Needs attention'
} as const

/** Wall clock for "synced x ago": re-reads every minute and when the app returns to the foreground. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = window.setInterval(tick, 60_000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return now
}

function syncState(
  data: HealthSummary | null,
  error: boolean,
  updating: boolean,
  now: number
): SyncState {
  if (updating) return { state: 'busy', label: 'Updating…' }
  if (error)
    return {
      state: 'error',
      label: data ? 'Couldn’t refresh' : 'Health unavailable'
    }
  if (!data) return { state: 'ok', label: 'Health' }
  const synced = relativeTime(latestSync(data.connections, data.body.days), now)
  if (!data.body.hasWatch && !data.connections.length) return { state: 'ok', label: 'No watch yet' }
  return { state: 'ok', label: synced ? `Synced ${synced}` : 'No recent sync' }
}

function HealthSourceStatus({ data, date }: { data: HealthSummary; date: string }) {
  const now = useNow()
  const { body, connections } = data
  const row = body.days.find((d) => d.local_date === date)
  const provenance = Object.entries(data.provenance[date] ?? {}) as [
    HealthMetric,
    NonNullable<HealthSummary['provenance'][string][HealthMetric]>
  ][]
  return (
    <div className="health-source" id="health-source-panel">
      {connections.length > 0 && (
        <div className="health-source-grid">
          {connections.map((c) => (
            <div className="health-source-card" key={c.id} data-status={c.status}>
              <header>
                {SOURCE_LABEL[c.source]}
                <span>{STATUS_TEXT[c.status]}</span>
              </header>
              <p>
                {c.last_success_at
                  ? `Synced ${relativeTime(c.last_success_at, now)}`
                  : 'Not synced yet'}
              </p>
              {connectionErrorText(c.last_error_code) && (
                <p>{connectionErrorText(c.last_error_code)}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {provenance.length > 0 && (
        <div className="health-table-wrap health-provenance">
          <table>
            <caption>Where {dateLabel(date)}’s values came from</caption>
            <thead>
              <tr>
                <th>Measurement</th>
                <th>Source</th>
                <th>Observed</th>
              </tr>
            </thead>
            <tbody>
              {provenance.map(([field, p]) => (
                <tr key={field}>
                  <th>{METRICS[field].short}</th>
                  <td>
                    {p.source === 'legacy_snapshot'
                      ? 'Watch daily snapshot'
                      : p.source === 'sleep_record'
                        ? 'Sleep record'
                        : SOURCE_LABEL[p.source]}
                  </td>
                  <td>{p.observed_at ? clockLabel(p.observed_at) : 'Time unavailable'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        {receivedText(
          body.syncs.filter((s) => s.local_date === date),
          row?.synced_at ?? null
        )}
      </p>
      <Link href="/profile/settings#health">
        Manage connections
        <ChevronRight size={14} />
      </Link>
    </div>
  )
}

export function HealthView({
  data,
  date,
  today,
  view = 'overview',
  metric,
  error = false,
  updating = false,
  charges,
  onRefresh,
  onDate
}: {
  data: HealthSummary | null
  date: string
  today: string
  view?: 'overview' | 'sleep' | 'metric'
  metric?: HealthMetric
  error?: boolean
  updating?: boolean
  /** Charges kept from earlier loads, for days after the selected one. */
  charges?: ReadonlyMap<string, Charge | null>
  onRefresh: () => void
  onDate: (date: string) => void
}) {
  const now = useNow()
  const body = data?.body
  const local = useMemo(() => (body ? weekCharges(body, date) : null), [body, date])
  const strip = useMemo(() => new Map([...(charges ?? []), ...(local ?? [])]), [charges, local])
  const availableDates = useMemo(
    () => [
      ...(data?.body.days.map((d) => d.local_date) ?? []),
      ...(data?.sleeps.map((s) => s.wake_date) ?? [])
    ],
    [data]
  )
  const title =
    view === 'sleep' ? 'Sleep' : view === 'metric' && metric ? METRICS[metric].short : 'Recovery'
  const coachDraft = `Give me my body readout for ${date}: what my recovery, sleep, HRV, resting HR, stress and Body Battery mean together compared with my usual, what changed and why, and how hard I should train today.`
  return (
    <div className="rcv">
      <RecoveryHeader
        title={title}
        date={date}
        today={today}
        backHref={view === 'overview' ? '/progress' : `/progress/health?date=${date}`}
        backLabel={view === 'overview' ? 'Progress' : 'Recovery'}
        sync={syncState(data, error, updating, now)}
        onRefresh={onRefresh}
      >
        {view !== 'metric' && (
          <WeekStrip
            date={date}
            today={today}
            charges={strip}
            availableDates={availableDates}
            onDate={onDate}
          />
        )}
      </RecoveryHeader>
      {error && (
        <p role="alert" className="health-error">
          Couldn’t refresh health data.
        </p>
      )}
      {!data ? (
        error ? null : (
          <div className="health-skeleton" role="status" aria-label="Loading health records">
            <div />
            <div />
            <div />
          </div>
        )
      ) : view === 'sleep' ? (
        <>
          <SleepDetail data={data} date={date} />
          <DataSources>
            <HealthSourceStatus data={data} date={date} />
          </DataSources>
        </>
      ) : view === 'metric' && metric ? (
        <MetricDetail data={data} date={date} metric={metric} />
      ) : (
        <div className="rcv-overview">
          <ChargeHero
            charge={data.body.charge}
            coachDraft={coachDraft}
            connect={!data.body.hasWatch && !data.sleeps.length && data.sleepState !== 'error'}
          />
          {data.body.charge && <DriversCard charge={data.body.charge} />}
          <SleepCard data={data} date={date} today={today} />
          <DayCard data={data} date={date} today={today} />
          {data.history.length > 0 ? (
            <Vitals data={data} date={date} />
          ) : data.historyError ? (
            <section className="rcv-card rcv-card-pad rcv-a-vitals">
              <p className="rcv-muted" role="alert">
                Couldn’t load measurements.
              </p>
              <button
                type="button"
                className="health-text-button"
                data-haptic="light"
                onClick={onRefresh}
              >
                Retry
              </button>
            </section>
          ) : null}
          <LongGame data={data} date={date} />
          <CoachButton
            className="rcv-coach--mobile rcv-rise"
            label={date === today ? 'Ask Coach about today' : `Ask Coach about ${dateLabel(date)}`}
            draft={coachDraft}
          />
          <MoreSection>
            {data.sleeps.length > 0 && (
              <Link
                href="/progress/health/energy"
                className="energy-entry press-card"
                data-haptic="light"
              >
                <span className="energy-entry-wave" aria-hidden="true">
                  <svg width="44" height="28" viewBox="0 0 44 28" fill="none">
                    <path
                      d="M2 20C7 20 9 6 15 6s7 14 12 14 7-10 15-12"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <span className="energy-entry-body">
                  <strong>Energy</strong>
                  <span>Your peaks, dips and wind-down today</span>
                </span>
                <ChevronRight size={20} className="health-arrow" />
              </Link>
            )}
            {body?.signals && (date === today || body.signals.source === 'garmin_personal') && (
              <section className="health-panel" id="signals" style={{ '--i': 0 } as CSSProperties}>
                <div className="health-section-head">
                  <h2>Body signals</h2>
                </div>
                <BodySignalsPanel
                  key={body.signals.date}
                  signals={body.signals}
                  record={body.signalRecord}
                  labelsError={body.labelsError}
                />
              </section>
            )}
            {body?.hasWatch && (
              <section
                className="health-panel"
                id="readiness"
                style={{ '--i': 0 } as CSSProperties}
              >
                <div className="health-section-head">
                  <h2>Readiness</h2>
                </div>
                <ReadinessTrend
                  checks={body.readinessChecks}
                  date={date}
                  failed={body.readinessError}
                />
              </section>
            )}
            <GarminHealthDetails data={data.garmin} date={date} />
            <DataSources>
              <HealthSourceStatus data={data} date={date} />
            </DataSources>
          </MoreSection>
        </div>
      )}
      {data && <footer className="health-footer">Not medical advice.</footer>}
    </div>
  )
}
