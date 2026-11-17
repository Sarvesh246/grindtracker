'use client'
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  clockLabel,
  duration,
  seriesStats,
  stageSeconds,
  STAGE_NAMES,
  STAGE_ORDER,
  type DayAnnotation,
  type Envelope,
  type SleepSession
} from '@/lib/health/model'

const STAGES = STAGE_ORDER
const names = STAGE_NAMES

type Point = { i: number; v: number }
/** Contiguous runs of readings. A null always breaks the run: gaps stay gaps. */
function segments(values: (number | null)[]): Point[][] {
  const out: Point[][] = []
  let run: Point[] = []
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      if (run.length) out.push(run)
      run = []
    } else run.push({ i, v })
  })
  if (run.length) out.push(run)
  return out
}
type Ribbon = { i: number; low: number; high: number }
/** Contiguous buckets where both ends of the usual range exist. */
function ribbons(env: Envelope): Ribbon[][] {
  const out: Ribbon[][] = []
  let run: Ribbon[] = []
  env.low.forEach((low, i) => {
    const high = env.high[i]
    if (low == null || high == null) {
      if (run.length) out.push(run)
      run = []
    } else run.push({ i, low, high })
  })
  if (run.length) out.push(run)
  return out.filter((r) => r.length > 1)
}
const cleanId = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '')
const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0)

