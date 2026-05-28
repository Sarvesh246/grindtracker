import BottomNav from '@/components/BottomNav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: '#0f0f0f',
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
      <BottomNav />
    </div>
  )
}
