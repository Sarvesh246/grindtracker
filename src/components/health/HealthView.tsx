'use client'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { BodySignalsPanel } from './BodySignalsPanel'
import type { BodySummary } from '@/lib/body/queries'
import { receivedText } from '@/lib/health/intraday'
import type { HealthSummary } from '@/lib/health/queries'
import {
  clockLabel,
  dailyBrief,
  dayAnnotations,
  intradayEnvelope,
  dateLabel,
  duration,
  mainSleep,
  METRICS,
  metricBaseline,
  metricValue,
  seriesStats,
  shiftDate,
  sleepComparison,
  sleepConsistency,
  type Baseline,
  type HealthMetric
} from '@/lib/health/model'
import { Ring } from '@/components/body/ChargeRing'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import {
  connectionErrorText,
  relativeTime,
  latestSync,
  SOURCE_LABEL,
  sourceLabel
} from '@/lib/health/reconcile'
import { requestOpenCoach } from '@/lib/coach/openCoachBus'
import Dialog from '@/components/ui/Dialog'
import ReadinessTrend from './ReadinessTrend'
import { ChevronDown, ChevronLeft, ChevronRight, CloseIcon } from '@/components/ui/Icons'
import {
  DailyHealthTimeline,
  SeriesPlot,
  SleepStageChart,
  Sparkline,
  StageBreakdown
} from './HealthCharts'

