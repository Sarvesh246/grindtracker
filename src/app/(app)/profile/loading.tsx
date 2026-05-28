export default function ProfileLoading() {
  return (
    <div style={{ padding: '24px 16px' }}>
      <div className="shimmer" style={{ width: '100px', height: '32px', borderRadius: '8px', marginBottom: '20px' }} />
      <div style={{
        backgroundColor: '#1a1a1a', border: '1px solid #2e2e2e',
        borderRadius: '12px', padding: '16px', marginBottom: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
          <div className="shimmer" style={{ width: '56px', height: '56px', borderRadius: '9999px', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div className="shimmer" style={{ width: '140px', height: '16px', borderRadius: '6px', marginBottom: '8px' }} />
            <div className="shimmer" style={{ width: '80px', height: '14px', borderRadius: '6px' }} />
          </div>
          <div className="shimmer" style={{ width: '48px', height: '48px', borderRadius: '8px' }} />
        </div>
        <div className="shimmer" style={{ height: '8px', borderRadius: '9999px', marginBottom: '6px' }} />
        <div className="shimmer" style={{ width: '120px', height: '12px', borderRadius: '6px' }} />
      </div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {[1, 2].map(i => (
          <div key={i} className="shimmer" style={{ flex: 1, height: '110px', borderRadius: '12px' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '20px' }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="shimmer" style={{ height: '80px', borderRadius: '12px' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
        {Array.from({ length: 11 }).map((_, i) => (
          <div key={i} className="shimmer" style={{ height: '100px', borderRadius: '12px' }} />
        ))}
      </div>
    </div>
  )
}
