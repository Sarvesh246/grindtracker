'use client'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import type { HealthSummary } from '@/lib/health/queries'
import {
  dateLabel,
  METRICS,
  metricValue,
  seriesStats,
  shiftDate,
  type HealthMetric
} from '@/lib/health/model'
import { sourceLabel } from '@/lib/health/reconcile'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import { ChevronDownSmall } from './Chrome'
import { thumbStyle } from './Overview'
import { formatMetric, isVolume, linePath, reading, shortUnit } from './model'
import { useScrub, useWidth } from './motion'

const WINDOWS = [7, 28, 90] as const
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DOW_LONG = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays'
]

export function MetricDetail({
  data,
  date,
  metric
}: {
  data: HealthSummary
  date: string
  metric: HealthMetric
}) {
  const [win, setWin] = useState<(typeof WINDOWS)[number]>(28)
  const [about, setAbout] = useState(false)
  const [ref, width] = useWidth<HTMLDivElement>(342)
  const chipsRef = useRef<HTMLDivElement>(null)
  const { reduceMotion } = useMotionPref()
  useEffect(() => {
    const row = chipsRef.current
    const on = row?.querySelector<HTMLElement>('[aria-current="page"]')
    if (row && on)
      row.scrollTo({
        left: on.offsetLeft - (row.clientWidth - on.clientWidth) / 2,
        behavior: reduceMotion ? 'auto' : 'smooth'
      })
  }, [metric, reduceMotion])
  const available = (Object.keys(METRICS) as HealthMetric[]).filter(
    (m) => m === metric || data.history.some((d) => metricValue(d, m) != null)
  )
  const volume = isVolume(metric)
  const unit = shortUnit(metric)
  const now = reading(data.history, data.sleeps, metric, date)
  const rows = Array.from({ length: win }, (_, i) => {
    const key = shiftDate(date, i - win + 1)
    return {
      date: key,
      value: metricValue(data.history.find((d) => d.local_date === key) ?? null, metric)
    }
  })
  const values = rows.map((r) => r.value)
  const count = values.filter((v) => v != null).length
  const scrub = useScrub(win, {
    bars: volume,
    resetKey: `${metric}:${win}:${date}`
  })
  const stats = seriesStats(values)
  const height = Math.round(Math.max(170, Math.min(280, width * 0.42)))
  const band = !volume && now.base ? now.base : null
  const present = values.filter((v): v is number => v != null)
  let lo = Math.min(...present, ...(band ? [band.low] : []))
  let hi = Math.max(...present, ...(band ? [band.high] : []))
  if (!present.length) [lo, hi] = [0, 1]
  const pad = (hi - lo) * 0.14 || 1
  if (volume) lo = 0
  else lo -= pad
  hi += pad
  const bw = width / win
  const x = (i: number) => (volume ? (i + 0.5) * bw : (i / (win - 1)) * width)
  const y = (v: number) => height - ((v - lo) / (hi - lo || 1)) * height
  const line = linePath(values, x, y)
  const avg = linePath(
    rows.map((r) => {
      const prior = data.history
        .filter((d) => d.local_date <= r.date && d.local_date > shiftDate(r.date, -7))
        .map((d) => metricValue(d, metric))
        .filter((v): v is number => v != null)
      return prior.length >= 3 ? prior.reduce((a, b) => a + b, 0) / prior.length : null
    }),
    x,
    y
  )
  const picked = scrub.index
  const weekday = (() => {
    const sums = [0, 0, 0, 0, 0, 0, 0]
    const counts = [0, 0, 0, 0, 0, 0, 0]
    for (const d of data.history) {
      const v = metricValue(d, metric)
      if (v == null || d.local_date <= shiftDate(date, -90) || d.local_date > date) continue
      const day = new Date(`${d.local_date}T12:00:00`).getDay()
      sums[day] += v
      counts[day]++
    }
    const avgs = sums.map((s, i) => (counts[i] >= 2 ? s / counts[i] : null))
    const known = avgs.filter((v): v is number => v != null)
    return known.length >= 4 ? avgs : null
  })()
  const todayDow = new Date(`${date}T12:00:00`).getDay()
  const wkMin = weekday ? Math.min(...weekday.filter((v): v is number => v != null)) : 0
  const wkMax = weekday ? Math.max(...weekday.filter((v): v is number => v != null)) : 1
  const coverage = new Map<string, number>()
  for (const r of rows) {
    const source = data.provenance[r.date]?.[metric]?.source
    if (r.value == null || !source) continue
    const name =
      source === 'legacy_snapshot'
        ? 'Garmin watch snapshots'
        : source === 'sleep_record'
          ? 'Sleep records'
          : sourceLabel(source)
    coverage.set(name, (coverage.get(name) ?? 0) + 1)
  }
  const fmt = (v: number) => formatMetric(v, metric)
  const chartKey = `${metric}:${win}:${width}`
  return (
    <>
      <div
        className="rcv-chips rcv-rise"
        ref={chipsRef}
        role="group"
        aria-label="Measurement"
        style={{ '--i': 1 } as CSSProperties}
      >
        {available.map((m) => (
          <Link
            key={m}
            href={`/progress/health/metrics/${m}?date=${date}`}
            aria-current={m === metric ? 'page' : undefined}
            data-haptic="light"
            replace
            scroll={false}
          >
            {METRICS[m].short}
          </Link>
        ))}
      </div>
      <div className="rcv-detail">
        <div className="rcv-col">
          <section
            className="rcv-value-hero rcv-rise"
            style={{ '--i': 2 } as CSSProperties}
            aria-label={`${METRICS[metric].label} on ${dateLabel(date)}`}
          >
            <span className="rcv-label rcv-label--strong">
              {METRICS[metric].label} · {dateLabel(date)}
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <strong>{now.value == null ? '—' : fmt(now.value)}</strong>
              <span>{unit || METRICS[metric].unit}</span>
            </div>
            <span className="rcv-standing" data-standing={now.standing}>
              <i aria-hidden="true" />
              {now.text}
            </span>
          </section>
          <section
            className="rcv-card rcv-card-pad rcv-rise"
            style={{ '--i': 3, gap: 16 } as CSSProperties}
            aria-label="Trend"
          >
            <div className="rcv-seg rcv-seg--accent" role="group" aria-label="Trend window">
              <span
                className="rcv-seg-thumb"
                aria-hidden="true"
                style={thumbStyle(WINDOWS.indexOf(win), WINDOWS.length)}
              />
              {WINDOWS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="rcv-mono"
                  aria-pressed={win === n}
                  aria-label={`${n} days`}
                  data-haptic="light"
                  onClick={() => setWin(n)}
                >
                  {n}D
                </button>
              ))}
            </div>
            {count ? (
              <div
                ref={ref}
                className="rcv-plot"
                role="group"
                aria-label={`${METRICS[metric].label} chart. Use left and right arrow keys to read values.`}
                data-swipe-ignore="true"
                style={{ paddingTop: 48 }}
                {...scrub.props}
              >
                {picked != null && (
                  <span
                    className="rcv-bubble"
                    role="status"
                    style={{
                      left: `${Math.max(14, Math.min(86, (x(picked) / width) * 100))}%`
                    }}
                  >
                    <b>
                      {values[picked] == null
                        ? 'No reading'
                        : `${fmt(values[picked]!)}${unit ? ` ${unit}` : ''}`}
                    </b>
                    {rows[picked].date === date ? 'Selected day' : dateLabel(rows[picked].date)}
                  </span>
                )}
                <svg
                  key={chartKey}
                  width={width}
                  height={height}
                  viewBox={`0 0 ${width} ${height}`}
                  role="img"
                  aria-label={`${METRICS[metric].label} over ${win} days`}
                >
                  {[0.25, 0.5, 0.75].map((f) => (
                    <line
                      key={f}
                      className="rcv-gridline"
                      x1={0}
                      x2={width}
                      y1={height * f}
                      y2={height * f}
                    />
                  ))}
                  {band && (
                    <g className="rcv-fade" style={{ '--d': '400ms' } as CSSProperties}>
                      <rect
                        x={0}
                        y={y(band.high)}
                        width={width}
                        height={Math.max(2, y(band.low) - y(band.high))}
                        rx={6}
                        style={{ fill: 'var(--accent)', opacity: 0.08 }}
                      />
                      <line
                        x1={0}
                        x2={width}
                        y1={y(band.high)}
                        y2={y(band.high)}
                        style={{
                          stroke: 'var(--accent-text)',
                          opacity: 0.35,
                          strokeDasharray: '3 4'
                        }}
                      />
                      <line
                        x1={0}
                        x2={width}
                        y1={y(band.low)}
                        y2={y(band.low)}
                        style={{
                          stroke: 'var(--accent-text)',
                          opacity: 0.35,
                          strokeDasharray: '3 4'
                        }}
                      />
                    </g>
                  )}
                  {volume ? (
                    values.map((v, i) =>
                      v == null ? null : (
                        <rect
                          key={i}
                          className="rcv-blk"
                          x={i * bw + bw * 0.15}
                          y={y(v)}
                          width={Math.max(1, bw * 0.7)}
                          height={height - y(v)}
                          rx={Math.min(4, bw * 0.25)}
                          style={
                            {
                              fill:
                                i === win - 1
                                  ? 'var(--accent)'
                                  : picked === i
                                    ? 'var(--text-primary)'
                                    : 'var(--rcv-track)',
                              transformOrigin: 'bottom',
                              animationName: 'rcv-up',
                              '--d': `${Math.round((i / win) * 600)}ms`
                            } as CSSProperties
                          }
                        />
                      )
                    )
                  ) : (
                    <>
                      <path
                        d={avg}
                        className="rcv-fade"
                        style={
                          {
                            fill: 'none',
                            stroke: 'var(--border-strong)',
                            strokeWidth: 1.5,
                            '--d': '900ms'
                          } as CSSProperties
                        }
                      />
                      <path
                        d={line}
                        pathLength={1}
                        className="rcv-draw"
                        style={{
                          fill: 'none',
                          stroke: 'var(--text-primary)',
                          strokeWidth: 2,
                          strokeLinecap: 'round',
                          strokeLinejoin: 'round'
                        }}
                      />
                      {win <= 28 &&
                        values.map((v, i) =>
                          v == null || i === win - 1 ? null : (
                            <circle
                              key={i}
                              className="rcv-fade"
                              cx={x(i)}
                              cy={y(v)}
                              r={3.5}
                              style={
                                {
                                  fill: 'var(--rcv-card)',
                                  stroke:
                                    band && (v < band.low || v > band.high)
                                      ? 'var(--rcv-steady)'
                                      : 'var(--text-primary)',
                                  strokeWidth: 2,
                                  '--d': '1100ms'
                                } as CSSProperties
                              }
                            />
                          )
                        )}
                      {values[win - 1] != null && (
                        <circle
                          cx={x(win - 1)}
                          cy={y(values[win - 1]!)}
                          r={6}
                          style={{
                            fill: 'var(--accent)',
                            stroke: 'var(--rcv-card)',
                            strokeWidth: 3
                          }}
                        />
                      )}
                    </>
                  )}
                  {picked != null && (
                    <>
                      <line
                        x1={x(picked)}
                        x2={x(picked)}
                        y1={-24}
                        y2={height}
                        style={{
                          stroke: 'var(--text-primary)',
                          strokeWidth: 1,
                          opacity: 0.45
                        }}
                      />
                      {!volume && values[picked] != null && (
                        <circle
                          cx={x(picked)}
                          cy={y(values[picked]!)}
                          r={6}
                          style={{
                            fill: 'var(--text-primary)',
                            stroke: 'var(--rcv-card)',
                            strokeWidth: 3
                          }}
                        />
                      )}
                    </>
                  )}
                </svg>
                <div className="rcv-axis" aria-hidden="true">
                  <span>{dateLabel(rows[0].date)}</span>
                  <span>{dateLabel(rows[Math.floor((win - 1) / 2)].date)}</span>
                  <span>{dateLabel(date)}</span>
                </div>
              </div>
            ) : (
              <p className="rcv-muted">
                {data.historyError ? 'Couldn’t load measurements.' : 'No readings in this window'}
              </p>
            )}
            {stats && (
              <div className="rcv-trio">
                <div>
                  <span className="rcv-label">Low</span>
                  <b>{fmt(stats.min)}</b>
                </div>
                <div>
                  <span className="rcv-label">Average</span>
                  <b>{fmt(stats.avg)}</b>
                </div>
                <div>
                  <span className="rcv-label">High</span>
                  <b>{fmt(stats.max)}</b>
                </div>
              </div>
            )}
            <div
              style={{
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
                fontSize: 12,
                color: 'var(--text-muted)'
              }}
            >
              {band && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i
                    style={{
                      width: 14,
                      height: 8,
                      borderRadius: 3,
                      background: 'color-mix(in srgb, var(--accent) 22%, transparent)',
                      display: 'block'
                    }}
                  />
                  Usual {fmt(band.low)}–{fmt(band.high)}
                </span>
              )}
              {!volume && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i
                    style={{
                      width: 14,
                      height: 2,
                      background: 'var(--border-strong)',
                      display: 'block'
                    }}
                  />
                  7-day average
                </span>
              )}
              <span style={{ marginLeft: 'auto' }}>
                {count}/{win} days
                {data.historyError || data.sampleHistoryError
                  ? ' · some sources could not refresh'
                  : ''}
              </span>
            </div>
          </section>
        </div>
        <div className="rcv-col">
          {weekday && (
            <section
              className="rcv-card rcv-card-pad rcv-rise"
              style={{ '--i': 4, gap: 16 } as CSSProperties}
              aria-labelledby="rcv-weekday"
            >
              <div className="rcv-card-head">
                <h2 id="rcv-weekday" className="rcv-label rcv-label--strong">
                  By weekday · 90 days
                </h2>
                <span className="rcv-muted" style={{ fontSize: 12 }}>
                  Highest on {DOW_LONG[weekday.indexOf(wkMax)]}
                </span>
              </div>
              <div
                className="rcv-weekday"
                role="img"
                aria-label={`Average by weekday. Highest on ${DOW_LONG[weekday.indexOf(wkMax)]}, lowest on ${DOW_LONG[weekday.indexOf(wkMin)]}.`}
              >
                {weekday.map((v, i) => (
                  <div key={i} data-today={i === todayDow}>
                    <span>{v == null ? '—' : fmt(v)}</span>
                    <i
                      style={
                        {
                          height: `${v == null ? 4 : 22 + ((v - wkMin) / (wkMax - wkMin || 1)) * 62}%`,
                          '--i': i
                        } as CSSProperties
                      }
                    />
                    <span>{DOW[i]}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="rcv-card rcv-rise" style={{ '--i': 5 } as CSSProperties}>
            <button
              type="button"
              className="rcv-driver"
              style={{ borderTop: 0, alignItems: 'center', minHeight: 56 }}
              aria-expanded={about}
              aria-controls="rcv-about"
              data-haptic="light"
              onClick={() => setAbout((o) => !o)}
            >
              <span className="rcv-driver-name" style={{ fontWeight: 600 }}>
                About {METRICS[metric].short}
              </span>
              <span
                style={{
                  display: 'flex',
                  transform: about ? 'rotate(180deg)' : 'none',
                  transition: 'transform 300ms ease',
                  color: 'var(--text-muted)'
                }}
              >
                <ChevronDownSmall />
              </span>
            </button>
            <div className="rcv-drawer" data-open={about} id="rcv-about">
              <div inert={!about}>
                <p>{METRICS[metric].meaning}</p>
              </div>
            </div>
          </section>
          <details className="rcv-card rcv-details rcv-rise" style={{ '--i': 6 } as CSSProperties}>
            <summary>
              Data and source coverage
              <ChevronDownSmall />
            </summary>
            <div>
              {coverage.size > 0 && (
                <ul
                  style={{
                    margin: '0 0 12px',
                    paddingLeft: 18,
                    fontSize: 13,
                    color: 'var(--text-secondary)'
                  }}
                >
                  {[...coverage].map(([name, days]) => (
                    <li key={name}>
                      {name} · {days}/{win} days
                    </li>
                  ))}
                </ul>
              )}
              <div className="rcv-table-wrap">
                <table className="rcv-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <td>
                        {METRICS[metric].short} ({METRICS[metric].unit})
                      </td>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows].reverse().map((r) => (
                      <tr key={r.date}>
                        <th>{dateLabel(r.date)}</th>
                        <td>{r.value == null ? 'No reading' : fmt(r.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        </div>
      </div>
    </>
  )
}
