/** Instant paint for the Ranks tab while the server resolves the viewer. */
export default function LeaderboardLoading() {
  return (
    <div className="page page--ranks" style={{ paddingTop: '24px', paddingLeft: '16px', paddingRight: '16px' }} aria-busy="true" aria-label="Loading">
      <div className="shimmer" style={{ width: '110px', height: '32px', borderRadius: '8px', marginBottom: '20px' }} />
      <div className="ranks-layout">
      <div className="ranks-aside"><div className="shimmer ranks-friends-skeleton" style={{ height: '56px', borderRadius: '12px', marginBottom: '16px' }} /></div>
      <div className="ranks-main">
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="shimmer" style={{ flex: 1, height: '36px', borderRadius: '9999px' }} />
        ))}
      </div>
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="shimmer" style={{ height: '64px', borderRadius: '12px', marginBottom: '8px' }} />
      ))}
      </div>
      </div>
    </div>
  )
}