function Panel({
  title,
  id,
  action,
  children,
  className = '',
  index = 0
}: {
  title: string
  id?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  index?: number
}) {
  return (
    <section
      id={id}
      className={`health-panel ${className}`}
      style={{ '--i': index } as CSSProperties}
    >
      <div className="health-section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const DAY_STRIP = 21

export function HealthDateHeader({
  date,
  today,
  view = 'overview',
  onDate,
  availableDates = []
}: {
  date: string
  today: string
  view?: string
  onDate: (date: string) => void
  availableDates?: string[]
}) {
  const [calendarOpen, setCalendarOpen] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)
  // Keep the strip's window stable while browsing; only slide it for far-back dates.
  const end =
    date >= shiftDate(today, -(DAY_STRIP - 1))
      ? today
      : shiftDate(date, 10) > today
        ? today
        : shiftDate(date, 10)
  const days = Array.from({ length: DAY_STRIP }, (_, i) => shiftDate(end, i - (DAY_STRIP - 1)))
  useEffect(() => {
    const strip = stripRef.current
    const current = strip?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!strip || !current) return
    strip.scrollTo({
      left: current.offsetLeft - (strip.clientWidth - current.clientWidth) / 2,
      behavior: 'auto'
    })
  }, [date, end])
  return (
    <header className="health-header">
      <div className="health-topline">
        <Link
          href={view === 'overview' ? '/progress' : `/progress/health?date=${date}`}
          data-haptic="light"
        >
          <ChevronLeft size={14} />
          {view === 'overview' ? 'Progress' : 'Health'}
        </Link>
        <span className="health-eyebrow">GRIND / DAILY HEALTH</span>
      </div>
      <div className="health-title-row">
        <h1>{view === 'sleep' ? 'SLEEP' : view === 'overview' ? 'HEALTH' : 'YOUR METRICS'}</h1>
      </div>
      <div className="health-date-controls">
        <button
          aria-label="Previous day"
          data-haptic="light"
          onClick={() => onDate(shiftDate(date, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="health-calendar-open"
          data-haptic="light"
          aria-label="Choose health date"
          onClick={() => setCalendarOpen(true)}
        >
          <span>
            {date === today && <em>Today</em>}
            {dateLabel(date)}
          </span>
          <ChevronDown size={14} />
        </button>
        <button
          aria-label="Next day"
          data-haptic="light"
          disabled={date >= today}
          onClick={() => onDate(shiftDate(date, 1))}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="health-strip scrollbar-hide" ref={stripRef}>
        {days.map((key) => {
          const when = new Date(`${key}T12:00:00`)
          const has = availableDates.includes(key)
          return (
            <button
              key={key}
              type="button"
              data-haptic="light"
              aria-pressed={date === key}
              data-today={key === today}
              aria-label={`${dateLabel(key)}${has ? ', records available' : ''}`}
              onClick={() => onDate(key)}
            >
              <small aria-hidden="true">
                {when.toLocaleDateString(undefined, { weekday: 'narrow' })}
              </small>
              <b aria-hidden="true">{when.getDate()}</b>
              <i aria-hidden="true" data-on={has} />
            </button>
          )
        })}
      </div>
      <Dialog
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        labelledBy="health-calendar-title"
        panelStyle={{ maxWidth: 440 }}
      >
        <div className="health-page health-calendar">
          <div className="health-section-head">
            <h2 id="health-calendar-title">Choose a date</h2>
            <button aria-label="Close date picker" onClick={() => setCalendarOpen(false)}>
              <CloseIcon size={18} />
            </button>
          </div>
          <label>
            Selected health date
            <input
              aria-label="Selected health date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => {
                if (e.target.value && e.target.value <= today) onDate(e.target.value)
              }}
            />
          </label>
          <div className="health-calendar-grid">
            {Array.from({ length: 28 }, (_, i) => shiftDate(today, i - 27)).map((key) => (
              <button
                key={key}
                data-haptic="light"
                aria-pressed={date === key}
                aria-label={`${dateLabel(key)}${availableDates.includes(key) ? ', records available' : ''}`}
                onClick={() => {
                  onDate(key)
                  setCalendarOpen(false)
                }}
              >
                <span>{new Date(`${key}T12:00:00`).getDate()}</span>
                <i aria-hidden="true" data-on={availableDates.includes(key)} />
              </button>
            ))}
          </div>
          <button onClick={() => setCalendarOpen(false)}>Done</button>
        </div>
      </Dialog>
    </header>
  )
}

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

function sourceSummary(data: HealthSummary, date: string, now: number): string {
  const { body, connections } = data
  const row = body.days.find((d) => d.local_date === date)
  const lastSync = latestSync(connections, body.days)
  const synced = relativeTime(lastSync, now)
  if (!body.hasWatch && !connections.length) return 'Connection & data sources'
  return `Garmin${body.hasWatch ? ' watch' : ''}${synced ? ` · synced ${synced}` : row ? ` · snapshot ${dateLabel(date)}` : ' · no snapshot'}`
}

function HealthSourceStatus({
  data,
  date,
  id
}: {
  data: HealthSummary
  date: string
  id?: string
}) {
  const now = useNow()
  const { body, connections } = data
  const row = body.days.find((d) => d.local_date === date)
  const provenance = Object.entries(data.provenance[date] ?? {}) as [
    HealthMetric,
    NonNullable<HealthSummary['provenance'][string][HealthMetric]>
  ][]
  return (
    <div className="health-source" id={id}>
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
      <p>{receivedText(body.syncs.filter((s) => s.local_date === date), row?.synced_at ?? null)}</p>
      <Link href="/profile/settings#health">
        Manage connections
        <ChevronRight size={14} />
      </Link>
    </div>
  )
}

/** 7h 18m with quiet units, so the numbers carry the weight. */
function DurationText({ seconds }: { seconds: number }) {
  const minutes = Math.round(seconds / 60)
  const h = Math.floor(minutes / 60),
    m = minutes % 60
  return (
    <span aria-hidden="true">
      {h > 0 && (
        <>
          {h}
          <small>h</small>{' '}
        </>
      )}
      {m}
      <small>m</small>
    </span>
  )
}

function CoachIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.5 12.2a8 8 0 0 1-11.6 7.1L4 20.5l1.3-4.4A8 8 0 1 1 20.5 12.2Z" />
      <path
        d="m12.2 8.2.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  )
}

