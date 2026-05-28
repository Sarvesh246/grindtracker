export default function HomeLoading() {
  return (
    <div style={{ padding: '24px 16px', fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header skeleton */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div style={{ width: '80px', height: '28px', backgroundColor: '#2e2e2e', borderRadius: '8px' }} />
        <div style={{ width: '100px', height: '16px', backgroundColor: '#2e2e2e', borderRadius: '8px', marginTop: '6px' }} />
      </div>
      {/* Card skeletons */}
      {[120, 88, 64, 160].map((h, i) => (
        <div key={i} style={{
          width: '100%',
          height: `${h}px`,
          backgroundColor: '#1a1a1a',
          border: '1px solid #2e2e2e',
          borderRadius: '12px',
          marginBottom: '12px',
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(90deg, transparent 0%, #2e2e2e 50%, transparent 100%)',
            animation: 'shimmer 1.5s infinite',
            backgroundSize: '200% 100%',
          }} />
        </div>
      ))}
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  )
}
