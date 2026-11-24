import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { number, object } from '@/lib/health/garmin/normalize'
import { duration, dateLabel } from '@/lib/health/model'
import '@/components/health/health.css'

export const metadata = { title: 'Garmin activities · GRIND' }

export default async function GarminActivitiesPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')
  if ((await cookies()).get('grind_demo_mode_pref')?.value === 'on') notFound()
  const db = await createClient()
  const { data, error } = await db.from('garmin_personal_activities')
    .select('provider_id,local_date,name,activity_type,match_status,duration:details->duration_seconds,average_hr:details->average_hr')
    .eq('user_id', user.id).order('started_at', { ascending: false }).limit(200)
  return (
    <section className="page health-page">
      <Link className="health-text-button" href="/progress">Back to Progress</Link>
      <h1>Garmin activities</h1>
      {error ? <p role="alert">Could not load Garmin activities.</p> : !data?.length ? <p>No Garmin activities have synced yet.</p> : (
        <ul className="garmin-activities">
          {data.map(entry => {
            const activity = object(entry)
            const seconds = number(activity.duration)
            const hr = number(activity.average_hr, 20, 250)
            return <li key={entry.provider_id}>
              <Link className="health-panel" href={'/progress/garmin/' + entry.provider_id}>
                <strong>{entry.name}</strong>
                <span>{dateLabel(entry.local_date)}{seconds == null ? '' : ' · ' + duration(seconds)}
                  {hr == null ? '' : ' · ' + Math.round(hr) + ' bpm'}</span>
                {entry.match_status === 'matched' && <small>Linked to your GRIND workout</small>}
                {entry.match_status === 'review' && <small>Check for a matching GRIND workout</small>}
              </Link>
            </li>
          })}
        </ul>
      )}
    </section>
  )
}
