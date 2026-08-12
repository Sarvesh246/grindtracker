import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LeaderboardClient from './LeaderboardClient'

export default async function LeaderboardPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  return <LeaderboardClient userId={user.id} />
}
