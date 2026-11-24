'use client'

import { useState } from 'react'
import { number, object } from '@/lib/health/garmin/normalize'
import { SeriesPlot } from './HealthCharts'

const measures = [['hr', 'Heart rate', 'bpm'], ['distance', 'Distance', 'm'], ['altitude', 'Elevation', 'm']] as const

export function GarminActivityCharts({ trace, route }: { trace: unknown[]; route: unknown[] }) {
  const [measure, setMeasure] = useState('')
  const [picked, setPicked] = useState<{ key: string; index: number }>()
  const records = trace.map(object)
  const options = measures.filter(([key]) => records.some(r => typeof r[key] === 'number'))
  const chosen = options.find(([key]) => key === measure) ?? options[0]
  const values = chosen ? records.map(r => number(r[chosen[0]], -1000)) : []
  const selection = chosen && picked?.key === chosen[0] ? picked?.index ?? 0 : 0
  const points = route.flatMap(p => Array.isArray(p) &&
    number(p[0], -90, 90) != null && number(p[1], -180, 180) != null ? [[p[0], p[1]] as [number, number]] : [])
  let path = ''
  if (points.length > 1) {
    const start = points[0][1]
    const scale = Math.cos(points[0][0] * Math.PI / 180)
    const xs = points.map(p => (((p[1] - start + 540) % 360) - 180) * scale)
    const ys = points.map(p => p[0])
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const span = Math.max((maxX - minX) / 300, (maxY - minY) / 144, 0.000001)
    path = points.map((_, i) =>
      (160 + (xs[i] - (minX + maxX) / 2) / span).toFixed(2) + ',' +
      (82 - (ys[i] - (minY + maxY) / 2) / span).toFixed(2)).join(' ')
  }
  return (
    <>
      {chosen && <section className="health-panel">
        <h2>Recorded samples</h2>
        <div className="health-segment" role="group" aria-label="Activity measurement">
          {options.map(([key, name]) => <button key={key} type="button" aria-pressed={key === chosen[0]}
            onClick={() => setMeasure(key)}>{name}</button>)}
        </div>
        <p className="health-muted">{values[selection] == null ? 'No reading at this point' :
          values[selection]?.toLocaleString() + ' ' + chosen[2]}</p>
        <SeriesPlot label={chosen[1]} values={values} selected={selection}
          onSelect={index => setPicked({ key: chosen[0], index })} />
      </section>}
      {path && <section className="health-panel">
        <h2>GPS route</h2>
        <svg className="garmin-route" viewBox="0 0 320 164" role="img" aria-label="Recorded GPS route">
          <polyline points={path} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      </section>}
    </>
  )
}
