'use client'
import { useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import type { Charge } from '@/lib/body/charge'
import type { HealthSummary } from '@/lib/health/queries'
import {
  clockLabel,
  dayAnnotations,
  intradayEnvelope,
  mainSleep,
  METRICS,
  metricValue,
  shiftDate,
  stageSeconds,
  STAGE_NAMES,
  type HealthMetric,
  type SleepStageName
} from '@/lib/health/model'
import { stepCurve } from '@/lib/health/intraday'
import { ChevronRight } from '@/components/ui/Icons'
import { ArrowUpRight, CoachButton, ChevronDownSmall, MoonIcon } from './Chrome'
import {
  adviceText,
  areaPath,
  BAND,
  bucketClock,
  drivers,
  formatMetric,
  hm,
  lastIndex,
  LEVELS,
  linePath,
  reading,
  shortUnit,
  isVolume
} from './model'
import { useCountUp, useScrub, useWidth } from './motion'

const R = 96
const C = 2 * Math.PI * R
function polar(r: number, p: number): [number, number] {
  const a = (p / 100) * Math.PI * 2 - Math.PI / 2
  return [120 + r * Math.cos(a), 120 + r * Math.sin(a)]
}
function arc(r: number, p0: number, p1: number) {
  const [x0, y0] = polar(r, p0)
  const [x1, y1] = polar(r, p1)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${p1 - p0 > 50 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}
const TICKS = Array.from({ length: 60 }, (_, i) => {
  const p = (i / 60) * 100
  const [ax, ay] = polar(i % 5 === 0 ? 103 : 106, p)
  const [bx, by] = polar(110, p)
  return `M${ax.toFixed(1)} ${ay.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`
}).join('')
const ZONES = [
  { band: 'easy', d: arc(116, 0.8, 49.2), color: 'var(--rcv-easy)' },
  { band: 'steady', d: arc(116, 50.8, 74.2), color: 'var(--rcv-steady)' },
  { band: 'primed', d: arc(116, 75.8, 99.2), color: 'var(--rcv-primed)' }
] as const

export function ChargeHero({
  charge,
  coachDraft,
  connect = false
}: {
  charge: Charge | null
  coachDraft: string
  /** No watch and no sleep yet: lead with the connection instead. */
  connect?: boolean
}) {
  const shown = useCountUp(charge?.score ?? null)
  const value = shown ?? 0
  const [tx, ty] = polar(R, Math.max(0.5, value))
  const meta = charge ? BAND[charge.band] : null
  return (
    <div
      className="rcv-a-hero"
      data-band={charge?.band ?? 'none'}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <section
        className="rcv-hero rcv-rise"
        style={{ '--i': 2 } as CSSProperties}
        aria-labelledby="rcv-headline"
      >
        <div className="rcv-ring">
          <div className="rcv-halo" aria-hidden="true" />
          <svg viewBox="0 0 240 240" aria-hidden="true">
            <path className="rcv-ticks" d={TICKS} />
            {ZONES.map((z) => (
              <path
                key={z.band}
                className="rcv-zone"
                d={z.d}
                style={{ stroke: z.color }}
                data-on={charge?.band === z.band}
              />
            ))}
            <circle className="rcv-ring-track" cx="120" cy="120" r={R} />
            {charge && (
              <>
                <circle
                  className="rcv-ring-arc"
                  cx="120"
                  cy="120"
                  r={R}
                  transform="rotate(-90 120 120)"
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - value / 100)}
                />
                <circle className="rcv-tip" cx={tx} cy={ty} r="8" />
              </>
            )}
          </svg>
          <div
            className="rcv-ring-center"
            role="img"
            aria-label={
              charge
                ? `Charge ${charge.score} of 100, ${charge.bandLabel}`
                : 'Charge not scored yet'
            }
          >
            <span className="rcv-label">Charge</span>
            <strong className="rcv-score">{charge ? shown : '–'}</strong>
            <span className="rcv-chip">{meta?.label ?? 'Calibrating'}</span>
          </div>
        </div>
        <h2 id="rcv-headline">{meta?.headline ?? 'Not enough data yet.'}</h2>
        <p>
          {charge
            ? adviceText(charge)
            : connect
              ? 'Sleep, recovery and daily activity from your Garmin.'
              : 'Charge needs at least two watch readings, like Body Battery and resting HR.'}
        </p>
        {connect && (
          <Link className="rcv-open" href="/profile/settings#health" data-haptic="light">
            Connect Garmin
            <ChevronRight size={16} />
          </Link>
        )}
      </section>
      {charge && meta && (
        <section
          className="rcv-card rcv-card-pad rcv-rise"
          style={{ '--i': 3 } as CSSProperties}
          aria-label="Today's call"
        >
          <div className="rcv-card-head">
            <span className="rcv-label rcv-label--strong">Today’s call</span>
            <span className="rcv-mono rcv-muted" style={{ fontSize: 12 }}>
              {meta.rpe}
            </span>
          </div>
          <div
            className="rcv-levels"
            role="img"
            aria-label={`Suggested intensity: ${LEVELS[meta.level]}`}
          >
            {LEVELS.map((name, i) => (
              <span key={name} data-on={i === meta.level}>
                {name}
              </span>
            ))}
          </div>
          <p className="rcv-call-text">{meta.call}</p>
        </section>
      )}
      <CoachButton className="rcv-coach--desk" label="Ask Coach" draft={coachDraft} />
    </div>
  )
}

