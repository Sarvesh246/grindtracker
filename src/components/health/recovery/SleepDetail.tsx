'use client'
import { useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import type { HealthSummary } from '@/lib/health/queries'
import {
  clockLabel,
  dateLabel,
  mainSleep,
  shiftDate,
  stageSeconds,
  STAGE_NAMES,
  type SleepSession
} from '@/lib/health/model'
import { ChevronRight } from '@/components/ui/Icons'
import { ChevronDownSmall, CoachButton, MoonIcon } from './Chrome'
import { Duration, STAGE_COLOR, STAGES, thumbStyle } from './Overview'
import { clockMinutes, hm, reading, sleepSourcesNote, STAGE_LANE, stageUsual } from './model'
import { useScrub, useWidth } from './motion'

const LANE_H = 34
const STARS: [number, number, number][] = [
  [8, 22, 0],
  [30, 48, 1.2],
  [54, 16, 2.1],
  [64, 60, 0.6],
  [18, 72, 3],
  [86, 74, 1.7]
]

function Hypnogram({ sleep }: { sleep: SleepSession }) {
  const [ref, width] = useWidth<HTMLDivElement>(290)
  const start = Date.parse(sleep.start_at)
  const total = Math.max(1, Date.parse(sleep.end_at) - start)
  const blocks = useMemo(
    () =>
      (sleep.stages ?? []).map((s) => {
        const from = (Date.parse(s.start) - start) / total
        const to = (Date.parse(s.end) - start) / total
        return { ...s, from: Math.max(0, from), to: Math.min(1, to) }
      }),
    [sleep.stages, start, total]
  )
  const plotW = Math.max(120, width - 54)
  const scrub = useScrub(blocks.length, {
    resetKey: sleep.provider_id,
    inset: [54, 0],
    locate: (p) =>
      Math.max(
        0,
        blocks.findIndex((b) => p < b.to) === -1
          ? blocks.length - 1
          : blocks.findIndex((b) => p < b.to)
      )
  })
  const picked = scrub.index == null ? null : blocks[scrub.index]
  const x = (f: number) => f * plotW
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    clockLabel(new Date(start + total * f).toISOString(), sleep.timezone)
      .replace(':00', '')
      .replace(/\s?([AP])M/i, '$1')
  )
  return (
    <>
      <div
        ref={ref}
        className="rcv-plot"
        role="group"
        aria-label={`Sleep stages from ${clockLabel(sleep.start_at, sleep.timezone)} to ${clockLabel(sleep.end_at, sleep.timezone)}. Use left and right arrow keys to read each stage.`}
        data-swipe-ignore="true"
        {...scrub.props}
      >
        <div className="rcv-hyp">
          <div className="rcv-hyp-lanes" aria-hidden="true">
            <span>Awake</span>
            <span>REM</span>
            <span>Light</span>
            <span>Deep</span>
          </div>
          <svg
            width={plotW}
            height={LANE_H * 4}
            viewBox={`0 0 ${plotW} ${LANE_H * 4}`}
            aria-hidden="true"
          >
            {[0, 1, 2, 3].map((l) => (
              <line
                key={l}
                x1={0}
                x2={plotW}
                y1={l * LANE_H + LANE_H / 2}
                y2={l * LANE_H + LANE_H / 2}
                style={{ stroke: 'var(--rcv-line)', strokeWidth: 1 }}
              />
            ))}
            {blocks.slice(1).map((b, i) => {
              const prev = STAGE_LANE[blocks[i].stage]
              const lane = STAGE_LANE[b.stage]
              return (
                <line
                  key={`c${i}`}
                  className="rcv-fade"
                  x1={x(b.from)}
                  x2={x(b.from)}
                  y1={Math.min(prev, lane) * LANE_H + LANE_H / 2}
                  y2={Math.max(prev, lane) * LANE_H + LANE_H / 2}
                  style={
                    {
                      stroke: 'var(--border-strong)',
                      strokeWidth: 1.5,
                      '--d': `${260 + i * 45}ms`
                    } as CSSProperties
                  }
                />
              )
            })}
            {blocks.map((b, i) => (
              <rect
                key={i}
                className="rcv-blk"
                x={x(b.from)}
                y={STAGE_LANE[b.stage] * LANE_H + 6}
                width={Math.max(1.5, x(b.to) - x(b.from) - 1)}
                height={22}
                rx={5}
                style={
                  {
                    fill: STAGE_COLOR[b.stage],
                    opacity: scrub.index == null || scrub.index === i ? 1 : 0.35,
                    '--d': `${200 + i * 45}ms`
                  } as CSSProperties
                }
              />
            ))}
            {picked && (
              <line
                x1={x((picked.from + picked.to) / 2)}
                x2={x((picked.from + picked.to) / 2)}
                y1={0}
                y2={LANE_H * 4}
                style={{
                  stroke: 'var(--text-primary)',
                  strokeWidth: 1,
                  opacity: 0.6
                }}
              />
            )}
          </svg>
        </div>
        <div className="rcv-axis" style={{ paddingLeft: 54 }} aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>
      <div className="rcv-readout" aria-live="polite">
        <span className="rcv-mono" style={{ color: 'var(--text-primary)', minWidth: 70 }}>
          {clockLabel(picked?.start ?? sleep.start_at, sleep.timezone)}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <i
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              display: 'block',
              background: picked ? STAGE_COLOR[picked.stage] : 'var(--sleep-light)'
            }}
            aria-hidden="true"
          />
          <b style={{ fontFamily: 'var(--font-sans)', fontSize: 14 }}>
            {picked ? STAGE_NAMES[picked.stage] : 'Fell asleep'}
          </b>
        </span>
        <span className="rcv-mono">
          {picked
            ? hm((Date.parse(picked.end) - Date.parse(picked.start)) / 1000)
            : `${blocks.length} stages`}
        </span>
      </div>
      <details className="rcv-details" style={{ margin: '0 -18px -18px' }}>
        <summary>
          Stage table
          <ChevronDownSmall />
        </summary>
        <div className="rcv-table-wrap">
          <table className="rcv-table">
            <thead>
              <tr>
                <th>Start</th>
                <th>Stage</th>
                <td>Length</td>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b, i) => (
                <tr key={i}>
                  <th>{clockLabel(b.start, sleep.timezone)}</th>
                  <th>{STAGE_NAMES[b.stage]}</th>
                  <td>{hm((Date.parse(b.end) - Date.parse(b.start)) / 1000)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  )
}

