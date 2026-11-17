'use client'
import { BUCKETS_PER_DAY, bucketOf, type DailyBody, type DayWorkout } from '@/lib/body'

/**
 * The day as a tide: Body Battery fills from below across 96 quarter-hours,
 * stress sits underneath as a fine comb of ticks, each finished workout is a
 * lit window, and a slowly breathing dot marks now. Drawn in bucket units with
 * a stretched viewBox so it fills any width; the dot is HTML so it stays round.
 */

const TIDE_H = 108
const GAP = 10
const COMB_H = 22
const H = TIDE_H + GAP + COMB_H

function yOf(v: number): number {
  return TIDE_H - (Math.max(0, Math.min(100, v)) / 100) * (TIDE_H - 6)
}

/** Contiguous runs of readings, as [startIndex, values]. */
function runs(series: (number | null)[]): [number, number[]][] {
  const out: [number, number[]][] = []
  let cur: number[] | null = null
  series.forEach((v, i) => {
    if (v != null) {
      if (!cur) {
        cur = []
        out.push([i, cur])
      }
      cur.push(v)
    } else cur = null
  })
  return out
}

function areaPath(start: number, vals: number[]): string {
  // A single reading still gets a quarter-hour of width.
  const pts = vals.length === 1 ? [[start, vals[0]], [start + 1, vals[0]]] : vals.map((v, k) => [start + k + 0.5, v])
  const first = pts[0][0]
  const last = pts[pts.length - 1][0]
  return `M${first},${TIDE_H} ` + pts.map(([x, v]) => `L${x},${yOf(v)}`).join(' ') + ` L${last},${TIDE_H} Z`
}

function linePath(start: number, vals: number[]): string {
  const pts = vals.length === 1 ? [[start, vals[0]], [start + 1, vals[0]]] : vals.map((v, k) => [start + k + 0.5, v])
  return pts.map(([x, v], i) => `${i ? 'L' : 'M'}${x},${yOf(v)}`).join(' ')
}

export default function DayTide({
  row,
  workouts,
  isToday,
  ariaLabel,
}: {
  row: DailyBody
  workouts: DayWorkout[]
  isToday: boolean
  ariaLabel: string
}) {
  const bb = (row.bb_series ?? []).slice(0, BUCKETS_PER_DAY)
  const stress = (row.stress_series ?? []).slice(0, BUCKETS_PER_DAY)
  const tide = runs(bb)
  const hasStress = stress.some(v => v != null && v > 0)

  const now = new Date()
  const nowBucket = Math.min(BUCKETS_PER_DAY - 1, Math.floor((now.getHours() * 60 + now.getMinutes()) / 15))
  let nowValue: number | null = null
  if (isToday) {
    for (let i = nowBucket; i >= 0; i--) {
      if (bb[i] != null) { nowValue = bb[i] as number; break }
    }
    nowValue ??= row.bb_latest
  }

  const windows = workouts
    .filter(w => w.completed_at)
    .map(w => {
      const a = bucketOf(w.started_at)
      const b = Math.max(a + 1, bucketOf(w.completed_at as string) + 1)
      return { a, b }
    })

  return (
    <div role="img" aria-label={ariaLabel} style={{ position: 'relative', width: '100%' }}>
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${BUCKETS_PER_DAY} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* Workout windows sit behind the water, lit from the top edge. */}
        {windows.map(({ a, b }, i) => (
          <g key={i}>
            <rect x={a} y={0} width={b - a} height={TIDE_H} fill="var(--accent)" fillOpacity={0.12} />
            <rect x={a} y={0} width={b - a} height={3} fill="var(--accent)" />
          </g>
        ))}

        {tide.map(([start, vals]) => (
          <path key={`a${start}`} d={areaPath(start, vals)} fill="var(--accent)" fillOpacity={0.24} />
        ))}
        {tide.map(([start, vals]) => (
          <path
            key={`l${start}`}
            d={linePath(start, vals)}
            fill="none"
            stroke="var(--chart-mark)"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <line x1={0} x2={BUCKETS_PER_DAY} y1={TIDE_H} y2={TIDE_H} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />

        {/* Stress comb: one tick per quarter-hour, taller and brighter when high. */}
        {hasStress && stress.map((v, i) => {
          if (v == null || v <= 0) return null
          const h = Math.max(2, (Math.min(100, v) / 100) * COMB_H)
          return (
            <line
              key={i}
              x1={i + 0.5}
              x2={i + 0.5}
              y1={TIDE_H + GAP}
              y2={TIDE_H + GAP + h}
              stroke={v >= 60 ? 'var(--text-secondary)' : 'var(--border-strong)'}
              strokeWidth={1.5}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )
        })}

        {isToday && (
          <line
            x1={nowBucket + 0.5}
            x2={nowBucket + 0.5}
            y1={0}
            y2={H}
            stroke="var(--text-muted)"
            strokeWidth={1}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {isToday && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${((nowBucket + 0.5) / BUCKETS_PER_DAY) * 100}%`,
            top: `${nowValue != null ? yOf(nowValue) : TIDE_H}px`,
            width: 12,
            height: 12,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <span
            className="body-breathe"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '9999px',
              backgroundColor: 'var(--accent)',
              opacity: 0.45,
            }}
          />
          <span
            style={{
              position: 'absolute',
              inset: 2,
              borderRadius: '9999px',
              backgroundColor: 'var(--accent)',
              boxShadow: '0 0 0 2px var(--surface)',
            }}
          />
        </span>
      )}

      {/* Three quiet time marks, not an axis. */}
      <div aria-hidden="true" style={{ position: 'relative', height: '16px', marginTop: '6px' }}>
        {[['6a', 24], ['12p', 48], ['6p', 72]].map(([label, b]) => (
          <span
            key={label}
            style={{
              position: 'absolute',
              left: `${((b as number) / BUCKETS_PER_DAY) * 100}%`,
              transform: 'translateX(-50%)',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--text-muted)',
              letterSpacing: '0.5px',
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
