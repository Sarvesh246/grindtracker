'use client'
import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { BodySummary } from '@/lib/body/queries'
import type { HealthHistoryDay } from '@/lib/health/model'
import type { HealthSummary } from '@/lib/health/queries'
import {
  baseline,
  clockLabel,
  dailyBrief,
  dateLabel,
  duration,
  mainSleep,
  METRICS,
  metricValue,
  shiftDate,
  sleepComparison,
  sleepConsistency,
  type HealthMetric
} from '@/lib/health/model'
import { Ring } from '@/components/body/ChargeRing'
import { requestOpenCoach } from '@/lib/coach/openCoachBus'
import Dialog from '@/components/ui/Dialog'
import { DailyHealthTimeline, SeriesPlot, SleepStageChart } from './HealthCharts'

function Panel({
  title,
  id,
  action,
  children,
  className = ''
}: {
  title: string
  id?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={`health-panel ${className}`}>
      <div className="health-section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

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
                <span aria-hidden="true">{availableDates.includes(key) ? '•' : ' '}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setCalendarOpen(false)}>Done</button>
        </div>
      </Dialog>
    </header>
  )
}

export function HealthSourceStatus({ body, date }: { body: BodySummary; date: string }) {
  const row = body.days.find((d) => d.local_date === date)
  const latest = body.days.at(-1)
  return (
    <details className="health-source">
      <summary>
        {body.hasWatch
          ? `Garmin watch · ${row ? `Snapshot dated ${dateLabel(date)}` : latest ? `Last record ${dateLabel(latest.local_date)}` : 'No daily snapshot'}`
          : 'Connection & data sources'}
      </summary>
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
        Cloud sleep imports require an approved Garmin connection. Device capabilities and missing
        fields vary.
      </p>
      <Link href="/profile/settings#health">Manage connections & privacy ›</Link>
    </details>
  )
}

