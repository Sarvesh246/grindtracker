import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { UnitProvider } from '@/lib/contexts/UnitContext'
import SetupClient from './SetupClient'
import type { SetupProfile } from '@/components/setup/steps/IdentityStep'

export default async function SetupPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [{ data: profileRow }, { data: weightRow }, { data: restRows }, { data: exerciseSample }] =
    await Promise.all([
      supabase
        .from('user_profiles')
        .select('id, username, display_name, avatar_url, setup_completed_at')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('body_weights')
        .select('weight')
        .eq('user_id', user.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('user_rest_days')
        .select('day_of_week')
        .eq('user_id', user.id),
      supabase
        .from('exercises')
        .select('id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle(),
    ])

  // Already finished and landed here by URL — home is the app.
  // Replay Setup nulls setup_completed_at first, so replay still works.
  if (profileRow?.setup_completed_at) {
    redirect('/home')
  }

  const profile: SetupProfile | null = profileRow
    ? {
        id: profileRow.id,
        username: profileRow.username,
        display_name: profileRow.display_name,
        avatar_url: profileRow.avatar_url,
        setup_completed_at: profileRow.setup_completed_at,
      }
    : null

  const unitCookie = (await cookies()).get('grind_unit_pref')?.value
  const initialUnit = unitCookie === 'metric' ? 'metric' : 'imperial'

  // Also treat day categories as an existing program (custom day-only catalogs).
  let hasExistingProgram = !!exerciseSample
  if (!hasExistingProgram) {
    const { data: catSample } = await supabase
      .from('user_day_categories')
      .select('day_key')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
    hasExistingProgram = !!catSample
  }

  return (
    <UnitProvider initialUnit={initialUnit}>
      <SetupClient
        user={user}
        initial={{
          profile,
          latestWeightLbs: weightRow?.weight ?? null,
          restDays: (restRows ?? []).map(r => r.day_of_week as number),
          hasExistingProgram,
        }}
      />
    </UnitProvider>
  )
}
