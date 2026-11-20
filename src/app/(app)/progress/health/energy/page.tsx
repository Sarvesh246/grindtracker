import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEnergySchedule } from '@/lib/energy/server'
import { DEFAULT_NOTIFICATION_PREFS } from '@/lib/push/types'
import EnergyView from '@/components/energy/EnergyView'

export const metadata = { title: 'Energy · GRIND' }
export const dynamic = 'force-dynamic'

export default async function Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: prefs, error: prefsError } = await supabase
    .from('notification_prefs')
    .select('enabled,timezone,energy_alerts,energy_kinds,energy_lead_min')
    .eq('user_id', user.id)
    .maybeSingle()

  // A failed prefs read is not "no prefs": without it we'd show the wrong zone and
  // "Turn on notifications first" to someone who already has them on. Show the retry state.
  let loaded: Awaited<ReturnType<typeof getEnergySchedule>> | null = null
  if (!prefsError) {
    try {
      loaded = await getEnergySchedule(supabase, user.id, prefs?.timezone ?? null)
    } catch {
      loaded = null
    }
  }

  return (
    <EnergyView
      schedule={loaded?.schedule ?? null}
      failed={!!prefsError || !loaded}
      userId={user.id}
      alerts={{
        pushEnabled: prefs?.enabled ?? false,
        on: prefs?.energy_alerts ?? DEFAULT_NOTIFICATION_PREFS.energy_alerts,
        kinds: prefs?.energy_kinds ?? DEFAULT_NOTIFICATION_PREFS.energy_kinds,
        leadMin: prefs?.energy_lead_min ?? DEFAULT_NOTIFICATION_PREFS.energy_lead_min,
      }}
    />
  )
}
