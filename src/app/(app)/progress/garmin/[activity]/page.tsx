import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { list, number, object } from '@/lib/health/garmin/normalize'
import { duration, dateLabel } from '@/lib/health/model'
import { GarminActivityMatch } from '@/components/health/GarminActivityMatch'
import { garminPersonalConfig } from '@/lib/health/garmin/config'
import { GarminActivityCharts } from '@/components/health/GarminActivityCharts'
import '@/components/health/health.css'

export const metadata = { title: 'Garmin activity · GRIND' }

export default async function GarminActivityPage({ params }: { params: Promise<{ activity: string }> }) {
  const { activity } = await params
  if (!/^\d{1,16}$/.test(activity)) notFound()
  const user = await getAuthUser()
  if (!user) redirect('/login')
  if ((await cookies()).get('grind_demo_mode_pref')?.value === 'on') notFound()
  const db = await createClient()
  const { data, error } = await db.from('garmin_personal_activities')
    .select('local_date,name,activity_type,started_at,details,route,match_status,matched_session_id')
    .eq('user_id', user.id).eq('provider_id', activity).maybeSingle()
  if (error || !data) notFound()
  const canMatch = /^(strength_training|strength|resistance_training)$/.test(data.activity_type) &&
    garminPersonalConfig()?.userId === user.id
  const candidates = canMatch ? await db.from('sessions').select('id, day_type, started_at')
    .eq('user_id', user.id).eq('local_date', data.local_date).not('completed_at', 'is', null).order('started_at').limit(24) : null
  const d = object(data.details)
  const seconds = number(d.duration_seconds)
  const values = [
    ['Distance', number(d.distance_m), 'm'], ['Climb', number(d.ascent_m), 'm'],
    ['Average HR', number(d.average_hr), 'bpm'], ['Peak HR', number(d.max_hr), 'bpm'],
    ['Energy', number(d.calories), 'kcal'], ['Steps', number(d.steps), ''],
    ['Sets', number(d.sets), ''], ['Reps', number(d.reps), ''],
    ['Aerobic effect', number(d.aerobic_effect), ''], ['Anaerobic effect', number(d.anaerobic_effect), ''],
    ['Training load', number(d.activityTrainingLoad), ''], ['Average speed', number(d.averageSpeed), 'm/s'],
    ['Max speed', number(d.maxSpeed), 'm/s'], ['Average power', number(d.averagePower), 'W']
  ] as const
  const laps = list(d.fit_laps).length ? list(d.fit_laps) : list(d.splits)
  const sets = list(d.fit_sets).map(object)
  const steps = list(d.workout_steps).map(object)
  const zoneTimes = list(d.zone_seconds)
  return (
    <section className="page health-page">
      <Link className="health-text-button" href="/progress/garmin">Back to Garmin activities</Link>
      <h1>{data.name}</h1>
      <p className="health-muted">Garmin Connect · {dateLabel(data.local_date)}{seconds == null ? '' : ' · ' + duration(seconds)}</p>
      {data.matched_session_id && <p>Linked to your GRIND workout.</p>}
      {canMatch && candidates?.data?.length ? (
        <GarminActivityMatch key={activity + ':' + (data.matched_session_id ?? '')} activity={activity}
          selected={data.matched_session_id} sessions={candidates.data} />
      ) : null}
      <section className="health-panel">
        <h2>Activity summary</h2>
        <dl className="health-range garmin-detail-grid">
          {values.map(([name, value, unit]) => value != null && <div key={name}><dt>{name}</dt><dd>{value.toLocaleString()} {unit}</dd></div>)}
        </dl>
        {zoneTimes.some(v => typeof v === 'number') &&
          <dl className="health-range garmin-detail-grid">{zoneTimes.map((time, i) => typeof time === 'number' &&
            <div key={i}><dt>Zone {i + 1}</dt><dd>{duration(time)}</dd></div>)}</dl>}
      </section>
      <GarminActivityCharts trace={list(d.trace)} route={list(data.route)} />
      {laps.length > 0 && <section className="health-panel"><h2>Laps and splits</h2>
        <ol className="health-coverage">{laps.map((row, i) => {
          const lap = object(row)
          const time = number(lap.duration_seconds ?? lap.duration), m = number(lap.distance_m ?? lap.distance)
          const hr = number(lap.average_hr ?? lap.averageHR)
          return <li key={i}>{[time != null && duration(time), m != null && Math.round(m) + ' m',
            hr != null && Math.round(hr) + ' bpm'].filter(Boolean).join(' · ') || 'Summary unavailable'}</li>
        })}</ol>
      </section>}
      {(steps.length > 0 || sets.length > 0) && <section className="health-panel"><h2>Strength recording</h2>
        {sets.length > 0 && <ol className="health-coverage">{sets.map((set, i) =>
          <li key={i}>{[list(set.category).join(' / '), typeof set.reps === 'number' && set.reps + ' reps',
            typeof set.weight_kg === 'number' && set.weight_kg + ' kg'].filter(Boolean).join(' · ') || 'Unclassified set'}</li>)}</ol>}
        {steps.length > 0 && <details><summary>Garmin workout steps</summary><ul className="health-coverage">
          {steps.map((step, i) => <li key={i}>{String(step.exercise ?? step.category ?? 'Step')}</li>)}
        </ul></details>}
      </section>}
    </section>
  )
}
