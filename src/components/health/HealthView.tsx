'use client'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import type { BodySummary } from '@/lib/body/queries'
import type { HealthSummary } from '@/lib/health/queries'
import {
  clockLabel,
  dailyBrief,
  dayAnnotations,
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
import { connectionErrorText, relativeTime, SOURCE_LABEL } from '@/lib/health/reconcile'
import { requestOpenCoach } from '@/lib/coach/openCoachBus'
import Dialog from '@/components/ui/Dialog'
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
          ‹ {view === 'overview' ? 'Progress' : 'Health'}
        </Link>
        <span className="health-eyebrow">GRIND / DAILY HEALTH</span>
      </div>
      <div className="health-title-row">
        <h1>{view === 'sleep' ? 'SLEEP' : view === 'overview' ? 'HEALTH' : 'YOUR METRICS'}</h1>
        <span className="health-date-caption">{date === today ? 'Today' : dateLabel(date)}</span>
      </div>
      <div className="health-date-controls">
        <button
          aria-label="Previous day"
          data-haptic="light"
          onClick={() => onDate(shiftDate(date, -1))}
        >
          ‹
        </button>
        <button
          className="health-calendar-open"
          data-haptic="light"
          aria-label="Choose health date"
          onClick={() => setCalendarOpen(true)}
        >
          {dateLabel(date)} <span aria-hidden="true">⌄</span>
        </button>
        <button
          aria-label="Next day"
          data-haptic="light"
          disabled={date >= today}
          onClick={() => onDate(shiftDate(date, 1))}
        >
          ›
        </button>
      </div>
      <div className="health-strip" ref={stripRef} data-swipe-ignore>
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
              ×
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
          <p>Recent dates · a dot means records are available</p>
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
                <span aria-hidden="true">{availableDates.includes(key) ? '•' : ' '}</span>
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

export function HealthSourceStatus({ data, date }: { data: HealthSummary; date: string }) {
  const [now] = useState(() => Date.now())
  const { body, connections } = data
  const row = body.days.find((d) => d.local_date === date)
  const latest = body.days.at(-1)
  const lastSync =
    connections
      .map((c) => c.last_success_at)
      .filter((t): t is string => !!t)
      .sort()
      .at(-1) ??
    row?.synced_at ??
    null
  const synced = relativeTime(lastSync, now)
  const provenance = Object.entries(data.provenance[date] ?? {}) as [
    HealthMetric,
    NonNullable<HealthSummary['provenance'][string][HealthMetric]>
  ][]
  return (
    <details className="health-source">
      <summary>
        {body.hasWatch || connections.length
          ? `Garmin${body.hasWatch ? ' watch' : ''} · ${row ? `Snapshot dated ${dateLabel(date)}` : latest ? `Last record ${dateLabel(latest.local_date)}` : 'No daily snapshot'}${synced ? ` · synced ${synced}` : ''}`
          : 'Connection & data sources'}
      </summary>
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
                  ? `Last successful import ${relativeTime(c.last_success_at, now)}.`
                  : 'No successful import yet.'}
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
        {row?.synced_at
          ? `Received ${new Date(row.synced_at).toLocaleString()}. The legacy snapshot does not supply a precise observation timestamp.`
          : 'No daily measurement received for this date.'}
      </p>
      <p>
        Watch uploads run while GRIND is open on the watch. Refreshing this page reads server data;
        it cannot wake the watch or force Garmin Connect to sync.
      </p>
      <p>
        When two sources report the same measurement, GRIND shows one: a current reading over a
        partial one, an approved Garmin connection over a personal one over the watch app, then the
        later measurement. Readings are never averaged together.
      </p>
      <Link href="/profile/settings#health">Manage connections & privacy ›</Link>
    </details>
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

export function DailyHealthBrief({ data, date }: { data: HealthSummary; date: string }) {
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
      <p className="health-eyebrow">Your daily picture · {dateLabel(date)}</p>
      <h2>{brief.headline}</h2>
      <p>{brief.text}</p>
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
        <details>
          <summary>Why this summary</summary>
          <p>
            Deterministic observations from {dateLabel(date)}. No generated explanation or clinical
            recovery assessment.
          </p>
          {sleep && (
            <p>
              {sleep.source} · sleep ending {clockLabel(sleep.end_at, sleep.timezone)} ·{' '}
              {sleep.status} record.
            </p>
          )}
          {row && (
            <p>
              Garmin watch daily snapshot · exact measurement time unavailable. No verdict is
              inferred from missing data.
            </p>
          )}
        </details>
        <button
          className="health-text-button"
          data-haptic="light"
          onClick={() =>
            requestOpenCoach({
              draft: `Help me understand my health readings for ${date}. Explain the source, freshness and any missing evidence.`
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

export function SleepSummary({
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
      action={!detail && <Link href={`/progress/health/sleep?date=${date}`}>View sleep ›</Link>}
    >
      {!sleep ? (
        <>
          <h3>{naps.length ? 'Nap recorded' : 'No sleep record received'}</h3>
          <p>
            {data.sleepState === 'error'
              ? 'Sleep is temporarily unavailable. Retry the health refresh above.'
              : data.sleepState === 'not_enabled'
                ? 'Cloud sleep isn’t connected yet. Your watch snapshots don’t contain sleep stages or overnight HRV.'
                : 'No main sleep record is available for this date. Missing sleep is not zero sleep.'}
          </p>
          <Link href="/profile/settings#health">Connection details ›</Link>
        </>
      ) : (
        <>
          <div className="health-measurement">
            <strong>{duration(sleep.duration_seconds)}</strong>
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
          <StageBreakdown sleep={sleep} />
          <SleepStageChart sleep={sleep} />
          <p className="health-insight">{sleepComparison(sleep, data.sleeps)}</p>
          {detail && (
            <>
              <p className="health-muted">
                Time in bed:{' '}
                {duration((Date.parse(sleep.end_at) - Date.parse(sleep.start_at)) / 1000)}. Total
                sleep excludes awake time as supplied by {sleep.source}.
              </p>
              <h3 className="health-subhead">Overnight measurements</h3>
              {sleep.overnight_hrv == null && sleep.respiration == null && sleep.spo2 == null ? (
                <p>No overnight measurements supplied for this night.</p>
              ) : (
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
              <p className="health-muted">
                Source: {sleep.source} · device {sleep.device_id} · {sleep.status}. Wearable sleep
                stages are estimates. Recorded {sleep.provider_date}; revised{' '}
                {new Date(sleep.revision_at).toLocaleString()}.
              </p>
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

export function RecoveryBreakdown({ body }: { body: BodySummary }) {
  const charge = body.charge
  return (
    <Panel title="Recovery" id="recovery" index={3}>
      <div className="health-recovery">
        {charge && <Ring score={charge.score} size={112} stroke={9} />}
        <div>
          <p className="health-eyebrow">Daily Charge · heuristic</p>
          <h3>
            {charge ? `${charge.score} · ${charge.bandLabel}` : 'Still building your picture'}
          </h3>
          <p>
            {charge
              ? `${charge.inputs.length} contributing signals. Use this as context alongside how you feel.`
              : 'At least two contributing signals are needed. Available measurements still appear below.'}
          </p>
        </div>
      </div>
      {body.todayRow?.bb_latest != null && (
        <p className="health-inline-stat">
          Body Battery at the recorded snapshot <strong>{body.todayRow.bb_latest}/100</strong>
        </p>
      )}
      {charge && <h3 className="health-subhead">What’s shaping it</h3>}
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
            <small>
              {input.phrase} · {Math.round(input.weight * 100)}% of Charge
            </small>
          </div>
        ))}
      </div>
      <details>
        <summary>How Charge works</summary>
        <p>
          Charge is GRIND’s unvalidated daily training heuristic. Body Battery is Garmin’s energy
          estimate. The Charge input uses wake Body Battery when provided, otherwise the day’s high;
          it is not always a morning measurement. Neither score establishes muscular recovery.
        </p>
        <p>
          Existing weights: Body Battery 40%, recovery time 25%, resting HR deviation 20%, training
          load 15%. Missing inputs are excluded and remaining weights rescaled. Signals can overlap.
          Legacy timestamps do not support a current readiness claim.
        </p>
      </details>
    </Panel>
  )
}

const VOLUME_METRICS: HealthMetric[] = ['steps', 'active_minutes', 'floors']

function standing(value: number | null, base: Baseline | null, metric: HealthMetric) {
  if (value == null) return { key: 'none', text: 'No reading on this date' }
  if (VOLUME_METRICS.includes(metric)) return { key: 'none', text: 'Daily total · may be partial' }
  if (!base) return { key: 'none', text: 'Building your baseline' }
  if (value < base.low) return { key: 'below', text: 'Below usual' }
  if (value > base.high) return { key: 'above', text: 'Above usual' }
  return { key: 'in', text: 'In your usual range' }
}

export function MetricTile({
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
        <i aria-hidden="true">›</i>
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

export function HealthTrend({
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
  const available = (Object.keys(METRICS) as HealthMetric[]).filter((key) =>
    data.history.some((d) => metricValue(d, key) != null)
  )
  const metric = fixed
    ? initialMetric
    : available.includes(requestedMetric)
      ? requestedMetric
      : (available[0] ?? initialMetric)
  const rows = Array.from({ length: window }, (_, i) => {
    const key = shiftDate(date, i - window + 1)
    return {
      date: key,
      value: metricValue(data.history.find((d) => d.local_date === key) ?? null, metric)
    }
  })
  const count = rows.filter((r) => r.value != null).length
  const volume = VOLUME_METRICS.includes(metric)
  const usual = metricBaseline(data.history, data.sleeps, metric, date)
  const stats = seriesStats(rows.map((r) => r.value))
  const pickKey = `${metric}:${window}`
  const index = picked?.key === pickKey ? picked.index : rows.length - 1
  const shown = rows[index]
  const fmt = (n: number) => Math.round(n).toLocaleString()
  if (!fixed && !available.length)
    return (
      <div id="trends">
        <p>No recorded measurements yet. Trends appear when your source supplies history.</p>
      </div>
    )
  return (
    <div id="trends">
      {!fixed && (
        <div
          className="health-chips-scroll"
          role="group"
          aria-label="Measurement"
          data-swipe-ignore
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
        <p className="health-trend-title">
          {METRICS[metric].label}
          <small>
            {metric === 'overnight_hrv'
              ? 'Provided overnight value'
              : volume
                ? 'Recorded daily total (may be partial)'
                : 'Recorded daily snapshot'}{' '}
            · {METRICS[metric].unit}
          </small>
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
        <p>No readings in this window.</p>
      )}
      <div className="health-axis health-axis-3">
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
          <i aria-hidden="true" /> Shaded band is your usual range
        </p>
      )}
      <p>
        {count} of {window} days recorded.{' '}
        {data.historyError ? 'History refresh failed; retry above.' : 'Blank days have no reading.'}
      </p>
      <p className="health-muted">
        {volume
          ? 'Compare complete days only; observation times are unavailable.'
          : usual
            ? `Recent personal ${metric === 'overnight_hrv' ? 'overnight' : 'snapshot'} range ${Math.round(usual.low)}–${Math.round(usual.high)} ${METRICS[metric].unit}, across ${usual.count} of the previous 28 days. ${metric === 'overnight_hrv' ? 'Compared within the same source and device.' : 'Legacy device identity is unavailable.'} This is not a clinical range.`
            : 'Personal comparisons need at least 14 recorded days in the previous 28. Device changes may affect comparisons.'}
      </p>
      <details>
        <summary>Read trend data</summary>
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
  const hasMetric = (m: HealthMetric) => !!data?.history.some((d) => metricValue(d, m) != null)
  return (
    <>
      <div className="health-refresh" data-state={error ? 'error' : updating ? 'busy' : 'ok'}>
        <span role="status">
          <i aria-hidden="true" />
          {updating
            ? 'Updating server records…'
            : error
              ? 'Health is temporarily unavailable'
              : 'Your records, in perspective'}
        </span>
        <button data-haptic="light" disabled={updating} onClick={onRefresh}>
          {error ? 'Retry' : 'Refresh'}
        </button>
      </div>
      {data && <HealthSourceStatus data={data} date={date} />}
      {error && (
        <p role="alert" className="health-error">
          We couldn’t refresh health data.{' '}
          {data
            ? 'Previous readings are retained with their dates.'
            : 'Try again when your connection is available.'}
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
              <div className="health-measurement">
                <strong>{metricValue(selectedRow, metric)?.toLocaleString() ?? '—'}</strong>
                <span>{METRICS[metric].unit}</span>
              </div>
              <p>
                {metricValue(selectedRow, metric) == null
                  ? 'No reading for this date.'
                  : `${metric === 'overnight_hrv' ? 'Overnight reading' : 'Garmin watch snapshot'} · ${dateLabel(date)}`}
              </p>
              <p className="health-insight">{METRICS[metric].meaning}</p>
              <HealthTrend key={metric} data={data} date={date} initialMetric={metric} fixed />
            </Panel>
          ) : (
            <div className="stagger">
              <DailyHealthBrief data={data} date={date} />
              {!body?.hasWatch && !data.sleeps.length && (
                <Panel title="Make room for the whole picture" index={1}>
                  <p>Connect your Garmin watch to begin collecting available measurements.</p>
                  <ul>
                    <li>Daily energy and movement</li>
                    <li>Workout heart-rate detail</li>
                    <li>Sleep from a supported cloud connection, when available</li>
                  </ul>
                  <p className="health-muted">
                    Your health records stay private. Choose whether Coach can use them in Settings.
                  </p>
                  <Link className="health-primary" href="/profile/settings#health">
                    Connect Garmin ›
                  </Link>
                </Panel>
              )}
              {data.history.length > 0 && (
                <Panel title="Your metrics" index={1}>
                  <div className="health-tiles">
                    {PRIMARY_METRICS.filter(hasMetric).map((m) => (
                      <MetricTile key={m} metric={m} data={data} date={date} />
                    ))}
                  </div>
                  {MORE_METRICS.some(hasMetric) && (
                    <details>
                      <summary>More measurements</summary>
                      <div className="health-tiles">
                        {MORE_METRICS.filter(hasMetric).map((m) => (
                          <MetricTile key={m} metric={m} data={data} date={date} />
                        ))}
                      </div>
                      <p className="health-muted">
                        Only measurements supplied by your device are shown.
                      </p>
                    </details>
                  )}
                </Panel>
              )}
              {!data.history.length && body?.hasWatch && (
                <Panel title="Your metrics" index={1}>
                  <p>No daily measurements received yet.</p>
                </Panel>
              )}
              <div className="health-grid">
                <SleepSummary data={data} date={date} today={today} />
                <RecoveryBreakdown body={data.body} />
              </div>
              <Panel title="Your day" id="day" index={4}>
                {body?.todayRow &&
                [...(body.todayRow.bb_series ?? []), ...(body.todayRow.stress_series ?? [])].some(
                  (v) => v != null
                ) ? (
                  <DailyHealthTimeline
                    bb={body.todayRow.bb_series ?? []}
                    stress={body.todayRow.stress_series ?? []}
                    date={date}
                    today={today}
                    annotations={dayAnnotations(data.workouts, mainSleep(data.sleeps, date), date)}
                    summary={{
                      high: body.todayRow.bb_high,
                      low: body.todayRow.bb_low,
                      latest: body.todayRow.bb_latest,
                      stress: body.todayRow.stress_avg
                    }}
                  />
                ) : (
                  <p>
                    No intraday readings for this date. Measurements appear here when a source
                    supplies them.
                  </p>
                )}
              </Panel>
              <Panel title="Patterns over time" index={5}>
                <HealthTrend data={data} date={date} />
              </Panel>
            </div>
          )}
          <footer className="health-footer">
            Understand the evidence. Listen to your body.
            <br />
            Wearable estimates and GRIND heuristics are not medical assessments.
          </footer>
        </>
      )}
    </>
  )
}
