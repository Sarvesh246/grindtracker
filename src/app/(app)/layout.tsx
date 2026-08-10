import { Suspense } from 'react'
import { cookies } from 'next/headers'
import BottomNav from '@/components/BottomNav'
import TopNav from '@/components/TopNav'
import SwipeNavigator from '@/components/SwipeNavigator'
import HapticsSetup from '@/components/HapticsSetup'
import { UnitProvider } from '@/lib/contexts/UnitContext'
import { ToastProvider } from '@/lib/contexts/ToastContext'
import { OnboardingProvider, type OnboardingState } from '@/lib/contexts/OnboardingContext'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const pref = (await cookies()).get('grind_unit_pref')?.value
  // Default imperial when no cookie — weights are stored canonically in lbs.
  const initialUnit = pref === 'imperial' || pref === 'metric' ? pref : 'imperial'

  // Onboarding state is scoped per user and server-authoritative (columns on
  // user_profiles, see migration 22). Every (app) route is already behind the
  // auth proxy, so a user is expected; fall back to an anonymous bucket
  // (never persisted) rather than crashing if one isn't resolved.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const onboardingUserId = user?.id ?? 'anon'
  let onboardingInitial: OnboardingState = { toursSeen: [], tooltipsSeen: [], skipAll: false, tooltipsSkipped: false }
  if (user) {
    const { data: onboardingRow } = await supabase
      .from('user_profiles')
      .select('onboarding_tours_seen, onboarding_tooltips_seen, onboarding_skip_all, onboarding_tooltips_skipped')
      .eq('id', user.id)
      .maybeSingle()
    if (onboardingRow) {
      onboardingInitial = {
        toursSeen: onboardingRow.onboarding_tours_seen ?? [],
        tooltipsSeen: onboardingRow.onboarding_tooltips_seen ?? [],
        skipAll: onboardingRow.onboarding_skip_all ?? false,
        tooltipsSkipped: onboardingRow.onboarding_tooltips_skipped ?? false,
      }
    }
  }

  return (
    <UnitProvider initialUnit={initialUnit}>
    <OnboardingProvider userId={onboardingUserId} initialState={onboardingInitial}>
    <ToastProvider>
    <HapticsSetup />
    {/* Fixed, non-scrolling app shell. Only .app-main scrolls; the bottom nav is
        a flow child pinned at the bottom by layout (never position:fixed), so it
        can't strand. See .app-shell in globals.css. */}
    <div className="app-shell">
      {/* Top nav (desktop) and bottom nav (mobile) are both rendered; CSS at the
          768px breakpoint shows exactly one — no JS width detection. */}
      <TopNav />
      <main className="app-main">
        <Suspense fallback={children}>
          <SwipeNavigator>{children}</SwipeNavigator>
        </Suspense>
      </main>
      <Suspense fallback={null}>
        <BottomNav />
      </Suspense>
    </div>
    </ToastProvider>
    </OnboardingProvider>
    </UnitProvider>
  )
}
