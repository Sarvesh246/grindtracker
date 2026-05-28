import { Suspense } from 'react'
import BottomNav from '@/components/BottomNav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
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
  )
}
