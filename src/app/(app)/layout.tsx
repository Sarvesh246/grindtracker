import { Suspense } from 'react'
import { cookies } from 'next/headers'
import BottomNav from '@/components/BottomNav'
import TopNav from '@/components/TopNav'
import { UnitProvider } from '@/lib/contexts/UnitContext'
import { ToastProvider } from '@/lib/contexts/ToastContext'
import { OnboardingProvider } from '@/lib/contexts/OnboardingContext'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const pref = (await cookies()).get('grind_unit_pref')?.value
  // Default imperial when no cookie — weights are stored canonically in lbs.
  const initialUnit = pref === 'imperial' || pref === 'metric' ? pref : 'imperial'

  // Onboarding state is scoped per user (localStorage key grind_onboarding_{id}).
  // Every (app) route is already behind the auth proxy, so a user is expected;
  // fall back to an anonymous bucket rather than crashing if one isn't resolved.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const onboardingUserId = user?.id ?? 'anon'

  return (
    <UnitProvider initialUnit={initialUnit}>
    <OnboardingProvider userId={onboardingUserId}>
    <ToastProvider>
    {/* Fixed, non-scrolling app shell. Only .app-main scrolls; the bottom nav is
        a flow child pinned at the bottom by layout (never position:fixed), so it
        can't strand. See .app-shell in globals.css. */}
    <div className="app-shell">
      {/* Top nav (desktop) and bottom nav (mobile) are both rendered; CSS at the
          768px breakpoint shows exactly one — no JS width detection. */}
      <TopNav />
      <main className="app-main">
        {children}
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