function Rhythm({ data, date, sleep }: { data: HealthSummary; date: string; sleep: SleepSession }) {
  const [mode, setMode] = useState<'window' | 'hours'>('window')
  const nights = Array.from({ length: 7 }, (_, i) => shiftDate(date, i - 6)).map((day) => ({
    day,
    night: mainSleep(data.sleeps, day)
  }))
  const logged = nights.filter((n): n is { day: string; night: SleepSession } => !!n.night)
  if (logged.length < 2) return null
  const beds = logged.map((n) => clockMinutes(n.night.start_at, n.night.timezone))
  const wakes = logged.map((n) => clockMinutes(n.night.end_at, n.night.timezone))
  const lo = Math.floor((Math.min(...beds) - 30) / 60) * 60
  const hi = Math.ceil((Math.max(...wakes) + 30) / 60) * 60
  const longest = Math.max(...logged.map((n) => n.night.duration_seconds), 8 * 3600)
  const mean = beds.reduce((a, b) => a + b, 0) / beds.length
  const spread = Math.round(Math.sqrt(beds.reduce((a, b) => a + (b - mean) ** 2, 0) / beds.length))
  const clock = (m: number) => {
    const h = ((Math.floor(m / 60) % 24) + 24) % 24
    return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
  }
  const isWin = mode === 'window'
  return (
    <section
      className="rcv-card rcv-card-pad rcv-rise"
      style={{ '--i': 6 } as CSSProperties}
      aria-labelledby="rcv-rhythm"
    >
      <div className="rcv-card-head" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h2 id="rcv-rhythm" className="rcv-label rcv-label--strong">
            Rhythm · 7 nights
          </h2>
          <p style={{ marginTop: 6, fontSize: 14, color: 'var(--text-primary)' }}>
            {logged.length >= 4 ? (
              <>
                Bedtime varies{' '}
                <b className="rcv-mono" style={{ fontWeight: 500 }}>
                  ±{spread} min
                </b>
              </>
            ) : (
              `${logged.length} of 7 nights logged`
            )}
          </p>
        </div>
        <div className="rcv-seg" role="group" aria-label="Show" style={{ width: 150 }}>
          <span className="rcv-seg-thumb" aria-hidden="true" style={thumbStyle(isWin ? 0 : 1, 2)} />
          <button
            type="button"
            aria-pressed={isWin}
            data-haptic="light"
            onClick={() => setMode('window')}
          >
            Window
          </button>
          <button
            type="button"
            aria-pressed={!isWin}
            data-haptic="light"
            onClick={() => setMode('hours')}
          >
            Hours
          </button>
        </div>
      </div>
      <div className="rcv-nights" role="list">
        {nights.map(({ day, night }, i) => {
          const b = night ? clockMinutes(night.start_at, night.timezone) : 0
          const e = night ? clockMinutes(night.end_at, night.timezone) : 0
          return (
            <div
              key={day}
              role="listitem"
              data-current={day === sleep.wake_date}
              aria-label={
                night
                  ? `${dateLabel(day)}: ${clockLabel(night.start_at, night.timezone)} to ${clockLabel(night.end_at, night.timezone)}, ${hm(night.duration_seconds)}`
                  : `${dateLabel(day)}: no sleep recorded`
              }
            >
              <span aria-hidden="true">
                {new Date(`${day}T12:00:00`)
                  .toLocaleDateString('en-US', { weekday: 'short' })
                  .slice(0, 2)}
              </span>
              <span className="rcv-win" aria-hidden="true">
                {night && (
                  <i
                    style={
                      {
                        left: `${isWin ? ((b - lo) / (hi - lo)) * 100 : 0}%`,
                        width: `${isWin ? ((e - b) / (hi - lo)) * 100 : (night.duration_seconds / longest) * 100}%`,
                        '--i': i
                      } as CSSProperties
                    }
                  />
                )}
              </span>
            </div>
          )
        })}
      </div>
      <div className="rcv-axis" style={{ paddingLeft: 44 }} aria-hidden="true">
        {isWin ? (
          <>
            <span>{clock(lo)}</span>
            <span>{clock((lo + hi) / 2)}</span>
            <span>{clock(hi)}</span>
          </>
        ) : (
          <>
            <span>0h</span>
            <span>{Math.round(longest / 7200)}h</span>
            <span>{Math.round(longest / 3600)}h</span>
          </>
        )}
      </div>
    </section>
  )
}

