export default function SettingsLoading() {
  return (
    <div className="page page--settings" style={{ padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
        <div className="shimmer" style={{ width: '24px', height: '24px', borderRadius: '6px', flexShrink: 0 }} />
        <div className="shimmer" style={{ width: '120px', height: '32px', borderRadius: '8px' }} />
      </div>
      <div className="settings-columns">
      {[1, 2, 3, 4, 5, 6, 7].map(i => (
        <div key={i} style={{ marginBottom: '20px' }}>
          <div className="shimmer" style={{ width: '100px', height: '12px', borderRadius: '4px', marginBottom: '10px' }} />
          <div
            className="shimmer"
            style={{
              width: '100%',
              height: i === 2 ? '480px' : i === 3 ? '140px' : '88px',
              borderRadius: '12px',
            }}
          />
        </div>
      ))}
      </div>
    </div>
  )
}
