export default function ProfileLoading() {
  return (
    <div style={{ padding: '24px 16px', fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ width: '100px', height: '32px', backgroundColor: '#2e2e2e', borderRadius: '8px', marginBottom: '20px' }} />

      {/* User card */}
      <div style={{
        backgroundColor: '#1a1a1a', border: '1px solid #2e2e2e',
        borderRadius: '12px', padding: '16px', marginBottom: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '9999px', backgroundColor: '#2e2e2e', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ width: '140px', height: '16px', backgroundColor: '#2e2e2e', borderRadius: '6px', marginBottom: '8px' }} />
            <div style={{ width: '80px', height: '14px', backgroundColor: '#2e2e2e', borderRadius: '6px' }} />
          </div>
          <div style={{ width: '48px', height: '48px', backgroundColor: '#2e2e2e', borderRadius: '8px' }} />
        </div>
        <div style={{ height: '8px', backgroundColor: '#2e2e2e', borderRadius: '9999px', marginBottom: '6px' }} />
        <div style={{ width: '120px', height: '12px', backgroundColor: '#2e2e2e', borderRadius: '6px' }} />
      </div>

      {/* Streak cards */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {[1, 2].map(i => (
          <div key={i} style={{
            flex: 1, height: '110px',
            backgroundColor: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '12px',
          }} />
        ))}
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '20px' }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{
            height: '80px',
            backgroundColor: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '12px',
          }} />
        ))}
      </div>

      {/* Badge grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
        {Array.from({ length: 11 }).map((_, i) => (
          <div key={i} style={{
            height: '100px',
            backgroundColor: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '12px',
          }} />
        ))}
      </div>
    </div>
  )
}
