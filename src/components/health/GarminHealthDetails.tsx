'use client'

import { useState } from 'react'
import { garminTrends } from '@/lib/health/garmin/queries'
import { list, number, object } from '@/lib/health/garmin/normalize'
import { dateLabel, shiftDate } from '@/lib/health/model'
import type { HealthSummary } from '@/lib/health/queries'
import { SeriesPlot } from './HealthCharts'
import { formatSyncTime } from '@/lib/utils/formatting'

const selectedMetrics = [
  ['next_sleep_need_minutes', 'Next sleep need', 'min'], ['sleep_stress', 'Overnight stress', ''],
  ['hydration_goal_ml', 'Hydration goal', 'mL'], ['stress_max', 'Peak stress', ''],
  ['min_hr', 'Lowest heart rate', 'bpm'], ['max_hr', 'Highest heart rate', 'bpm'],
  ['bmi', 'BMI', ''], ['bodyFat', 'Body fat', '%'], ['bodyWater', 'Body water', '%']
] as const

export function GarminHealthDetails({ data, date }: { data: HealthSummary['garmin']; date: string }) {
  const [range, setRange] = useState(28)
  const [selected, setSelected] = useState('')
  const [picked, setPicked] = useState<{ key: string; index: number } | null>(null)
  const available = garminTrends.filter(([key]) => data.history.some(r => typeof r[key] === 'number'))
  const metric = available.find(([key]) => key === selected) ?? available[0]
  const dates = Array.from({ length: range }, (_, i) => shiftDate(date, i + 1 - range))
  const days = new Map(data.history.map(r => [r.local_date, r]))
  const values = dates.map(d => metric ? number(days.get(d)?.[metric[0]]) : null)
  const pickKey = [date, metric?.[0], range].join(':')
  const latest = values.findLastIndex(v => v != null)
  const index = picked?.key === pickKey ? picked.index : Math.max(0, latest)
  const day = object(data.selected)
  const oxygen = number(days.get(date)?.sleep_spo2, 50, 100)
  const measurements = selectedMetrics.flatMap(([k, name, unit]) => {
    const v = number(day[k])
    return v == null ? [] : [{ k, name, unit, v }]
  })
  const meals = list(object(day.food).meals).map(object)
  const totals = Object.entries(object(object(day.food).totals)).filter(([, v]) => typeof v === 'number')
  const cycle = object(day.cycle)
  const zones = list(day.hr_zones).map(object)
  const events = list(day.wellness_activities).map(object)
  if (!Object.keys(day).length && !metric) return null
  const hrv = list(day.hrv_trace).flatMap(v => Array.isArray(v) && typeof v[1] === 'number' ? [v[1]] : [])

  return (
    <section className="health-panel" aria-label="Garmin Connect measurements">
      <h3>Garmin Connect</h3>
      {typeof day.day_end === 'string' && <p className="health-muted">Daily measurements through {formatSyncTime(day.day_end)}</p>}
      {metric && (
        <>
          <label className="garmin-trend-select">Measurement
            <select value={metric[0]} onChange={e => setSelected(e.target.value)}>
              {available.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
            </select>
          </label>
          <div className="health-segment" role="group" aria-label="Garmin trend window">
            {[7, 28, 90].map(n => <button type="button" key={n} aria-pressed={n === range} onClick={() => setRange(n)}>{n}D</button>)}
          </div>
          <p className="health-muted">{dateLabel(dates[index])} · {values[index] == null ? 'No reading' : values[index]?.toLocaleString() + ' ' + metric[2]}</p>
          {latest >= 0 && <SeriesPlot values={values} label={metric[1]} selected={index}
            onSelect={i => setPicked({ key: pickKey, index: i })} band={null} />}
          <p className="health-coverage">{values.filter(v => v != null).length}/{range} days with readings</p>
        </>
      )}
      {(measurements.length > 0 || oxygen != null || typeof day.hrv_status === 'string') && (
        <details>
          <summary>Measurements for {dateLabel(date)}</summary>
          <dl className="health-range garmin-detail-grid">
            {measurements.map(({ k, name, unit, v }) => <div key={k}><dt>{name}</dt><dd>{v.toLocaleString()} {unit}</dd></div>)}
            {oxygen != null && <div><dt>Overnight oxygen</dt><dd>{oxygen}%</dd></div>}
            {typeof day.hrv_status === 'string' && <div><dt>Garmin HRV status</dt><dd>{day.hrv_status.toLowerCase().replaceAll('_', ' ')}</dd></div>}
            {typeof day.hrv_baseline_low === 'number' && typeof day.hrv_baseline_high === 'number' &&
              <div><dt>Garmin HRV baseline</dt><dd>{day.hrv_baseline_low}–{day.hrv_baseline_high} ms</dd></div>}
            {typeof day.sleep_alignment === 'string' && <div><dt>Sleep alignment</dt><dd>{day.sleep_alignment}</dd></div>}
          </dl>
          {hrv.length > 0 && (
            <details><summary>Overnight HRV samples ({hrv.length})</summary>
              <SeriesPlot values={hrv} label="Overnight HRV samples" selected={null} band={null} />
            </details>
          )}
        </details>
      )}
      {zones.length > 0 && <details><summary>Garmin heart-rate zones</summary><ul className="health-coverage">
        {zones.map((zone, i) => <li key={i}>{String(zone.sport ?? 'Default')} · {Array.from({ length: 5 }, (_, n) => zone['zone' + (n + 1) + 'Floor'])
          .filter(v => typeof v === 'number').join(' / ')} bpm</li>)}
      </ul></details>}
      {events.length > 0 && <details><summary>Wellness activities</summary><ul className="health-coverage">
        {events.map((event, i) => <li key={i}>{String(event.type ?? 'Activity')} · {
          typeof event.start === 'string' ? new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
        }</li>)}
      </ul></details>}
      {(totals.length > 0 || meals.length > 0) && <details><summary>Private food logs</summary>
        <dl className="health-range garmin-detail-grid">{totals.map(([key, value]) =>
          <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>
        <ul className="health-coverage">{meals.map((m, i) => <li key={i}>
          {String(m.name ?? 'Meal')}{list(m.foods).length ? ' · ' + list(m.foods).join(', ') : ''}
        </li>)}</ul>
      </details>}
      {Object.keys(cycle).length > 0 && <details><summary>Private cycle or pregnancy data</summary>
        <dl className="health-range garmin-detail-grid">{Object.entries(cycle).map(([key, value]) =>
          <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></div>)}</dl>
      </details>}
    </section>
  )
}