export function DriversCard({ charge }: { charge: Charge }) {
  const [open, setOpen] = useState<string | null>(null)
  const list = drivers(charge.inputs)
  return (
    <section
      className="rcv-card rcv-a-drivers rcv-rise"
      style={{ '--i': 4, overflow: 'hidden' } as CSSProperties}
      aria-labelledby="rcv-drivers"
    >
      <div className="rcv-card-head" style={{ padding: '18px 18px 14px' }}>
        <h2 id="rcv-drivers" className="rcv-label rcv-label--strong">
          What moved it
        </h2>
        <span className="rcv-legend" aria-hidden="true">
          <span>
            <i style={{ background: 'var(--rcv-held)' }} />
            Held back
          </span>
          <span>
            <i style={{ background: 'var(--accent)' }} />
            Helped
          </span>
        </span>
      </div>
      {list.map((d, i) => {
        const isOpen = open === d.key
        const width = Math.max(2, Math.abs(d.impact) * 50)
        const color =
          d.effect === 'helped'
            ? 'var(--accent)'
            : d.effect === 'held'
              ? 'var(--rcv-held)'
              : 'var(--border-strong)'
        return (
          <div key={d.key}>
            <button
              type="button"
              className="rcv-driver"
              data-haptic="light"
              aria-expanded={isOpen}
              aria-controls={`rcv-driver-${d.key}`}
              onClick={() => setOpen(isOpen ? null : d.key)}
            >
              <span className="rcv-driver-name">
                <i style={{ background: color }} aria-hidden="true" />
                {d.label}
              </span>
              <span className="rcv-driver-value">{d.value}</span>
              <span
                className="rcv-diverge"
                role="img"
                aria-label={`${d.effect === 'helped' ? 'Helped' : d.effect === 'held' ? 'Held back' : 'Neutral'}, ${Math.round(d.weight * 100)}% of Charge`}
              >
                <i
                  style={
                    {
                      left: `${d.impact >= 0 ? 50 : 50 - width}%`,
                      width: `${width}%`,
                      background: color,
                      '--i': i,
                      '--from': d.impact >= 0 ? 'left center' : 'right center'
                    } as CSSProperties
                  }
                />
              </span>
            </button>
            <div className="rcv-drawer" data-open={isOpen} id={`rcv-driver-${d.key}`}>
              <div inert={!isOpen}>
                <p>
                  {d.note}{' '}
                  <span className="rcv-mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    · {Math.round(d.weight * 100)}% of Charge
                  </span>
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}

const STAGES: SleepStageName[] = ['deep', 'light', 'rem', 'awake']
const STAGE_COLOR: Record<SleepStageName, string> = {
  deep: 'var(--sleep-deep)',
  light: 'var(--sleep-light)',
  rem: 'var(--sleep-rem)',
  awake: 'var(--sleep-awake)'
}
export { STAGES, STAGE_COLOR }

export function Duration({
  seconds,
  className = 'rcv-big'
}: {
  seconds: number
  className?: string
}) {
  const minutes = Math.round(seconds / 60)
  const h = Math.floor(minutes / 60)
  return (
    <span className={className} aria-label={hm(seconds)}>
      <span aria-hidden="true">
        {h > 0 && (
          <>
            {h}
            <small>h</small>
          </>
        )}
        {minutes % 60}
        <small>m</small>
      </span>
    </span>
  )
}

export function SleepCard({
  data,
  date,
  today
}: {
  data: HealthSummary
  date: string
  today: string
}) {
  const sleep = mainSleep(data.sleeps, date)
  const naps = data.sleeps.filter((s) => s.wake_date === date && s.kind === 'nap')
  const head = (
    <div className="rcv-card-head">
      <span
        className="rcv-label rcv-label--strong"
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <span style={{ color: 'var(--sleep-light)', display: 'flex' }}>
          <MoonIcon />
        </span>
        {date === today
          ? 'Last night'
          : `Sleep · ${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}`}
      </span>
      {sleep && <ChevronRight size={18} className="rcv-muted" />}
    </div>
  )
  if (!sleep)
    return (
      <section
        id="sleep"
        className="rcv-card rcv-card-pad rcv-a-sleep rcv-rise"
        style={{ '--i': 5 } as CSSProperties}
      >
        {head}
        <div className="rcv-empty">
          {data.sleepState === 'error' ? (
            <h3>Couldn’t load sleep</h3>
          ) : (
            <>
              <h3>{naps.length ? 'Nap only' : 'No sleep recorded'}</h3>
              <Link className="rcv-link" href="/profile/settings#health-import">
                Add sleep data
                <ChevronRight size={14} />
              </Link>
            </>
          )}
        </div>
      </section>
    )
  const totals = stageSeconds(sleep)
  const parts = STAGES.filter((s) => totals[s] != null && totals[s]! > 0)
  return (
    <Link
      id="sleep"
      href={`/progress/health/sleep?date=${date}`}
      className="rcv-card rcv-card-pad rcv-tap rcv-a-sleep rcv-rise"
      style={{ '--i': 5, gap: 16 } as CSSProperties}
      data-haptic="light"
      aria-label={`Sleep ${hm(sleep.duration_seconds)}${sleep.score != null ? `, score ${sleep.score}` : ''}. Open sleep details.`}
    >
      {head}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 12
        }}
      >
        <Duration seconds={sleep.duration_seconds} />
        {sleep.score != null && (
          <span style={{ textAlign: 'right' }}>
            <span className="rcv-label" style={{ display: 'block' }}>
              Score
            </span>
            <strong className="rcv-mono" style={{ fontSize: 22, fontWeight: 600 }}>
              {sleep.score}
            </strong>
          </span>
        )}
      </div>
      {parts.length > 0 && (
        <>
          <div className="rcv-stagebar" aria-hidden="true">
            {parts.map((s, i) => (
              <span
                key={s}
                style={
                  {
                    flexGrow: totals[s]!,
                    background: STAGE_COLOR[s],
                    '--i': i
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className="rcv-stage-legend">
            {parts.map((s) => (
              <div key={s}>
                <span>
                  <i style={{ background: STAGE_COLOR[s] }} aria-hidden="true" />
                  {STAGE_NAMES[s]}
                </span>
                <b>{hm(totals[s]!)}</b>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="rcv-split">
        <span>
          Asleep <b>{clockLabel(sleep.start_at, sleep.timezone)}</b>
        </span>
        <span>
          Up <b>{clockLabel(sleep.end_at, sleep.timezone)}</b>
        </span>
      </div>
    </Link>
  )
}

/** The sliding highlight behind a segmented control's selected button. */
export function thumbStyle(index: number, count: number): CSSProperties {
  const each = `((100% - ${8 + (count - 1) * 4}px) / ${count})`
  return { left: `calc(4px + ${index} * (${each} + 4px))`, width: `calc${each}` }
}

type Series = 'bb' | 'hr' | 'steps'
const SERIES_LABEL: Record<Series, string> = {
  bb: 'Body Battery',
  hr: 'Heart rate',
  steps: 'Steps'
}

export function DayCard({
  data,
  date,
  today
}: {
  data: HealthSummary
  date: string
  today: string
}) {
  const row = data.body.todayRow
  const [series, setSeries] = useState<Series>('bb')
  const [ref, width] = useWidth<HTMLDivElement>(342)
  const sets: Record<Series, (number | null)[]> = {
    bb: row?.bb_series ?? [],
    hr: row?.hr_series ?? [],
    steps: stepCurve(row?.steps_series ?? [])
  }
  const options = (Object.keys(sets) as Series[]).filter((k) => sets[k].some((v) => v != null))
  const active: Series = options.includes(series) ? series : (options[0] ?? 'bb')
  const values = Array.from({ length: 96 }, (_, i) => sets[active][i] ?? null)
  const stress = Array.from({ length: 96 }, (_, i) => row?.stress_series?.[i] ?? null)
  const last = lastIndex(values)
  const max = last >= 0 ? last : 95
  const scrub = useScrub(96, { max, resetKey: `${date}:${active}` })
  if (!row || (!options.length && !stress.some((v) => v != null)))
    return (
      <section
        className="rcv-card rcv-card-pad rcv-a-day rcv-rise"
        style={{ '--i': 6 } as CSSProperties}
        id="day"
      >
        <span className="rcv-label rcv-label--strong">Your day</span>
        <p className="rcv-muted">No readings for this date</p>
      </section>
    )
  const height = Math.round(Math.max(140, Math.min(220, width * 0.3)))
  const present = values.filter((v): v is number => v != null)
  const [lo, hi] =
    active === 'hr'
      ? [Math.min(...present) - 6, Math.max(...present) + 6]
      : active === 'steps'
        ? [0, Math.max(1000, ...present) * 1.1]
        : [0, 100]
  const x = (i: number) => (i / 95) * width
  const y = (v: number) => height - ((v - lo) / (hi - lo || 1)) * height
  const line = linePath(values, x, y)
  const area = last >= 0 && active !== 'hr' ? areaPath(values, x, y, height) : ''
  const usual = active === 'bb' ? intradayEnvelope(data.body.days, date, 'bb_series') : null
  let band = ''
  if (usual) {
    const top = linePath(usual.high, x, y)
    const pts = usual.low
      .map((v, i) => (v == null ? null : `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`))
      .filter(Boolean)
      .reverse()
    band = top && pts.length ? `${top}${pts.join('')}Z` : ''
  }
  const notes = dayAnnotations(data.workouts, mainSleep(data.sleeps, date), date)
  const sleepNote = notes.find((n) => n.kind === 'sleep')
  const workouts = notes.filter((n) => n.kind === 'workout')
  const at = scrub.index ?? (last >= 0 ? last : null)
  const fmt = (v: number | null) =>
    v == null
      ? '—'
      : active === 'steps'
        ? Math.round(v).toLocaleString('en-US')
        : String(Math.round(v))
  const peak = active === 'bb' ? row.bb_high : present.length ? Math.max(...present) : null
  const isToday = date === today
  const unit = active === 'hr' ? 'bpm' : ''
  const key = `${date}:${active}:${width}`
  return (
    <section
      className="rcv-card rcv-card-pad rcv-a-day rcv-rise"
      style={{ '--i': 6 } as CSSProperties}
      id="day"
      aria-labelledby="rcv-day-title"
    >
      <div className="rcv-card-head" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h2 id="rcv-day-title" className="rcv-label rcv-label--strong">
            {SERIES_LABEL[active]}
          </h2>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              marginTop: 6
            }}
          >
            <strong
              className="rcv-mono"
              style={{
                fontSize: 36,
                fontWeight: 500,
                letterSpacing: '-.03em',
                lineHeight: 1
              }}
            >
              {last >= 0 ? fmt(values[last]) : '—'}
            </strong>
            <span className="rcv-muted" style={{ fontSize: 13 }}>
              {unit && `${unit} · `}
              {isToday ? `at ${bucketClock(last)}` : 'end of day'}
              {peak != null && active !== 'steps' ? ` · peak ${Math.round(peak)}` : ''}
            </span>
          </div>
        </div>
        {options.length > 1 && (
          <div className="rcv-seg" role="group" aria-label="Day series" style={{ minWidth: 220 }}>
            <span
              className="rcv-seg-thumb"
              aria-hidden="true"
              style={thumbStyle(options.indexOf(active), options.length)}
            />
            {options.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={k === active}
                data-haptic="light"
                onClick={() => setSeries(k)}
              >
                {k === 'bb' ? 'Battery' : k === 'hr' ? 'HR' : 'Steps'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        ref={ref}
        className="rcv-plot"
        role="group"
        aria-label={`${SERIES_LABEL[active]} chart. Use left and right arrow keys to read values.`}
        data-swipe-ignore="true"
        {...scrub.props}
      >
        <svg
          key={key}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${SERIES_LABEL[active]} through the day`}
        >
          <defs>
            <linearGradient id="rcv-day-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity={0.28} />
              <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {sleepNote && (
            <rect
              x={0}
              y={0}
              width={x(sleepNote.to)}
              height={height}
              rx={6}
              style={{ fill: 'var(--sleep-light)', opacity: 0.07 }}
            />
          )}
          {workouts.map((w) => (
            <rect
              key={w.from}
              x={x(w.from)}
              y={0}
              width={Math.max(4, x(w.to) - x(w.from))}
              height={height}
              rx={4}
              style={{ fill: 'var(--rcv-held)', opacity: 0.12 }}
            >
              <title>{w.label}</title>
            </rect>
          ))}
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
            <path
              d={band}
              className="rcv-fade"
              style={
                {
                  fill: 'var(--rcv-track)',
                  opacity: 0.9,
                  '--d': '700ms'
                } as CSSProperties
              }
            />
          )}
          {area && (
            <path
              d={area}
              className="rcv-fade"
              fill="url(#rcv-day-fill)"
              style={{ '--d': '900ms' } as CSSProperties}
            />
          )}
          <path
            d={line}
            pathLength={1}
            className="rcv-draw"
            style={{
              fill: 'none',
              stroke: 'var(--accent)',
              strokeWidth: 2.5,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            }}
          />
          {last >= 0 && values[last] != null && (
            <>
              {isToday && (
                <circle
                  className="rcv-now"
                  cx={x(last)}
                  cy={y(values[last]!)}
                  r={4}
                  style={{ fill: 'var(--accent)' }}
                />
              )}
              <circle
                cx={x(last)}
                cy={y(values[last]!)}
                r={4.5}
                style={{
                  fill: 'var(--bg)',
                  stroke: 'var(--accent)',
                  strokeWidth: 2.5
                }}
              />
            </>
          )}
          {scrub.index != null && (
            <>
              <line
                x1={x(scrub.index)}
                x2={x(scrub.index)}
                y1={0}
                y2={height}
                style={{
                  stroke: 'var(--text-primary)',
                  strokeWidth: 1,
                  opacity: 0.5
                }}
              />
              {values[scrub.index] != null && (
                <circle
                  cx={x(scrub.index)}
                  cy={y(values[scrub.index]!)}
                  r={6}
                  style={{
                    fill: 'var(--text-primary)',
                    stroke: 'var(--bg)',
                    strokeWidth: 3
                  }}
                />
              )}
            </>
          )}
        </svg>
        {stress.some((v) => v != null) && (
          <div className="rcv-stress" aria-hidden="true">
            {stress.map((v, i) => (
              <i
                key={`${date}-${i}`}
                style={
                  {
                    height: `${v == null ? 0 : Math.max(6, Math.min(100, v))}%`,
                    opacity: v == null ? 0 : v > 60 ? 1 : v > 30 ? 0.55 : 0.22,
                    outline: scrub.index === i ? '1px solid var(--text-primary)' : undefined,
                    '--d': `${300 + i * 8}ms`
                  } as CSSProperties
                }
              />
            ))}
          </div>
        )}
        <div className="rcv-axis" aria-hidden="true">
          <span>12A</span>
          <span>6A</span>
          <span>12P</span>
          <span>6P</span>
          <span>12A</span>
        </div>
      </div>
      <div className="rcv-readout" aria-live="polite">
        <span className="rcv-mono" style={{ color: 'var(--text-primary)', minWidth: 64 }}>
          {at == null ? '—' : scrub.index == null && isToday ? 'Now' : bucketClock(at)}
        </span>
        <span>
          {active === 'bb' ? 'Battery' : SERIES_LABEL[active]}{' '}
          <b>{at == null ? '—' : fmt(values[at])}</b>
        </span>
        {stress.some((v) => v != null) && (
          <span>
            Stress{' '}
            <b style={{ color: 'var(--health-stress)' }}>
              {at == null || stress[at] == null ? '—' : stress[at]}
            </b>
          </span>
        )}
        {usual && at != null && usual.low[at] != null && usual.high[at] != null ? (
          <span className="rcv-mono">
            usual {Math.round(usual.low[at]!)}–{Math.round(usual.high[at]!)}
          </span>
        ) : (
          <span />
        )}
      </div>
    </section>
  )
}

const VITALS: HealthMetric[] = [
  'resting_hr',
  'overnight_hrv',
  'bb_latest',
  'stress_avg',
  'recovery_hours',
  'steps',
  'active_minutes',
  'spo2',
  'floors'
]

export function Vitals({ data, date }: { data: HealthSummary; date: string }) {
  const shown = VITALS.filter((m) => data.history.some((d) => metricValue(d, m) != null))
  if (!shown.length) return null
  return (
    <section
      className="rcv-a-vitals rcv-rise"
      style={
        {
          '--i': 7,
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        } as CSSProperties
      }
      aria-labelledby="rcv-vitals"
    >
      <div className="rcv-section-head">
        <h2 id="rcv-vitals">Vitals</h2>
        <span>vs your usual</span>
      </div>
      <div className="rcv-tiles">
        {shown.map((m, i) => {
          const r = reading(data.history, data.sleeps, m, date)
          const unit = shortUnit(m)
          return (
            <Link
              key={m}
              href={`/progress/health/metrics/${m}?date=${date}`}
              className="rcv-card rcv-tile rcv-tap"
              data-haptic="light"
              aria-label={`${METRICS[m].short}: ${r.value == null ? 'no reading' : `${formatMetric(r.value, m)} ${METRICS[m].unit}`}. ${r.text}. Open details.`}
            >
              <span className="rcv-tile-top">
                {METRICS[m].short}
                <ArrowUpRight />
              </span>
              <span className="rcv-tile-value">
                {r.value == null ? '—' : formatMetric(r.value, m)}
                {r.value != null && unit && <small>{unit}</small>}
              </span>
              <span className="rcv-range" data-volume={isVolume(m)} aria-hidden="true">
                {r.track && r.track.bandWidth > 0 && (
                  <span
                    style={{
                      left: `${r.track.bandLeft}%`,
                      width: `${r.track.bandWidth}%`
                    }}
                  />
                )}
                {r.track && (
                  <i
                    data-out={r.standing === 'above' || r.standing === 'below'}
                    style={{ left: `${r.track.dot}%`, '--i': i } as CSSProperties}
                  />
                )}
              </span>
              <span className="rcv-tile-state">{r.text}</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

export function LongGame({ data, date }: { data: HealthSummary; date: string }) {
  const points = data.history
    .filter((d) => d.local_date > shiftDate(date, -90) && d.local_date <= date)
    .map((d) => metricValue(d, 'vo2max'))
    .filter((v): v is number => v != null)
  if (points.length < 2) return null
  const lo = Math.min(...points) - 0.5
  const hi = Math.max(...points) + 0.5
  const path = points
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'}${((i / (points.length - 1)) * 196 + 2).toFixed(1)} ${(42 - ((v - lo) / (hi - lo)) * 38).toFixed(1)}`
    )
    .join('')
  const latest = points.at(-1)!
  const change = latest - points[0]
  return (
    <section
      className="rcv-card rcv-card-pad rcv-a-long rcv-rise"
      style={{ '--i': 8 } as CSSProperties}
      aria-label="VO₂ max over 90 days"
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.3fr)',
          gap: 16,
          alignItems: 'end'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="rcv-label rcv-label--strong">VO₂ max · 90 days</span>
          <span>
            <strong className="rcv-display" style={{ fontSize: 52, lineHeight: 0.9 }}>
              {formatMetric(latest, 'vo2max')}
            </strong>
            <span className="rcv-muted" style={{ fontSize: 13, marginLeft: 6 }}>
              ml/kg/min
            </span>
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {Math.abs(change) < 0.05
              ? 'Holding steady'
              : `${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(1)} over this window`}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <svg
            viewBox="0 0 200 46"
            style={{ width: '100%', height: 46 }}
            aria-hidden="true"
            preserveAspectRatio="none"
            className="rcv-wipe"
          >
            <path
              d={path}
              vectorEffect="non-scaling-stroke"
              style={{
                fill: 'none',
                stroke: 'var(--accent)',
                strokeWidth: 2,
                strokeLinecap: 'round',
                strokeLinejoin: 'round'
              }}
            />
          </svg>
          <Link
            className="rcv-link"
            href="/profile"
            style={{ alignSelf: 'flex-end', fontSize: 13 }}
          >
            Fitness age
            <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  )
}

export function MoreSection({ children }: { children: ReactNode }) {
  return (
    <div className="rcv-more rcv-a-more rcv-rise" style={{ '--i': 9 } as CSSProperties}>
      {children}
    </div>
  )
}

export function DataSources({
  children,
  label = 'Data & sources'
}: {
  children: ReactNode
  label?: string
}) {
  return (
    <details className="rcv-card rcv-details">
      <summary>
        {label}
        <ChevronDownSmall />
      </summary>
      <div>{children}</div>
    </details>
  )
}
