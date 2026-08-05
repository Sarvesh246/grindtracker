export default function ProgressPhotosLoading() {
  return (
    <div style={{ padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <div className="shimmer" style={{ width: '44px', height: '44px', borderRadius: '10px' }} />
        <div className="shimmer" style={{ width: '160px', height: '28px', borderRadius: '8px' }} />
      </div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {[70, 90, 100].map((w, i) => (
          <div key={i} className="shimmer" style={{ width: `${w}px`, height: '36px', borderRadius: '9999px' }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {[1, 2].map(i => (
          <div key={i} className="shimmer" style={{ height: '220px', borderRadius: '12px' }} />
        ))}
      </div>
    </div>
  )
}
