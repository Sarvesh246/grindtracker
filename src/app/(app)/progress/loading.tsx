export default function ProgressLoading() {
  return (
    <div style={{ padding: '24px 16px', fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div style={{ width: '120px', height: '32px', backgroundColor: '#2e2e2e', borderRadius: '8px' }} />
        <div style={{ width: '80px', height: '16px', backgroundColor: '#2e2e2e', borderRadius: '8px', marginTop: '8px' }} />
      </div>
      {/* Selector placeholder */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', overflow: 'hidden' }}>
        {[80, 120, 100, 90, 110].map((w, i) => (
          <div key={i} style={{ width: `${w}px`, height: '36px', backgroundColor: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '9999px', flexShrink: 0 }} />
        ))}
      </div>
      {/* Stats bar */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ flex: 1, height: '56px', backgroundColor: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '10px' }} />
        ))}
      </div>
      {/* Chart */}
      <div style={{ height: '220px', backgroundColor: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '12px' }} />
    </div>
  )
}
