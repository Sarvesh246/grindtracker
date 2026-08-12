import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LandingPage from '@/components/landing/LandingPage'

export const metadata: Metadata = {
  title: 'GRIND — Track. Progress. Dominate.',
  description:
    'Free gym tracker PWA for serious lifters. Log sets fast, keep rest-day-aware streaks, earn XP & badges, and climb a private friends leaderboard. Add to Home Screen on iOS.',
  openGraph: {
    title: 'GRIND — Track. Progress. Dominate.',
    description:
      'Log fast. Stay consistent. See progress. The gym tracker built for serious lifters — free to start.',
    type: 'website',
  },
}

export default async function RootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirect('/home')
  return <LandingPage />
}
