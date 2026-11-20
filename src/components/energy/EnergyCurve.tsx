'use client'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { clockHoursFrom, instantAt } from '@/lib/energy/time'
import type { EnergySchedule } from '@/lib/energy/types'

/**
 * Predicted energy across the day: one area curve in quarter-hours, with the
 * phase windows laid under it as bands (peaks lime, dip amber, wind-down cool)
 * and sleep left empty. Drawn in bucket units with a stretched viewBox so it
 * fills any width; anything that must stay round or legible is HTML on top.
 * Read by tapping or dragging sideways; vertical drags still scroll the page.
 */

const H = 120
const PAD_TOP = 8
/** Quarter-hour buckets across the local day. */
const BUCKETS = 96

const yOf = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * (H - PAD_TOP)

function runs(series: (number | null)[]): [number, number[]][] {
  const out: [number, number[]][] = []
  let cur: number[] | null = null
  series.forEach((v, i) => {
    if (v == null) {
      cur = null
      return
    }
    if (!cur) {
      cur = []
      out.push([i, cur])
    }
    cur.push(v)
  })
  return out
}

const BAND_CLASS: Record<string, string> = {
  morning_peak: 'energy-band-peak',
  evening_peak: 'energy-band-peak',
  afternoon_dip: 'energy-band-dip',
  wind_down: 'energy-band-wind',
}

export default function EnergyCurve({
  schedule,
  now,
  timeLabel,
}: {
  schedule: EnergySchedule
  /** null until mounted, so SSR never draws a "now" from the server's clock. */
  now: number | null
  timeLabel: (ms: number) => string
}) {
  // Position by wall-clock hours in the schedule's zone, the same axis the points use.
  // Elapsed time would sit an hour off on a DST day, where the local clock skips or repeats.
  const x = (ms: number) =>
    Math.max(0, Math.min(BUCKETS, clockHoursFrom(schedule.date, new Date(ms).toISOString(), schedule.timezone) * 4))
  const [read, setRead] = useState<number | null>(null)
  const gesture = useRef<{ x: number; y: number; dragging: boolean } | null>(null)

  const { area, line } = useMemo(() => {
    let a = ''
    let l = ''
    for (const [i0, vals] of runs(schedule.curve)) {
      const pts = vals.map((v, k) => [i0 + k + 0.5, yOf(v)] as const)
      a += `M${pts[0][0]},${H} ${pts.map(([px, py]) => `L${px},${py}`).join(' ')} L${pts[pts.length - 1][0]},${H} Z `
      l += pts.map(([px, py], k) => `${k ? 'L' : 'M'}${px},${py}`).join(' ') + ' '
    }
    return { area: a, line: l }
  }, [schedule.curve])

  const bands = schedule.events
    .filter((e) => e.end && BAND_CLASS[e.kind])
    .map((e) => ({ kind: e.kind, x0: x(Date.parse(e.start)), x1: x(Date.parse(e.end!)) }))

  const nowX = now != null ? x(now) : null
  const showNow = nowX != null && nowX > 0 && nowX < BUCKETS

  const pick = (ev: PointerEvent<HTMLDivElement>) => {
    const box = ev.currentTarget.getBoundingClientRect()
    const i = Math.floor(((ev.clientX - box.left) / box.width) * BUCKETS)
    setRead(Math.max(0, Math.min(BUCKETS - 1, i)))
  }
  const reading = read != null ? schedule.curve[read] : null

  return (
    <figure className="energy-curve">
      <div
        className="energy-plot"
        data-swipe-ignore
        role="img"
        aria-label="Predicted energy through the day. The timeline below lists every phase."
        onPointerDown={(e) => {
          // A tap reads at once; a horizontal drag scrubs; a vertical drag is left to the page.
          gesture.current = { x: e.clientX, y: e.clientY, dragging: e.pointerType === 'mouse' }
          if (e.pointerType === 'mouse') e.currentTarget.setPointerCapture(e.pointerId)
          pick(e)
        }}
        onPointerMove={(e) => {
          const g = gesture.current
          if (!g) return
          if (!g.dragging) {
            const dx = Math.abs(e.clientX - g.x)
            const dy = Math.abs(e.clientY - g.y)
            if (dy > 8 && dy > dx) {
              gesture.current = null
              setRead(null)
              return
            }
            if (dx <= 4) return
            g.dragging = true
            e.currentTarget.setPointerCapture(e.pointerId)
          }
          pick(e)
        }}
        onPointerUp={() => {
          gesture.current = null
          setRead(null)
        }}
        onPointerCancel={() => {
          gesture.current = null
          setRead(null)
        }}
      >
        <svg viewBox={`0 0 96 ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="energy-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.38" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[25, 50, 75].map((g) => (
            <line key={g} x1="0" x2="96" y1={yOf(g)} y2={yOf(g)} className="energy-grid" />
          ))}
          {bands.map((b) => (
            <rect
              key={b.kind}
              x={b.x0}
              width={Math.max(0.5, b.x1 - b.x0)}
              y="0"
              height={H}
              className={BAND_CLASS[b.kind]}
            />
          ))}
          <path d={area} fill="url(#energy-fill)" />
          <path d={line} className="energy-line" vectorEffect="non-scaling-stroke" />
          {showNow && (
            <line x1={nowX} x2={nowX} y1="0" y2={H} className="energy-now-line" vectorEffect="non-scaling-stroke" />
          )}
          {read != null && (
            <line x1={read + 0.5} x2={read + 0.5} y1="0" y2={H} className="energy-cursor" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {showNow && schedule.curve[Math.floor(nowX!)] != null && (
          <span
            className="energy-now-dot"
            style={{ left: `${(nowX! / 96) * 100}%`, top: `${(yOf(schedule.curve[Math.floor(nowX!)]!) / H) * 100}%` }}
            aria-hidden="true"
          />
        )}
        {read != null && (
          <span
            className="energy-reading"
            style={{ left: `${Math.min(80, Math.max(20, ((read + 0.5) / 96) * 100))}%` }}
          >
            <b>{reading != null ? reading : 'Asleep'}</b>
            <small>{timeLabel(Date.parse(instantAt(schedule.date, read / 4, schedule.timezone)))}</small>
          </span>
        )}
      </div>
      <div className="energy-axis" aria-hidden="true">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {h === 0 || h === 24 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}
          </span>
        ))}
      </div>
      <figcaption className="energy-legend">
        <span><i className="energy-key-peak" />Peak</span>
        <span><i className="energy-key-dip" />Dip</span>
        <span><i className="energy-key-wind" />Wind-down</span>
      </figcaption>
    </figure>
  )
}