function DailyHealthBrief({ data, date }: { data: HealthSummary; date: string }) {
  const row = data.body.todayRow
  const sleep = mainSleep(data.sleeps, date)
  const brief = dailyBrief(row, sleep, data.sleeps)
  const stats = [
    sleep && {
      label: 'Sleep',
      value: duration(sleep.duration_seconds),
      unit: ''
    },
    data.body.charge && {
      label: 'Charge',
      value: String(data.body.charge.score),
      unit: '/100'
    },
    row?.resting_hr != null && {
      label: 'Resting HR',
      value: String(row.resting_hr),
      unit: 'bpm'
    }
  ].filter((v): v is { label: string; value: string; unit: string } => !!v)
  return (
    <section className="health-brief" style={{ '--i': 0 } as CSSProperties}>
      <p className="health-eyebrow">{dateLabel(date)}</p>
      <h2>{brief.headline}</h2>
      {brief.text && <p>{brief.text}</p>}
      {stats.length > 0 && (
        <dl className="health-facts">
          {stats.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>
                <strong>{f.value}</strong>
                {f.unit && <small>{f.unit}</small>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="health-brief-actions">
        <button
          className="health-text-button"
          data-haptic="light"
          onClick={() =>
            requestOpenCoach({
              draft: `Give me my body readout for ${date}: what my recovery, sleep, HRV, resting HR, stress and Body Battery mean together compared with my usual, what changed and why, and how hard I should train today.`
            })
          }
        >
          <CoachIcon />
          Ask Coach
        </button>
      </div>
    </section>
  )
}

const FIELD_NAME = {
  stages: 'Stage timeline',
  stage_totals: 'Stage totals',
  score: 'Sleep score',
  overnight_hrv: 'Overnight HRV',
  respiration: 'Respiration',
  spo2: 'Oxygen'
} as const
/** "Garmin data export · stage timeline from Apple Health": where this night's numbers came from. */
function sleepSourcesNote(sleep: NonNullable<ReturnType<typeof mainSleep>>): string {
  const borrowed = Object.entries(sleep.fields_from ?? {}) as [keyof typeof FIELD_NAME, string][]
  if (!borrowed.length) return sourceLabel(sleep.source)
  const bySource = new Map<string, string[]>()
  for (const [field, source] of borrowed)
    bySource.set(source, [...(bySource.get(source) ?? []), FIELD_NAME[field].toLowerCase()])
  return `${sourceLabel(sleep.source)} · ${[...bySource].map(([src, fields]) => `${fields.join(' and ')} from ${sourceLabel(src)}`).join(' · ')}`
}

function SleepSummary({
  data,
  date,
  today,
  detail = false
}: {
  data: HealthSummary
  date: string
  today: string
  detail?: boolean
}) {
  const sleep = mainSleep(data.sleeps, date)
  const latestHrv = detail && sleep?.overnight_hrv == null
    ? [...new Set(data.sleeps.filter(s => s.wake_date < date && s.overnight_hrv != null).map(s => s.wake_date))]
      .sort().reverse().map(day => mainSleep(data.sleeps, day)).find(s => s?.overnight_hrv != null)
    : null
  const naps = data.sleeps.filter((s) => s.wake_date === date && s.kind === 'nap')
  return (
    <Panel
      title={
        detail
          ? 'Selected sleep'
          : date === today && sleep
            ? 'Last night'
            : `Sleep · ${dateLabel(date)}`
      }
      id="sleep"
      index={2}
      action={
        !detail && (
          <Link href={`/progress/health/sleep?date=${date}`}>
            Details
            <ChevronRight size={14} />
          </Link>
        )
      }
    >
      {!sleep ? (
        <div className="health-empty">
          <span className="health-empty-icon" aria-hidden="true">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
            </svg>
          </span>
          {data.sleepState === 'error' ? (
            <h3>Couldn’t load sleep</h3>
          ) : (
            <>
              <h3>{naps.length ? 'Nap only' : 'No sleep recorded'}</h3>
              <Link href="/profile/settings#health-import">
                Add sleep data
                <ChevronRight size={14} />
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="health-measurement">
            <strong aria-label={duration(sleep.duration_seconds)}>
              <DurationText seconds={sleep.duration_seconds} />
            </strong>
            {sleep.score != null && (
              <span className="health-score">
                Sleep score <b>{sleep.score}</b>
              </span>
            )}
          </div>
          <p className="health-times">
            {clockLabel(sleep.start_at, sleep.timezone)} –{' '}
            {clockLabel(sleep.end_at, sleep.timezone)}{' '}
            <span className="health-muted">· {sleep.timezone}</span>
          </p>
          {sleep.fields_from && <p className="health-sources-note">{sleepSourcesNote(sleep)}</p>}
          <StageBreakdown sleep={sleep} />
          <SleepStageChart sleep={sleep} />
          {sleepComparison(sleep, data.sleeps) && (
            <p className="health-insight">{sleepComparison(sleep, data.sleeps)}</p>
          )}
          {detail && (
            <>
              <p className="health-muted">
                Time in bed{' '}
                {duration((Date.parse(sleep.end_at) - Date.parse(sleep.start_at)) / 1000)}
              </p>
              <h3 className="health-subhead">Overnight measurements</h3>
              {sleep.overnight_hrv == null && (
                <p className="health-muted">
                  No overnight HRV was imported for this night.
                  {latestHrv && ` Latest available: ${latestHrv.overnight_hrv} ms on ${dateLabel(latestHrv.wake_date)}.`}
                  {' '}Import Garmin sleep and health status in Settings.
                </p>
              )}
              {(sleep.overnight_hrv != null || sleep.respiration != null || sleep.spo2 != null) && (
                <div className="health-mini-stats">
                  {sleep.overnight_hrv != null && (
                    <div>
                      <span>HRV</span>
                      <strong>{sleep.overnight_hrv}</strong>
                      <small>ms</small>
                    </div>
                  )}
                  {sleep.respiration != null && (
                    <div>
                      <span>Respiration</span>
                      <strong>{sleep.respiration}</strong>
                      <small>breaths/min</small>
                    </div>
                  )}
                  {sleep.spo2 != null && (
                    <div>
                      <span>Oxygen</span>
                      <strong>{sleep.spo2}</strong>
                      <small>%</small>
                    </div>
                  )}
                </div>
              )}
              <h3 className="health-subhead">Sleep timing</h3>
              <p>{sleepConsistency(data.sleeps, date)}</p>
              <p className="health-muted">{sleepSourcesNote(sleep)}</p>
            </>
          )}
        </>
      )}
      {naps.length > 0 && (
        <details>
          <summary>
            {naps.length} separate nap{naps.length === 1 ? '' : 's'}
          </summary>
          {naps.map((nap) => (
            <p key={nap.provider_id}>
              {duration(nap.duration_seconds)} · {clockLabel(nap.start_at, nap.timezone)} –{' '}
              {clockLabel(nap.end_at, nap.timezone)}
            </p>
          ))}
        </details>
      )}
    </Panel>
  )
}

function RecoveryBreakdown({ body }: { body: BodySummary }) {
  const charge = body.charge
  return (
    <Panel title="Recovery" id="recovery" index={3}>
      <div className="health-recovery">
        {charge && <Ring score={charge.score} size={112} stroke={9} />}
        <div>
          <p className="health-eyebrow">Daily Charge</p>
          <h3>
            {charge ? charge.bandLabel : 'Not enough data'}
          </h3>
        </div>
      </div>
      {body.todayRow?.bb_latest != null && (
        <p className="health-inline-stat">
          Body Battery <strong>{body.todayRow.bb_latest}/100</strong>
        </p>
      )}
      {charge && <h3 className="health-subhead">Inputs</h3>}
      <div className="health-drivers">
        {charge?.inputs.map((input) => (
          <div className="health-driver" key={input.key}>
            <div className="health-driver-head">
              <span>{input.label}</span>
              <strong>{input.value}</strong>
            </div>
            <div
              className="health-meter"
              role="img"
              aria-label={`${input.label} scored ${Math.round(input.score)} of 100, ${Math.round(input.weight * 100)}% of Charge`}
            >
              <span style={{ width: `${Math.max(3, Math.min(100, input.score))}%` }} />
            </div>
            <small>{Math.round(input.weight * 100)}%</small>
          </div>
        ))}
      </div>
    </Panel>
  )
}

const VOLUME_METRICS: HealthMetric[] = ['steps', 'active_minutes', 'floors']

function standing(value: number | null, base: Baseline | null, metric: HealthMetric) {
  if (value == null) return { key: 'none', text: 'No reading' }
  if (VOLUME_METRICS.includes(metric)) return { key: 'none', text: 'Daily total' }
  if (!base) return { key: 'none', text: 'Calibrating' }
  if (value < base.low) return { key: 'below', text: 'Below usual' }
  if (value > base.high) return { key: 'above', text: 'Above usual' }
  return { key: 'in', text: 'Usual' }
}

function MetricTile({
  metric,
  data,
  date
}: {
  metric: HealthMetric
  data: HealthSummary
  date: string
}) {
  const row = data.history.find((d) => d.local_date === date) ?? null
  const value = metricValue(row, metric)
  const trail = Array.from({ length: 14 }, (_, i) =>
    metricValue(data.history.find((d) => d.local_date === shiftDate(date, i - 13)) ?? null, metric)
  )
  const state = standing(value, metricBaseline(data.history, data.sleeps, metric, date), metric)
  return (
    <Link
      href={`/progress/health/metrics/${metric}?date=${date}`}
      className="health-tile press-card"
      data-haptic="light"
      aria-label={`${METRICS[metric].label}: ${value == null ? 'no reading' : `${value.toLocaleString()} ${METRICS[metric].unit}`}. ${state.text}. Open details.`}
    >
      <span className="health-tile-label">
        {METRICS[metric].short}
        <ChevronRight size={14} className="health-tile-chevron" />
      </span>
      <span className="health-tile-value">
        <strong>{value == null ? '—' : value.toLocaleString()}</strong>
        {value != null && <small>{METRICS[metric].unit}</small>}
      </span>
      <Sparkline values={trail} />
      <span className="health-tile-state" data-standing={state.key}>
        <i aria-hidden="true" />
        {state.text}
      </span>
    </Link>
  )
}

function HealthTrend({
  data,
  date,
  initialMetric = 'resting_hr',
  fixed = false
}: {
  data: HealthSummary
  date: string
  initialMetric?: HealthMetric
  fixed?: boolean
}) {
  const [window, setWindow] = useState(7)
  const [requestedMetric, setMetric] = useState<HealthMetric>(initialMetric)
  const [picked, setPicked] = useState<{ key: string; index: number } | null>(null)
  const chipsRef = useRef<HTMLDivElement>(null)
  const { reduceMotion } = useMotionPref()
  const available = (Object.keys(METRICS) as HealthMetric[]).filter((key) =>
    data.history.some((d) => metricValue(d, key) != null)
  )
  const metric = fixed
    ? initialMetric
    : available.includes(requestedMetric)
      ? requestedMetric
      : (available[0] ?? initialMetric)
  useEffect(() => {
    const row = chipsRef.current
    const on = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (row && on)
      row.scrollTo({
        left: on.offsetLeft - (row.clientWidth - on.clientWidth) / 2,
        behavior: reduceMotion ? 'auto' : 'smooth'
      })
  }, [metric, reduceMotion])
  const rows = Array.from({ length: window }, (_, i) => {
    const key = shiftDate(date, i - window + 1)
    return {
      date: key,
      value: metricValue(data.history.find((d) => d.local_date === key) ?? null, metric)
    }
  })
  const count = rows.filter((r) => r.value != null).length
  const volume = VOLUME_METRICS.includes(metric)
  const datesInWindow = new Set(rows.map(row => row.date))
  const coverage = new Map<string, Set<string>>()
  for (const row of data.sampleCoverage) {
    if (row.metric !== metric || !datesInWindow.has(row.date)) continue
    if (!coverage.has(row.source)) coverage.set(row.source, new Set())
    coverage.get(row.source)?.add(row.date)
  }
  for (const row of rows) {
    const source = data.provenance[row.date]?.[metric]?.source
    if (!source || (source !== 'legacy_snapshot' && source !== 'sleep_record')) continue
    if (!coverage.has(source)) coverage.set(source, new Set())
    coverage.get(source)?.add(row.date)
  }
  const usual = metricBaseline(data.history, data.sleeps, metric, date)
  const stats = seriesStats(rows.map((r) => r.value))
  const pickKey = `${metric}:${window}`
  const index = picked?.key === pickKey ? picked.index : rows.length - 1
  const shown = rows[index]
  const fmt = (n: number) => Math.round(n).toLocaleString()
  if (!fixed && !available.length)
    return (
      <div id="trends">
        {data.historyError ? (
          <p className="health-muted" role="alert">Couldn’t load measurements.</p>
        ) : (
          <p className="health-muted">No data yet</p>
        )}
      </div>
    )
  return (
    <div id="trends">
      {!fixed && (
        <div
          className="health-chips-scroll scrollbar-hide"
          ref={chipsRef}
          role="group"
          aria-label="Measurement"
        >
          {available.map((key) => (
            <button
              key={key}
              data-haptic="light"
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
            >
              {METRICS[key].short}
            </button>
          ))}
        </div>
      )}
      <div className="health-trend-controls">
        <p className="health-trend-title" data-fixed={fixed}>
          <span className="health-trend-label">{METRICS[metric].label}</span>
          <small>{METRICS[metric].unit}</small>
        </p>
        <div className="health-segment" role="group" aria-label="Trend window">
          {[7, 28, 90].map((n) => (
            <button
              key={n}
              data-haptic="light"
              aria-pressed={window === n}
              onClick={() => setWindow(n)}
            >
              {n} days
            </button>
          ))}
        </div>
      </div>
      <div className="health-trend-reading" aria-live="off">
        <span>{dateLabel(shown.date)}</span>
        <strong>
          {shown.value == null ? 'No reading' : shown.value.toLocaleString()}
          {shown.value != null && <small>{METRICS[metric].unit}</small>}
        </strong>
      </div>
      {count ? (
        <SeriesPlot
          values={rows.map((r) => r.value)}
          label={METRICS[metric].label}
          selected={index}
          onSelect={(i) => setPicked({ key: pickKey, index: i })}
          band={!volume && usual ? { low: usual.low, high: usual.high } : null}
        />
      ) : (
        <p className="health-muted">No readings</p>
      )}
      <div className="health-axis health-axis-3 health-axis-plot">
        <span>{dateLabel(rows[0].date)}</span>
        <span>{dateLabel(rows[Math.floor((rows.length - 1) / 2)].date)}</span>
        <span>{dateLabel(date)}</span>
      </div>
      {stats && (
        <dl className="health-range">
          <div>
            <dt>Low</dt>
            <dd>{fmt(stats.min)}</dd>
          </div>
          <div>
            <dt>Average</dt>
            <dd>{fmt(stats.avg)}</dd>
          </div>
          <div>
            <dt>High</dt>
            <dd>{fmt(stats.max)}</dd>
          </div>
        </dl>
      )}
      {!volume && usual && count > 0 && (
        <p className="health-band-key">
          <i aria-hidden="true" /> Usual {Math.round(usual.low)}–{Math.round(usual.high)}
        </p>
      )}
      <p className="health-coverage">
        {count}/{window} days{data.historyError || data.sampleHistoryError ? ' · some sources could not refresh' : ''}
      </p>
      <details>
        <summary>Data and source coverage</summary>
        {coverage.size > 0 && (
          <ul className="health-coverage">
            {[...coverage].map(([source, days]) => (
              <li key={source}>
                {source === 'legacy_snapshot' ? 'Garmin watch snapshots' :
                  source === 'sleep_record' ? 'Sleep records' : sourceLabel(source)} · {days.size}/{window} days
              </li>
            ))}
          </ul>
        )}
        <div className="health-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>
                  {METRICS[metric].label} ({METRICS[metric].unit})
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date}>
                  <th>{r.date}</th>
                  <td>{r.value ?? 'No reading'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

const PRIMARY_METRICS = [
  'resting_hr',
  'overnight_hrv',
  'bb_latest',
  'recovery_hours',
  'steps'
] as const
const MORE_METRICS = ['stress_avg', 'active_minutes', 'floors', 'spo2', 'vo2max'] as const

export function HealthView({
  data,
  date,
  today,
  view = 'overview',
  metric,
  error,
  updating,
  onRefresh
}: {
  data: HealthSummary | null
  date: string
  today: string
  view?: 'overview' | 'sleep' | 'metric'
  metric?: HealthMetric
  error?: boolean
  updating?: boolean
  onRefresh: () => void
}) {
  const body = data?.body
  const selectedRow = data?.history.find((d) => d.local_date === date) ?? null
  const [sourceOpen, setSourceOpen] = useState(false)
  const now = useNow()
  const hasMetric = (m: HealthMetric) => !!data?.history.some((d) => metricValue(d, m) != null)
  return (
    <>
      <div className="health-refresh" data-state={error ? 'error' : updating ? 'busy' : 'ok'}>
        {data ? (
          <button
            type="button"
            className="health-refresh-main"
            data-haptic="light"
            aria-expanded={sourceOpen}
            aria-controls="health-source-panel"
            onClick={() => setSourceOpen((o) => !o)}
          >
            <i aria-hidden="true" />
            <span role="status">
              {updating
                ? 'Updating…'
                : error
                  ? 'Health unavailable'
                  : sourceSummary(data, date, now)}
            </span>
            <b aria-hidden="true" data-open={sourceOpen}>
              <ChevronRight size={14} />
            </b>
          </button>
        ) : (
          <span className="health-refresh-main">
            <i aria-hidden="true" />
            <span role="status">
              {updating ? 'Updating…' : error ? 'Health unavailable' : 'Health'}
            </span>
          </span>
        )}
        <button
          className="health-refresh-btn"
          data-haptic="light"
          disabled={updating}
          onClick={onRefresh}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            data-spin={updating}
          >
            <path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4" />
            <path d="M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4" />
          </svg>
          {error ? 'Retry' : 'Refresh'}
        </button>
      </div>
      {data && sourceOpen && (
        <HealthSourceStatus data={data} date={date} id="health-source-panel" />
      )}
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
      ) : (
        <>
          {view === 'sleep' ? (
            <SleepSummary data={data} date={date} today={today} detail />
          ) : view === 'metric' && metric ? (
            <Panel title={METRICS[metric].label}>
              {(() => {
                const value = metricValue(selectedRow, metric)
                const state = standing(
                  value,
                  metricBaseline(data.history, data.sleeps, metric, date),
                  metric
                )
                return (
                  <>
                    <div className="health-hero-value">
                      <strong>{value?.toLocaleString() ?? '—'}</strong>
                      <span>{METRICS[metric].unit}</span>
                    </div>
                    <p className="health-hero-sub">
                      {dateLabel(date)}
                    </p>
                    <span className="health-tile-state health-pill" data-standing={state.key}>
                      <i aria-hidden="true" />
                      {state.text}
                    </span>
                  </>
                )
              })()}
              <p className="health-insight">{METRICS[metric].meaning}</p>
              <HealthTrend key={metric} data={data} date={date} initialMetric={metric} fixed />
            </Panel>
          ) : (
            <div className="stagger">
              <DailyHealthBrief data={data} date={date} />
              {data.sleeps.length > 0 && (
                <Link href="/progress/health/energy" className="energy-entry press-card" data-haptic="light">
                  <span className="energy-entry-wave" aria-hidden="true">
                    <svg width="44" height="28" viewBox="0 0 44 28" fill="none">
                      <path d="M2 20C7 20 9 6 15 6s7 14 12 14 7-10 15-12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="energy-entry-body">
                    <strong>Energy</strong>
                    <span>Your peaks, dips and wind-down today</span>
                  </span>
                  <ChevronRight size={20} className="health-arrow" />
                </Link>
              )}
              {!body?.hasWatch && !data.sleeps.length && data.sleepState !== 'error' && (
                <Panel title="Connect a watch" index={1}>
                  <p>Sleep, recovery and daily activity from your Garmin.</p>
                  <Link className="health-primary" href="/profile/settings#health">
                    Connect Garmin
                    <ChevronRight size={16} />
                  </Link>
                </Panel>
              )}
              {data.history.length > 0 && (
                <section className="health-section" style={{ '--i': 1 } as CSSProperties}>
                  <h2 className="health-section-title">Your metrics</h2>
                  <div className="health-tiles">
                    {PRIMARY_METRICS.filter(hasMetric).map((m) => (
                      <MetricTile key={m} metric={m} data={data} date={date} />
                    ))}
                  </div>
                  {MORE_METRICS.some(hasMetric) && (
                    <details>
                      <summary>More</summary>
                      <div className="health-tiles">
                        {MORE_METRICS.filter(hasMetric).map((m) => (
                          <MetricTile key={m} metric={m} data={data} date={date} />
                        ))}
                      </div>
                    </details>
                  )}
                </section>
              )}
              {!data.history.length && data.historyError && (
                <Panel title="Your metrics" index={1}>
                  <p className="health-muted" role="alert">Couldn’t load measurements.</p>
                  <button type="button" className="health-text-button" data-haptic="light" onClick={onRefresh}>
                    Retry
                  </button>
                </Panel>
              )}
              {!data.history.length && !data.historyError && body?.hasWatch && (
                <Panel title="Your metrics" index={1}>
                  <p className="health-muted">No data yet</p>
                </Panel>
              )}
              <div className="health-grid">
                <SleepSummary data={data} date={date} today={today} />
                <RecoveryBreakdown body={data.body} />
              </div>
              {body?.signals && date === today && (
                <Panel title="Body signals" id="signals" index={4}>
                  <BodySignalsPanel
                    key={body.signals.date}
                    signals={body.signals}
                    record={body.signalRecord}
                    labelsError={body.labelsError}
                  />
                </Panel>
              )}
              {body?.hasWatch && (
                <Panel title="Readiness" id="readiness" index={4}>
                  <ReadinessTrend
                    checks={body.readinessChecks}
                    date={date}
                    failed={body.readinessError}
                  />
                </Panel>
              )}
              <Panel title="Your day" id="day" index={5}>
                {body?.todayRow &&
                [
                  ...(body.todayRow.bb_series ?? []),
                  ...(body.todayRow.stress_series ?? []),
                  ...(body.todayRow.hr_series ?? []),
                  ...(body.todayRow.steps_series ?? [])
                ].some((v) => v != null) ? (
                  <DailyHealthTimeline
                    bb={body.todayRow.bb_series ?? []}
                    stress={body.todayRow.stress_series ?? []}
                    hr={body.todayRow.hr_series ?? []}
                    hrRange={date === today ? body.todayHrRange : null}
                    steps={body.todayRow.steps_series ?? []}
                    date={date}
                    today={today}
                    usual={{
                      bb: intradayEnvelope(body.days, date, 'bb_series'),
                      stress: intradayEnvelope(body.days, date, 'stress_series')
                    }}
                    annotations={dayAnnotations(data.workouts, mainSleep(data.sleeps, date), date)}
                    summary={{
                      high: body.todayRow.bb_high,
                      low: body.todayRow.bb_low,
                      latest: body.todayRow.bb_latest,
                      stress: body.todayRow.stress_avg
                    }}
                  />
                ) : (
                  <p className="health-muted">No readings for this date</p>
                )}
              </Panel>
              <Panel title="Trends" index={6}>
                <HealthTrend data={data} date={date} />
              </Panel>
            </div>
          )}
          <footer className="health-footer">Not medical advice.</footer>
        </>
      )}
    </>
  )
}