export function DailyHealthBrief({ data, date }: { data: HealthSummary; date: string }) {
  const row = data.body.todayRow
  const sleep = mainSleep(data.sleeps, date)
  const brief = dailyBrief(row, sleep, data.sleeps)
  return (
    <section className="health-brief">
      <p className="health-eyebrow">Your daily picture · {dateLabel(date)}</p>
      <h2>{brief.headline}</h2>
      <p>{brief.text}</p>
      <div className="health-facts">
        {sleep && (
          <span>
            Sleep <strong>{duration(sleep.duration_seconds)}</strong>
          </span>
        )}
        {data.body.charge && (
          <span>
            Charge <strong>{data.body.charge.score}</strong>
          </span>
        )}
        {row?.resting_hr != null && (
          <span>
            Resting HR <strong>{row.resting_hr} bpm</strong>
          </span>
        )}
      </div>
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
          Ask Coach ↗
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
              <span>
                Sleep score <b>{sleep.score}</b>
              </span>
            )}
          </div>
          <p>
            {clockLabel(sleep.start_at, sleep.timezone)} –{' '}
            {clockLabel(sleep.end_at, sleep.timezone)}{' '}
            <span className="health-muted">· {sleep.timezone}</span>
          </p>
          <SleepStageChart sleep={sleep} />
          <p>{sleepComparison(sleep, data.sleeps)}</p>
          {detail && (
            <>
              <p>
                Time in bed:{' '}
                {duration((Date.parse(sleep.end_at) - Date.parse(sleep.start_at)) / 1000)}. Total
                sleep excludes awake time as supplied by {sleep.source}.
              </p>
              <div className="health-metric-list">
                {(['awake', 'rem', 'light', 'deep'] as const).map((stage) => {
                  const recorded = sleep.stages?.filter((s) => s.stage === stage)
                  const seconds =
                    sleep.stage_totals?.[stage] ??
                    (recorded?.length
                      ? recorded.reduce(
                          (n, s) => n + (Date.parse(s.end) - Date.parse(s.start)) / 1000,
                          0
                        )
                      : null)
                  return (
                    <div className="health-metric-row" key={stage}>
                      <span>
                        {stage === 'rem' ? 'REM' : stage.charAt(0).toUpperCase() + stage.slice(1)}
                      </span>
                      <strong>{seconds == null ? 'Not supplied' : duration(seconds)}</strong>
                    </div>
                  )
                })}
              </div>
              <h3>Sleep timing</h3>
              <p>{sleepConsistency(data.sleeps, date)}</p>
              <h3>Overnight measurements</h3>
              <p>
                {sleep.overnight_hrv != null ? `HRV ${sleep.overnight_hrv} ms. ` : ''}
                {sleep.respiration != null ? `Respiration ${sleep.respiration} breaths/min. ` : ''}
                {sleep.spo2 != null ? `Oxygen saturation ${sleep.spo2}%.` : ''}
                {sleep.overnight_hrv == null && sleep.respiration == null && sleep.spo2 == null
                  ? 'No overnight measurements supplied for this night.'
                  : ''}
              </p>
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
    <Panel title="Recovery" id="recovery">
      <div className="health-recovery">
        {charge && <Ring score={charge.score} size={120} stroke={8} />}
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
        <p>
          Body Battery at the recorded snapshot: <strong>{body.todayRow.bb_latest}/100</strong>.
        </p>
      )}
      <div className="health-metric-list">
        {charge?.inputs.map((input) => (
          <div className="health-metric-row" key={input.key}>
            <span>
              {input.label}
              <small>{input.phrase}</small>
            </span>
            <strong>{input.value}</strong>
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

export function MetricRow({
  metric,
  row,
  date
}: {
  metric: HealthMetric
  row: HealthHistoryDay | null
  date: string
}) {
  const value = metricValue(row, metric)
  return (
    <Link
      href={`/progress/health/metrics/${metric}?date=${date}`}
      className="health-metric-row"
      data-haptic="light"
    >
      <span>
        {METRICS[metric].label}
        <small>
          {metric === 'overnight_hrv' ? 'Overnight reading' : 'Garmin watch snapshot'} ·{' '}
          {dateLabel(date)}
        </small>
      </span>
      <span>
        <strong>{value == null ? 'No reading on this date' : value.toLocaleString()}</strong>
        {value != null && <small>{METRICS[metric].unit}</small>}
      </span>
      <span aria-hidden="true">›</span>
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
  const sourceKey = (s: NonNullable<ReturnType<typeof mainSleep>>) => `${s.source}:${s.device_id}`
  const selectedSleep = mainSleep(data.sleeps, date)
  const usual =
    metric === 'overnight_hrv'
      ? selectedSleep &&
        baseline(
          data.sleeps.flatMap((s) =>
            s.kind === 'main' && s.overnight_hrv != null
              ? [{ date: s.wake_date, value: s.overnight_hrv, source: sourceKey(s) }]
              : []
          ),
          date,
          sourceKey(selectedSleep)
        )
      : baseline(
          data.history.flatMap((row) => {
            const value = metricValue(row, metric)
            return value == null ? [] : [{ date: row.local_date, value, source: 'legacy-watch' }]
          }),
          date,
          'legacy-watch'
        )
  if (!fixed && !available.length)
    return (
      <div id="trends">
        <p>No recorded measurements yet. Trends appear when your source supplies history.</p>
      </div>
    )
  return (
    <div id="trends">
      <div className="health-trend-controls">
        {!fixed && (
          <label>
            Measurement
            <select value={metric} onChange={(e) => setMetric(e.target.value as HealthMetric)}>
              {Object.entries(METRICS)
                .filter(([key]) =>
                  data.history.some((d) => metricValue(d, key as HealthMetric) != null)
                )
                .map(([key, m]) => (
                  <option value={key} key={key}>
                    {m.label}
                  </option>
                ))}
            </select>
          </label>
        )}
        <div role="group" aria-label="Trend window">
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
      <p>
        {METRICS[metric].label} ·{' '}
        {metric === 'overnight_hrv'
          ? 'Provided overnight value'
          : metric === 'steps' || metric === 'active_minutes' || metric === 'floors'
            ? 'Recorded daily total (may be partial)'
            : 'Recorded daily snapshot'}{' '}
        · {METRICS[metric].unit}
      </p>
      {count ? (
        <SeriesPlot values={rows.map((r) => r.value)} label={METRICS[metric].label} />
      ) : (
        <p>No readings in this window.</p>
      )}
      <div className="health-axis">
        <span>{dateLabel(rows[0].date)}</span>
        <span>{dateLabel(date)}</span>
      </div>
      <p>
        {count} of {window} days recorded.{' '}
        {data.historyError ? 'History refresh failed; retry above.' : 'Blank days have no reading.'}
      </p>
      <p className="health-muted">
        {metric === 'steps' || metric === 'active_minutes' || metric === 'floors'
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
  return (
    <>
      <div className="health-refresh">
        <span role="status">
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
      {body && <HealthSourceStatus body={body} date={date} />}
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
              <p>{METRICS[metric].meaning}</p>
              <HealthTrend key={metric} data={data} date={date} initialMetric={metric} fixed />
            </Panel>
          ) : (
            <>
              <DailyHealthBrief data={data} date={date} />
              {!body?.hasWatch && !data.sleeps.length && (
                <Panel title="Make room for the whole picture">
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
              <div className="health-grid">
                <SleepSummary data={data} date={date} today={today} />
                <RecoveryBreakdown body={data.body} />
              </div>
              <Panel title="Your day" id="day">
                {body?.todayRow &&
                [...(body.todayRow.bb_series ?? []), ...(body.todayRow.stress_series ?? [])].some(
                  (v) => v != null
                ) ? (
                  <DailyHealthTimeline
                    bb={body.todayRow.bb_series ?? []}
                    stress={body.todayRow.stress_series ?? []}
                    date={date}
                    today={today}
                  />
                ) : (
                  <p>
                    No intraday readings for this date. Measurements appear here when a source
                    supplies them.
                  </p>
                )}
              </Panel>
              <div className="health-grid">
                <Panel title="Your metrics">
                  <div className="health-metric-list">
                    {(
                      [
                        'resting_hr',
                        'overnight_hrv',
                        'steps',
                        'recovery_hours',
                        'bb_latest'
                      ] as const
                    )
                      .filter((m) => data.history.some((d) => metricValue(d, m) != null))
                      .map((m) => (
                        <MetricRow key={m} metric={m} row={selectedRow} date={date} />
                      ))}
                  </div>
                  {!data.history.length && <p>No daily measurements received yet.</p>}
                  <details>
                    <summary>More measurements</summary>
                    {(['stress_avg', 'active_minutes', 'floors', 'spo2', 'vo2max'] as const)
                      .filter((m) => data.history.some((d) => metricValue(d, m) != null))
                      .map((m) => (
                        <MetricRow key={m} metric={m} row={selectedRow} date={date} />
                      ))}
                    <p className="health-muted">
                      Only measurements supplied by your device are shown.
                    </p>
                  </details>
                </Panel>
                <Panel title="Patterns over time">
                  <HealthTrend data={data} date={date} />
                </Panel>
              </div>
            </>
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
