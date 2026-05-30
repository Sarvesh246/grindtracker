import { Suspense } from 'react'
import { cookies } from 'next/headers'
import BottomNav from '@/components/BottomNav'
import TopNav from '@/components/TopNav'
import { UnitProvider } from '@/lib/contexts/UnitContext'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const pref = (await cookies()).get('grind_unit_pref')?.value
  // Default imperial when no cookie — weights are stored canonically in lbs.
  const initialUnit = pref === 'imperial' || pref === 'metric' ? pref : 'imperial'

  return (
    <UnitProvider initialUnit={initialUnit}>
    <div style={{
      backgroundColor: 'var(--bg)',
      minHeight: '100dvh',
      position: 'relative',
    }}>
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
    </UnitProvider>
  )
}
