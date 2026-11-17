'use client'
import { useRef, useState, type PointerEvent } from 'react'
import { clockLabel, duration, type SleepSession, type SleepStageName } from '@/lib/health/model'

const STAGES: SleepStageName[] = ['awake', 'rem', 'light', 'deep']
const names = { awake: 'Awake', rem: 'REM', light: 'Light', deep: 'Deep' }

export function SleepStageChart({ sleep }: { sleep: SleepSession }) {
  const stages = sleep.stages ?? []
  const [selected, setSelected] = useState(0)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const start = Date.parse(sleep.start_at)
  const span = Date.parse(sleep.end_at) - start
  const interval = stages[selected]
  function selectAt(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const at = start + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * span
    setSelected(stages.findIndex((s) => Date.parse(s.start) <= at && Date.parse(s.end) > at))
  }
  if (!stages.length) {
    if (!sleep.stage_totals)
      return <p className="health-muted">Stage intervals weren’t supplied for this sleep.</p>
    const total = Object.values(sleep.stage_totals).reduce((n, s) => n + (s ?? 0), 0)
    return (
      <div className="health-stage-totals">
        {STAGES.map((stage) => {
          const seconds = sleep.stage_totals?.[stage]
          return seconds == null ? null : (
            <div key={stage}>
              <span>{names[stage]}</span>
              <meter min={0} max={Math.max(1, total)} value={seconds}>
                {duration(seconds)}
              </meter>
              <span>{duration(seconds)}</span>
            </div>
          )
        })}
        <p className="health-muted">
          Stage totals supplied by the wearable; interval timing is unavailable.
        </p>
      </div>
    )
  }
  return (
    <div data-swipe-ignore>
      <div className="health-chart-reading" aria-live="off">
        {interval ? (
          <>
            <strong>{names[interval.stage]}</strong> · {clockLabel(interval.start, sleep.timezone)}{' '}
            – {clockLabel(interval.end, sleep.timezone)} ·{' '}
            {duration((Date.parse(interval.end) - Date.parse(interval.start)) / 1000)}
          </>
        ) : (
          'No stage reading in this interval'
        )}
      </div>
      <div className="health-stage-grid">
        <div className="health-stage-labels" aria-hidden="true">
          {STAGES.map((s) => (
            <span key={s}>{names[s]}</span>
          ))}
        </div>
        <div
          className="health-stage-plot"
          tabIndex={0}
          role="group"
          aria-label="Sleep stages. Use left and right arrow keys to select a recorded interval."
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault()
              setSelected((i) =>
                Math.max(0, Math.min(stages.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))
              )
            }
          }}
          onPointerDown={(e) => {
            origin.current = { x: e.clientX, y: e.clientY }
            selectAt(e)
          }}
          onPointerMove={(e) => {
            if (!origin.current) return
            const dx = Math.abs(e.clientX - origin.current.x),
              dy = Math.abs(e.clientY - origin.current.y)
            if (dy > 8 && dy > dx) {
              origin.current = null
              return
            }
            if (dx > 8 && dx > dy) {
              e.currentTarget.setPointerCapture(e.pointerId)
              selectAt(e)
            }
          }}
          onPointerUp={() => {
            origin.current = null
          }}
          onPointerCancel={() => {
            origin.current = null
          }}
        >
          {STAGES.map((s, i) => (
            <div key={s} className="health-stage-lane" style={{ top: `${i * 25}%` }} />
          ))}
          {stages.map((s, i) => (
            <span
              key={`${s.start}-${i}`}
              className={`health-stage-mark health-stage-${s.stage}`}
              data-selected={selected === i}
              style={{
                left: `${((Date.parse(s.start) - start) / span) * 100}%`,
                width: `${((Date.parse(s.end) - Date.parse(s.start)) / span) * 100}%`,
                top: `${STAGES.indexOf(s.stage) * 25 + 5}%`
              }}
            />
          ))}
        </div>
      </div>
      <div className="health-axis">
        <span>{clockLabel(sleep.start_at, sleep.timezone)}</span>
        <span>{clockLabel(sleep.end_at, sleep.timezone)}</span>
      </div>
      <p className="health-muted">Wearable estimates · blank intervals mean missing data.</p>
      <details>
        <summary>Read stage intervals</summary>
        <div className="health-table-wrap">
          <table>
            <caption>Recorded sleep stages ({sleep.timezone})</caption>
            <thead>
              <tr>
                <th>Stage</th>
                <th>From</th>
                <th>To</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s, i) => (
                <tr key={i}>
                  <th>{names[s.stage]}</th>
                  <td>{clockLabel(s.start, sleep.timezone)}</td>
                  <td>{clockLabel(s.end, sleep.timezone)}</td>
                  <td>{duration((Date.parse(s.end) - Date.parse(s.start)) / 1000)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

/** Straight segments; nulls break the path rather than bridge missing readings. */
export function SeriesPlot({
  values,
  label,
  maximum,
  selected = null,
  onSelect
}: {
  values: (number | null)[]
  label: string
  maximum?: number
  selected?: number | null
  onSelect?: (index: number) => void
}) {
  const present = values.filter((v): v is number => v != null)
  const hi = maximum ?? Math.max(1, ...present) * 1.1
  const lo = maximum ? 0 : Math.max(0, Math.min(...present, 0))
  const x = (i: number) => 36 + (i / Math.max(1, values.length - 1)) * 544
  const y = (v: number) => 110 - ((v - lo) / (hi - lo)) * 94
  let path = ''
  let previous = false
  values.forEach((v, i) => {
    if (v == null) {
      previous = false
      return
    }
    path += `${previous ? 'L' : 'M'}${x(i)},${y(v)} `
    previous = true
  })
  const choose = (e: PointerEvent<SVGSVGElement>) => {
    if (!onSelect) return
    const rect = e.currentTarget.getBoundingClientRect()
    onSelect(
      Math.round(
        Math.max(0, Math.min(1, (((e.clientX - rect.left) / rect.width) * 600 - 36) / 544)) *
          (values.length - 1)
      )
    )
  }
  return (
    <div className="health-series-container">
      <span className="health-ymax" aria-hidden="true">
        {Math.round(hi)}
      </span>
      <span className="health-ymin" aria-hidden="true">
        {lo}
      </span>
      <svg
        className="health-series"
        viewBox="0 0 600 132"
        role="img"
        aria-label={`${label}. Scale ${lo} to ${Math.round(hi)}. ${present.length} readings; missing readings remain blank.`}
        onPointerDown={choose}
        onPointerMove={(e) => {
          if (e.buttons) choose(e)
        }}
      >
        <path d="M36 16H580 M36 110H580" className="health-gridline" />
        <path d={path} className="health-line" />
        {values.map((v, i) =>
          v == null ? null : (
            <circle
              key={i}
              cx={x(i)}
              cy={y(v)}
              r={values.length > 32 ? 1.8 : 3.5}
              className="health-point"
            />
          )
        )}
        {selected != null && <path d={`M${x(selected)} 12V114`} className="health-cursor" />}
      </svg>
    </div>
  )
}

export function DailyHealthTimeline({
  bb,
  stress,
  date,
  today
}: {
  bb: (number | null)[]
  stress: (number | null)[]
  date: string
  today: string
}) {
  const [selected, setSelected] = useState(0)
  const limit =
    date === today ? Math.floor((new Date().getHours() * 60 + new Date().getMinutes()) / 15) : 95
  const observed = (values: (number | null)[]) =>
    Array.from({ length: 96 }, (_, i) => (i <= limit ? (values[i] ?? null) : null))
  const energy = observed(bb),
    strain = observed(stress)
  const time = (i: number) =>
    `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`
  const count = energy.filter((v) => v != null).length
  return (
    <div data-swipe-ignore>
      <p>Body Battery and physiological stress, on separate 0–100 scales.</p>
      <div className="health-chart-reading">
        {time(selected)} · Energy {energy[selected] ?? 'no reading'} · Stress{' '}
        {strain[selected] ?? 'no reading'}
      </div>
      <p className="health-eyebrow">Body Battery · energy estimate</p>
      <SeriesPlot
        values={energy}
        label="Body Battery"
        maximum={100}
        selected={selected}
        onSelect={setSelected}
      />
      <div className="health-stress">
        <p className="health-eyebrow">Physiological stress</p>
        <SeriesPlot
          values={strain}
          label="Physiological stress"
          maximum={100}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
      <div className="health-axis">
        <span>00:00</span>
        <span>12:00</span>
        <span>23:45</span>
      </div>
      <label className="health-scrubber">
        Read a time interval
        <input
          type="range"
          min={0}
          max={limit}
          value={Math.min(selected, limit)}
          onChange={(e) => setSelected(Number(e.target.value))}
        />
      </label>
      <p className="health-muted">
        {count} of 96 energy buckets recorded. Legacy 15-minute local-time buckets; exact UTC timing
        and DST coverage are unavailable. Gaps are not rest.
      </p>
      <details>
        <summary>Read daily measurements</summary>
        <div className="health-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Local time</th>
                <th>Body Battery</th>
                <th>Stress</th>
              </tr>
            </thead>
            <tbody>
              {energy.map((v, i) =>
                v == null && strain[i] == null ? null : (
                  <tr key={i}>
                    <th>{time(i)}</th>
                    <td>{v ?? 'No reading'}</td>
                    <td>{strain[i] ?? 'No reading'}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
