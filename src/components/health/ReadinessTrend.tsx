'use client'
import { useState } from 'react'
import { dailyReadings, summarizeReadiness, MIN_BASELINE_READINGS, type ReadinessCheck } from '@/lib/body/hrv'
import { dateLabel, seriesStats, shiftDate } from '@/lib/health/model'
import { SeriesPlot } from './HealthCharts'

/**
 * The morning readiness check (watch, 1 min seated) over time: one reading a
 * day (the first usable one), your usual range as the band behind the line,
 * and the 7-day average against it, which says more than any single morning.
 * Readings are only ever compared with your own: RMSSD differs too much
 * between people for a population "normal" to mean anything.
 */

const WINDOWS = [14, 30, 60] as const

const STATUS_TEXT = { below: 'Below usual', within: 'Usual', above: 'Above usual' } as const

function weekSentence(z: number | null): string | null {
  if (z == null) return null
  if (z <= -0.5) return 'Your 7-day average is running below your usual. Recovery may be lagging: go easier on hard sessions.'
  if (z >= 0.5) return 'Your 7-day average is above your usual: recovery looks strong.'
  return 'Your 7-day average is in your usual range.'
}

export default function ReadinessTrend({
  checks,
  date,
  failed = false
}: {
  checks: ReadinessCheck[]
  date: string
  /** The read failed, so an empty list means "unknown", not "no checks". */
  failed?: boolean
}) {
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>(30)
  const [picked, setPicked] = useState<{ key: string; index: number } | null>(null)

  const days = dailyReadings(checks)
  const summary = summarizeReadiness(checks, date)
  const rows = Array.from({ length: window }, (_, i) => {
    const key = shiftDate(date, i - window + 1)
    const c = days.get(key)
    return { date: key, value: c?.rmssd == null ? null : Math.round(c.rmssd), hr: c?.mean_hr ?? null, quality: c?.quality ?? null }
  })
  const count = rows.filter(r => r.value != null).length
  const stats = seriesStats(rows.map(r => r.value))
  const pickKey = `${date}:${window}`
  const index = picked?.key === pickKey ? picked.index : rows.length - 1
  const shown = rows[index]
  const base = summary.baseline
  const total = [...days.keys()].filter(d => d <= date).length

  if (days.size === 0) {
    if (failed)
      return (
        <div className="health-readiness">
          <p className="health-muted" role="alert">Couldn’t load your readiness checks.</p>
        </div>
      )
    return (
      <div className="health-readiness">
        <p className="health-muted">
          No checks yet. On your watch: Home, then MENU, then <strong>Readiness check</strong>. Sit still for 70 seconds,
          ideally right after waking. Five mornings build your usual range.
        </p>
      </div>
    )
  }

  const status = shown.value != null && base
    ? shown.value < base.lowMs ? 'below' : shown.value > base.highMs ? 'above' : 'within'
    : null

  return (
    <div className="health-readiness">
      {summary.today && base && summary.status && (
        <p className="health-insight">
          This morning: <strong>{Math.round(summary.today.rmssd)}</strong> ms,{' '}
          {summary.status === 'within' ? 'in' : summary.status} your usual {base.lowMs}–{base.highMs} ms.
        </p>
      )}
      {!base && (
        <p className="health-insight">
          Calibrating: {Math.min(total, MIN_BASELINE_READINGS)}/{MIN_BASELINE_READINGS} mornings toward your usual range.
        </p>
      )}
      <div className="health-trend-controls">
        <p className="health-trend-title">
          <span className="health-trend-label">HRV (RMSSD)</span>
          <small>ms</small>
        </p>
        <div className="health-segment" role="group" aria-label="Trend window">
          {WINDOWS.map(n => (
            <button key={n} data-haptic="light" aria-pressed={window === n} onClick={() => setWindow(n)}>
              {n} days
            </button>
          ))}
        </div>
      </div>
      <div className="health-trend-reading" aria-live="off">
        <span>{dateLabel(shown.date)}</span>
        <strong>
          {shown.value == null ? 'No check' : shown.value}
          {shown.value != null && <small>ms</small>}
        </strong>
        {status && <span className="health-readiness-status" data-status={status}>{STATUS_TEXT[status]}</span>}
      </div>
      {count ? (
        <SeriesPlot
          values={rows.map(r => r.value)}
          label="HRV"
          selected={index}
          onSelect={i => setPicked({ key: pickKey, index: i })}
          band={base ? { low: base.lowMs, high: base.highMs } : null}
        />
      ) : (
        <p className="health-muted">No checks in this window</p>
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
            <dd>{Math.round(stats.min)}</dd>
          </div>
          <div>
            <dt>Average</dt>
            <dd>{Math.round(stats.avg)}</dd>
          </div>
          <div>
            <dt>High</dt>
            <dd>{Math.round(stats.max)}</dd>
          </div>
        </dl>
      )}
      {base && count > 0 && (
        <p className="health-band-key">
          <i aria-hidden="true" /> Usual {base.lowMs}–{base.highMs} ms, from {base.days} mornings
        </p>
      )}
      {weekSentence(summary.weekZ) && <p className="health-muted">{weekSentence(summary.weekZ)}</p>}
      <p className="health-coverage">
        {count}/{window} days{shown.hr != null ? ` · HR ${Math.round(shown.hr)} during the check` : ''}
      </p>
    </div>
  )
}
