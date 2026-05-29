import { Suspense } from 'react'
import { cookies } from 'next/headers'
import BottomNav from '@/components/BottomNav'
import { UnitProvider } from '@/lib/contexts/UnitContext'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const pref = (await cookies()).get('grind_unit_pref')?.value
  const initialUnit = pref === 'imperial' || pref === 'metric' ? pref : 'metric'

  return (
    <UnitProvider initialUnit={initialUnit}>
    <div style={{
      backgroundColor: 'var(--bg)',
      minHeight: '100dvh',
      position: 'relative',
    }}>
      <main style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'calc(64px + env(safe-area-inset-bottom))',
        minHeight: '100dvh',
        overflowX: 'hidden',
      }}>
        {children}
      </main>
      <Suspense fallback={null}>
        <BottomNav />
      </Suspense>
    </div>
    </UnitProvider>
  )
}
