import BottomNav from '@/components/BottomNav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ backgroundColor: '#0f0f0f', minHeight: '100dvh' }}>
      <main style={{
        height: 'calc(100dvh - 64px)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}>
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
