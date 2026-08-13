import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { isAdminEmail } from '@/lib/utils/admin'
import SettingsView from './SettingsView'

export default async function ProfileSettingsPage() {
  const supabase = await createClient()

  const user = await getAuthUser()
  if (!user) redirect('/login')

  const { data: restDayRows } = await supabase
    .from('user_rest_days')
    .select('day_of_week')
    .eq('user_id', user.id)
    .is('effective_until', null)

  const displayName = (user.user_metadata?.full_name as string | undefined)
    ?? user.email
    ?? 'Athlete'

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('username, coach_dev_unlimited')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <SettingsView
      recurringRestDays={(restDayRows ?? []).map(r => r.day_of_week)}
      isAdmin={isAdminEmail(user.email)}
      displayName={displayName}
      username={profile?.username ?? null}
      coachDevUnlimited={profile?.coach_dev_unlimited ?? false}
    />
  )
}