export function SleepDetail({ data, date }: { data: HealthSummary; date: string }) {
  const sleep = mainSleep(data.sleeps, date)
  const naps = data.sleeps.filter((s) => s.wake_date === date && s.kind === 'nap')
  if (!sleep)
    return (
      <section
        id="sleep"
        className="rcv-card rcv-card-pad rcv-rise"
        style={{ '--i': 2 } as CSSProperties}
      >
        <div className="rcv-empty">
          <span style={{ color: 'var(--sleep-rem)' }}>
            <MoonIcon size={28} />
          </span>
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
        {naps.map((nap) => (
          <p key={nap.provider_id} className="rcv-muted">
            {hm(nap.duration_seconds)} · {clockLabel(nap.start_at, nap.timezone)} –{' '}
            {clockLabel(nap.end_at, nap.timezone)}
          </p>
        ))}
      </section>
    )
  const totals = stageSeconds(sleep)
  const usual = stageUsual(data.sleeps, sleep)
  const inBed = Math.max(
    sleep.duration_seconds,
    (Date.parse(sleep.end_at) - Date.parse(sleep.start_at)) / 1000
  )
  const hrv = reading(data.history, data.sleeps, 'overnight_hrv', date)
  const rhr = reading(data.history, data.sleeps, 'resting_hr', date)
  const stats = [
    sleep.overnight_hrv != null && {
      label: 'Avg HRV',
      value: String(sleep.overnight_hrv),
      unit: 'ms',
      note: hrv.value != null ? hrv.text : ''
    },
    rhr.value != null && {
      label: 'Resting HR',
      value: String(rhr.value),
      unit: 'bpm',
      note: rhr.text
    },
    sleep.respiration != null && {
      label: 'Respiration',
      value: String(sleep.respiration),
      unit: 'br/min',
      note: ''
    },
    sleep.spo2 != null && {
      label: 'Blood oxygen',
      value: String(sleep.spo2),
      unit: '%',
      note: ''
    }
  ].filter((s): s is { label: string; value: string; unit: string; note: string } => !!s)
  const latestHrv =
    sleep.overnight_hrv == null
      ? [
          ...new Set(
            data.sleeps
              .filter((s) => s.wake_date < date && s.overnight_hrv != null)
              .map((s) => s.wake_date)
          )
        ]
          .sort()
          .reverse()
          .map((day) => mainSleep(data.sleeps, day))
          .find((s) => s?.overnight_hrv != null)
      : null
  const stageRows = STAGES.filter((s) => totals[s] != null)
  const stageMax =
    Math.max(...stageRows.map((s) => Math.max(totals[s] ?? 0, usual[s]?.[1] ?? 0)), 1) * 1.15
  return (
    <div className="rcv-detail">
      <div className="rcv-col">
        <section
          className="rcv-night rcv-rise"
          style={{ '--i': 2 } as CSSProperties}
          aria-label="Night summary"
        >
          {STARS.map(([l, t, d], i) => (
            <span
              key={i}
              className="rcv-star"
              aria-hidden="true"
              style={{ left: `${l}%`, top: t, animationDelay: `${d}s` }}
            />
          ))}
          <span className="rcv-moon" aria-hidden="true">
            <MoonIcon size={54} />
          </span>
          <span className="rcv-label rcv-label--strong">Asleep</span>
          <Duration seconds={sleep.duration_seconds} className="rcv-huge" />
          <div className="rcv-pills">
            {sleep.score != null && <span data-tone="rem">Score {sleep.score}</span>}
            <span>
              In bed <b>{hm(inBed)}</b>
            </span>
            <span>
              Efficiency <b>{Math.round((sleep.duration_seconds / inBed) * 100)}%</b>
            </span>
          </div>
          <p className="rcv-muted" style={{ fontSize: 13 }}>
            {clockLabel(sleep.start_at, sleep.timezone)} –{' '}
            {clockLabel(sleep.end_at, sleep.timezone)} · {sleep.timezone}
          </p>
        </section>
        {sleep.stages?.length ? (
          <section
            className="rcv-card rcv-card-pad rcv-rise"
            style={{ '--i': 3 } as CSSProperties}
            aria-labelledby="rcv-stages"
          >
            <div className="rcv-card-head">
              <h2 id="rcv-stages" className="rcv-label rcv-label--strong">
                Stages
              </h2>
              <span className="rcv-mono rcv-muted" style={{ fontSize: 12 }}>
                {dateLabel(date)}
              </span>
            </div>
            <Hypnogram sleep={sleep} />
          </section>
        ) : null}
        <CoachButton
          className="rcv-coach--desk"
          label="Ask Coach about this night"
          draft={`Explain my sleep for the night ending ${date}: duration, stages, timing and overnight HRV compared with my usual, and what it means for training today.`}
        />
      </div>
      <div className="rcv-col">
        {stageRows.length > 0 && (
          <section
            className="rcv-card rcv-card-pad rcv-rise"
            style={{ '--i': 4, gap: 16 } as CSSProperties}
            aria-labelledby="rcv-usual"
          >
            <div className="rcv-card-head">
              <h2 id="rcv-usual" className="rcv-label rcv-label--strong">
                {Object.keys(usual).length ? 'Compared with usual' : 'Time in each stage'}
              </h2>
              {Object.keys(usual).length > 0 && (
                <span className="rcv-legend">
                  <span>
                    <i
                      style={{
                        width: 14,
                        borderRadius: 3,
                        border: '1.5px dashed var(--border-strong)',
                        background: 'none'
                      }}
                    />
                    usual
                  </span>
                </span>
              )}
            </div>
            {stageRows.map((s, i) => {
              const seconds = totals[s]!
              const range = usual[s]
              const max = stageMax
              return (
                <div className="rcv-stage-row" key={s}>
                  <span>
                    <i style={{ background: STAGE_COLOR[s] }} aria-hidden="true" />
                    {STAGE_NAMES[s]}
                  </span>
                  <span
                    className="rcv-stage-track"
                    role="img"
                    aria-label={`${STAGE_NAMES[s]} ${hm(seconds)}${range ? `, usual ${hm(range[0])} to ${hm(range[1])}` : ''}`}
                  >
                    {range && (
                      <span
                        style={{
                          left: `${(range[0] / max) * 100}%`,
                          width: `${((range[1] - range[0]) / max) * 100}%`
                        }}
                      />
                    )}
                    <i
                      style={
                        {
                          width: `${(seconds / max) * 100}%`,
                          background: STAGE_COLOR[s],
                          '--i': i
                        } as CSSProperties
                      }
                    />
                  </span>
                  <span
                    className="rcv-mono"
                    style={{ fontSize: 13, minWidth: 56, textAlign: 'right' }}
                  >
                    {hm(seconds)}
                  </span>
                </div>
              )
            })}
          </section>
        )}
        <section
          className="rcv-card rcv-card-pad rcv-rise"
          style={{ '--i': 5 } as CSSProperties}
          aria-labelledby="rcv-overnight"
        >
          <h2 id="rcv-overnight" className="rcv-label rcv-label--strong">
            Overnight
          </h2>
          {stats.length > 0 && (
            <div className="rcv-stats">
              {stats.map((s) => (
                <div className="rcv-stat" key={s.label}>
                  <span className="rcv-label">{s.label}</span>
                  <b>
                    {s.value}
                    <small>{s.unit}</small>
                  </b>
                  {s.note && <span>{s.note}</span>}
                </div>
              ))}
            </div>
          )}
          {sleep.overnight_hrv == null && (
            <p className="rcv-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
              No overnight HRV was imported for this night.
              {latestHrv &&
                ` Latest: ${latestHrv.overnight_hrv} ms on ${dateLabel(latestHrv.wake_date)}.`}{' '}
              <Link
                className="rcv-link"
                href="/profile/settings#health-import"
                style={{ fontSize: 13 }}
              >
                Import sleep
              </Link>
            </p>
          )}
        </section>
        <Rhythm data={data} date={date} sleep={sleep} />
        {naps.length > 0 && (
          <section className="rcv-card rcv-card-pad">
            <h2 className="rcv-label rcv-label--strong">
              {naps.length} nap{naps.length === 1 ? '' : 's'}
            </h2>
            {naps.map((nap) => (
              <p key={nap.provider_id} style={{ fontSize: 14 }}>
                <b className="rcv-mono" style={{ fontWeight: 500 }}>
                  {hm(nap.duration_seconds)}
                </b>{' '}
                <span className="rcv-muted">
                  · {clockLabel(nap.start_at, nap.timezone)} –{' '}
                  {clockLabel(nap.end_at, nap.timezone)}
                </span>
              </p>
            ))}
          </section>
        )}
        <p className="rcv-source">{sleepSourcesNote(sleep)}</p>
        <CoachButton
          className="rcv-coach--mobile"
          label="Ask Coach about this night"
          draft={`Explain my sleep for the night ending ${date}: duration, stages, timing and overnight HRV compared with my usual, and what it means for training today.`}
        />
      </div>
    </div>
  )
}