/** Seconds per stage as a proportional bar plus a legend you can read without colour. */
export function StageBreakdown({ sleep }: { sleep: SleepSession }) {
  const secs = stageSeconds(sleep)
  const total = STAGES.reduce((n, s) => n + (secs[s] ?? 0), 0)
  if (total <= 0) return null
  return (
    <div className="health-breakdown">
      <div
        className="health-breakdown-bar"
        role="img"
        aria-label={`Sleep composition: ${STAGES.filter((s) => secs[s] != null)
          .map((s) => `${names[s]} ${duration(secs[s] ?? 0)}`)
          .join(', ')}`}
      >
        {STAGES.map((s) =>
          secs[s] ? (
            <span
              key={s}
              className={`health-stage-${s}`}
              style={{ flexGrow: secs[s] ?? 0 }}
              title={`${names[s]} ${duration(secs[s] ?? 0)}`}
            />
          ) : null
        )}
      </div>
      <dl className="health-legend">
        {STAGES.map((s) => (
          <div key={s}>
            <dt>
              <i className={`health-stage-${s}`} aria-hidden="true" />
              {names[s]}
            </dt>
            <dd>
              <strong>{secs[s] == null ? '—' : duration(secs[s] ?? 0)}</strong>
              {secs[s] != null && <small>{pct(secs[s] ?? 0, total)}%</small>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

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
  if (!stages.length)
    return (
      <p className="health-muted">
        {sleep.stage_totals
          ? 'Stage totals were supplied by the wearable; interval timing is unavailable.'
          : 'Stage intervals weren’t supplied for this sleep.'}
      </p>
    )
  const middle = new Date(start + span / 2).toISOString()
  return (
    <div data-swipe-ignore>
      <div className="health-chart-reading" aria-live="off">
        {interval ? (
          <>
            <i className={`health-stage-${interval.stage}`} aria-hidden="true" />
            <strong>{names[interval.stage]}</strong>
            <span>
              {clockLabel(interval.start, sleep.timezone)} –{' '}
              {clockLabel(interval.end, sleep.timezone)}
            </span>
            <b>{duration((Date.parse(interval.end) - Date.parse(interval.start)) / 1000)}</b>
          </>
        ) : (
          <span className="health-muted">No stage reading here · drag across the night</span>
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
          {[25, 50, 75].map((x) => (
            <div key={x} className="health-stage-tick" style={{ left: `${x}%` }} />
          ))}
          {stages.map((s, i) => (
            <span
              key={`${s.start}-${i}`}
              className={`health-stage-mark health-stage-${s.stage}`}
              data-selected={selected === i}
              style={{
                left: `${((Date.parse(s.start) - start) / span) * 100}%`,
                width: `${((Date.parse(s.end) - Date.parse(s.start)) / span) * 100}%`,
                top: `${STAGES.indexOf(s.stage) * 25 + 4}%`
              }}
            />
          ))}
        </div>
      </div>
      <div className="health-axis health-axis-3 health-axis-stage">
        <span>{clockLabel(sleep.start_at, sleep.timezone)}</span>
        <span>{clockLabel(middle, sleep.timezone)}</span>
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

/** Tiny trend line for a tile. Decorative: the value and its words carry the meaning. */
export function Sparkline({ values }: { values: (number | null)[] }) {
  const id = cleanId(useId())
  const W = 100,
    H = 34,
    P = 3
  const stats = seriesStats(values)
  if (!stats) return <div className="health-spark health-spark-empty" aria-hidden="true" />
  const flat = stats.max === stats.min
  const x = (i: number) => P + (i / Math.max(1, values.length - 1)) * (W - 2 * P)
  const y = (v: number) =>
    flat ? H / 2 : H - P - ((v - stats.min) / (stats.max - stats.min)) * (H - 2 * P)
  const segs = segments(values)
  const last = segs.at(-1)?.at(-1)
  return (
    <svg className="health-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <linearGradient id={`spark${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--accent-text)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--accent-text)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {segs.map((seg, n) =>
        seg.length > 1 ? (
          <g key={n}>
            <path
              d={`M${x(seg[0].i)},${H} ${seg.map((p) => `L${x(p.i)},${y(p.v)}`).join(' ')} L${x(seg.at(-1)!.i)},${H}Z`}
              fill={`url(#spark${id})`}
            />
            <path
              d={seg.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)},${y(p.v)}`).join(' ')}
              className="health-spark-line"
            />
          </g>
        ) : (
          <circle key={n} cx={x(seg[0].i)} cy={y(seg[0].v)} r={1.6} className="health-spark-dot" />
        )
      )}
      {last && <circle cx={x(last.i)} cy={y(last.v)} r={2.4} className="health-spark-dot" />}
    </svg>
  )
}

const W = 360,
  H = 150,
  PX = 8,
  PT = 12,
  PB = 12

function capture(e: PointerEvent<HTMLElement>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    /* capture is an enhancement only */
  }
}

/** Straight segments; nulls break the path rather than bridge missing readings. */
export function SeriesPlot({
  values,
  label,
  maximum,
  selected = null,
  onSelect,
  band = null,
  tone = 'accent',
  marks = [],
  envelope = null
}: {
  values: (number | null)[]
  label: string
  maximum?: number
  selected?: number | null
  onSelect?: (index: number) => void
  /** A personal "usual" range, drawn as a quiet band behind the line. */
  band?: { low: number; high: number } | null
  tone?: 'accent' | 'stress'
  /** Intervals of the day (bucket indices) drawn quietly behind the line. */
  marks?: { from: number; to: number; kind: 'workout' | 'sleep' }[]
  /** The usual range at each point (same length as values), drawn as a soft ribbon. */
  envelope?: Envelope | null
}) {
  const id = cleanId(useId())
  const stats = seriesStats(values)
  let lo = 0
  let hi = maximum ?? 1
  if (maximum == null && stats) {
    const mn = Math.min(stats.min, band?.low ?? Infinity)
    const mx = Math.max(stats.max, band?.high ?? -Infinity)
    const pad = Math.max((mx - mn) * 0.25, Math.abs(mx) * 0.03, 1)
    lo = Math.max(0, Math.floor(mn - pad))
    hi = Math.ceil(mx + pad)
  }
  if (hi <= lo) hi = lo + 1
  const n = values.length
  const x = (i: number) => (n <= 1 ? W / 2 : PX + (i / (n - 1)) * (W - 2 * PX))
  const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB)
  const segs = segments(values)
  const small = n <= 32
  const ticks = [lo, (lo + hi) / 2, hi]
  const gesture = useRef<{ x: number; y: number; dragging: boolean } | null>(null)
  const choose = (e: PointerEvent<HTMLDivElement>) => {
    if (!onSelect) return
    const rect = e.currentTarget.getBoundingClientRect()
    const fx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onSelect(Math.round(Math.max(0, Math.min(1, (fx * W - PX) / (W - 2 * PX))) * (n - 1)))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onSelect || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    e.preventDefault()
    onSelect(Math.max(0, Math.min(n - 1, (selected ?? n - 1) + (e.key === 'ArrowRight' ? 1 : -1))))
  }
  const selectedValue = selected != null ? values[selected] : null
  return (
    <div
      className={`health-plot health-plot-${tone}`}
      data-interactive={onSelect ? 'true' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      role={onSelect ? 'group' : undefined}
      aria-label={
        onSelect ? `${label} chart. Use left and right arrow keys to read values.` : undefined
      }
      onKeyDown={onKey}
      data-swipe-ignore
      onPointerDown={(e) => {
        if (!onSelect) return
        // A tap reads that point at once; a horizontal drag keeps scrubbing; a
        // vertical drag is left to the page so scrolling over a chart still works.
        gesture.current = { x: e.clientX, y: e.clientY, dragging: e.pointerType === 'mouse' }
        if (e.pointerType === 'mouse') capture(e)
        choose(e)
      }}
      onPointerMove={(e) => {
        const g = gesture.current
        if (!onSelect) return
        if (!g) {
          if (e.pointerType === 'mouse') choose(e)
          return
        }
        const dx = Math.abs(e.clientX - g.x),
          dy = Math.abs(e.clientY - g.y)
        if (!g.dragging) {
          if (dy > 8 && dy > dx) {
            gesture.current = null
            return
          }
          if (dx <= 4) return
          g.dragging = true
          capture(e)
        }
        choose(e)
      }}
      onPointerUp={() => {
        gesture.current = null
      }}
      onPointerCancel={() => {
        gesture.current = null
      }}
    >
      {ticks.map((t, k) => (
        <span
          key={k}
          className="health-ytick"
          aria-hidden="true"
          style={{ top: `${(y(t) / H) * 100}%` }}
        >
          {Math.round(t)}
        </span>
      ))}
      <svg
        className="health-series"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}. Scale ${Math.round(lo)} to ${Math.round(hi)}. ${stats?.count ?? 0} readings; missing readings remain blank.`}
      >
        <defs>
          <linearGradient id={`area${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.32" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t, k) => (
          <line key={k} x1={PX} x2={W - PX} y1={y(t)} y2={y(t)} className="health-gridline" />
        ))}
        {band && (
          <rect
            x={PX}
            width={W - 2 * PX}
            y={y(Math.min(hi, band.high))}
            height={Math.max(2, y(Math.max(lo, band.low)) - y(Math.min(hi, band.high)))}
            rx={4}
            className="health-band"
          />
        )}
        {envelope &&
          ribbons(envelope).map((run, k) => (
            <path
              key={k}
              className="health-envelope"
              d={`${run.map((p, j) => `${j ? 'L' : 'M'}${x(p.i)},${y(p.high)}`).join(' ')} ${[
                ...run
              ]
                .reverse()
                .map((p) => `L${x(p.i)},${y(p.low)}`)
                .join(' ')}Z`}
            />
          ))}
        {marks.map((m, k) => (
          <rect
            key={k}
            x={x(m.from)}
            width={Math.max(3, x(m.to + 1) - x(m.from))}
            y={PT}
            height={H - PT - PB}
            rx={3}
            className={`health-mark health-mark-${m.kind}`}
          />
        ))}
        {segs.map((seg, k) =>
          seg.length > 1 ? (
            <g key={k}>
              <path
                d={`M${x(seg[0].i)},${H - PB} ${seg.map((p) => `L${x(p.i)},${y(p.v)}`).join(' ')} L${x(seg.at(-1)!.i)},${H - PB}Z`}
                fill={`url(#area${id})`}
              />
              <path
                d={seg.map((p, j) => `${j ? 'L' : 'M'}${x(p.i)},${y(p.v)}`).join(' ')}
                className="health-line"
              />
            </g>
          ) : null
        )}
        {values.map((v, i) =>
          v == null ? null : small || segs.some((s) => s.length === 1 && s[0].i === i) ? (
            <circle key={i} cx={x(i)} cy={y(v)} r={small ? 3 : 2} className="health-point" />
          ) : null
        )}
        {selected != null && (
          <line
            x1={x(selected)}
            x2={x(selected)}
            y1={PT - 4}
            y2={H - PB + 4}
            className="health-cursor"
          />
        )}
        {selected != null && selectedValue != null && (
          <>
            <circle cx={x(selected)} cy={y(selectedValue)} r={8} className="health-halo" />
            <circle cx={x(selected)} cy={y(selectedValue)} r={4.5} className="health-focus" />
          </>
        )}
      </svg>
    </div>
  )
}

export function DailyHealthTimeline({
  bb,
  stress,
  date,
  today,
  summary,
  annotations = [],
  usual
}: {
  bb: (number | null)[]
  stress: (number | null)[]
  date: string
  today: string
  summary?: {
    high: number | null
    low: number | null
    latest: number | null
    stress: number | null
  }
  annotations?: DayAnnotation[]
  /** Previous days' usual shape, per metric. */
  usual?: { bb: Envelope | null; stress: Envelope | null }
}) {
  const [picked, setPicked] = useState<number | null>(null)
  const limit =
    date === today ? Math.floor((new Date().getHours() * 60 + new Date().getMinutes()) / 15) : 95
  const observed = (values: (number | null)[]) =>
    Array.from({ length: 96 }, (_, i) => (i <= limit ? (values[i] ?? null) : null))
  const energy = observed(bb),
    strain = observed(stress)
  const time = (i: number) =>
    `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`
  const count = energy.filter((v) => v != null).length
  const latestIndex = Math.max(
    0,
    ...energy.flatMap((v, i) => (v != null || strain[i] != null ? [i] : []))
  )
  const selected = Math.min(picked ?? latestIndex, limit)
  const setSelected = (i: number) => setPicked(i)
  const chips = summary
    ? (
        [
          ['High', summary.high],
          ['Low', summary.low],
          ['Latest', summary.latest],
          ['Avg stress', summary.stress]
        ] as const
      ).filter(([, v]) => v != null)
    : []
  return (
    <div data-swipe-ignore>
      {chips.length > 0 && (
        <div className="health-chips">
          {chips.map(([k, v]) => (
            <span key={k}>
              {k}
              <strong>{v}</strong>
            </span>
          ))}
        </div>
      )}
      <div className="health-chart-reading">
        <strong>{time(selected)}</strong>
        <span>
          <i className="health-dot-energy" aria-hidden="true" />
          Energy <b>{energy[selected] ?? 'no reading'}</b>
          {usual?.bb?.low[selected] != null && usual.bb.high[selected] != null && (
            <em>
              usual {Math.round(usual.bb.low[selected]!)}–{Math.round(usual.bb.high[selected]!)}
            </em>
          )}
        </span>
        <span>
          <i className="health-dot-stress" aria-hidden="true" />
          Stress <b>{strain[selected] ?? 'no reading'}</b>
          {usual?.stress?.low[selected] != null && usual.stress.high[selected] != null && (
            <em>
              usual {Math.round(usual.stress.low[selected]!)}–
              {Math.round(usual.stress.high[selected]!)}
            </em>
          )}
        </span>
      </div>
      <p className="health-eyebrow health-plot-title">Body Battery · energy estimate</p>
      <SeriesPlot
        values={energy}
        label="Body Battery"
        maximum={100}
        selected={selected}
        onSelect={setSelected}
        marks={annotations}
        envelope={usual?.bb}
      />
      <p className="health-eyebrow health-plot-title">Physiological stress</p>
      <SeriesPlot
        values={strain}
        label="Physiological stress"
        maximum={100}
        tone="stress"
        selected={selected}
        onSelect={setSelected}
        marks={annotations}
        envelope={usual?.stress}
      />
      {(annotations.length > 0 || usual?.bb || usual?.stress) && (
        <ul className="health-annotations">
          {(usual?.bb || usual?.stress) && (
            <li>
              <i className="health-mark-usual" aria-hidden="true" />
              Your usual range at this time ({usual?.bb?.days ?? usual?.stress?.days} previous days)
            </li>
          )}
          {annotations.map((a, i) => (
            <li key={i}>
              <i className={`health-mark-${a.kind}`} aria-hidden="true" />
              {a.label}
            </li>
          ))}
        </ul>
      )}
      <div className="health-axis health-axis-3 health-axis-plot">
        <span>00:00</span>
        <span>12:00</span>
        <span>23:45</span>
      </div>
      <p className="health-hint">Drag across either chart to read any moment.</p>
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
