'use client'
import { useMemo, useState, type PointerEvent } from 'react'
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
const BUCKET_MS = 15 * 60_000

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
  const start = Date.parse(schedule.dayStartAt)
  const x = (ms: number) => Math.max(0, Math.min(96, (ms - start) / BUCKET_MS))
  const [read, setRead] = useState<number | null>(null)

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
  const showNow = nowX != null && nowX > 0 && nowX < 96

  const pick = (ev: PointerEvent<HTMLDivElement>) => {
    const box = ev.currentTarget.getBoundingClientRect()
    const i = Math.floor(((ev.clientX - box.left) / box.width) * 96)
    setRead(Math.max(0, Math.min(95, i)))
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
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e)
        }}
        onPointerUp={() => setRead(null)}
        onPointerCancel={() => setRead(null)}
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
            <small>{timeLabel(start + read * BUCKET_MS)}</small>
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
