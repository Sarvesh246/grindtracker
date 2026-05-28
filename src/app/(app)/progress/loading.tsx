export default function ProgressLoading() {
  return (
    <div style={{ padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div className="shimmer" style={{ width: '120px', height: '32px', borderRadius: '8px' }} />
        <div className="shimmer" style={{ width: '80px', height: '16px', borderRadius: '8px', marginTop: '8px' }} />
      </div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', overflow: 'hidden' }}>
        {[80, 120, 100, 90, 110].map((w, i) => (
          <div key={i} className="shimmer" style={{
            width: `${w}px`, height: '36px',
            borderRadius: '9999px', flexShrink: 0,
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="shimmer" style={{ flex: 1, height: '56px', borderRadius: '10px' }} />
        ))}
      </div>
      <div className="shimmer" style={{ height: '220px', borderRadius: '12px' }} />
    </div>
  )
}
