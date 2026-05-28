export default function HomeLoading() {
  return (
    <div style={{ padding: '24px 16px', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div className="shimmer" style={{ width: '80px', height: '28px', borderRadius: '8px' }} />
        <div className="shimmer" style={{ width: '100px', height: '16px', borderRadius: '8px', marginTop: '6px' }} />
      </div>
      {[120, 88, 64, 160].map((h, i) => (
        <div key={i} className="shimmer" style={{
          width: '100%', height: `${h}px`,
          borderRadius: '12px', marginBottom: '12px',
        }} />
      ))}
    </div>
  )
}
