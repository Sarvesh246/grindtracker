/**
 * Instant paint for a tap on the Log tab (or Home's Start button). Without a
 * loading boundary the router held the previous page on screen until the
 * /log payload arrived, so on a slow connection the tab looked dead and got
 * tapped again and again. Kept neutral (title + stacked cards) because the
 * same boundary covers both the day picker and a live workout (`?day=`).
 */
export default function LogLoading() {
  return (
    <div style={{ padding: '24px 16px' }} aria-busy="true" aria-label="Loading">
      <div className="shimmer" style={{ width: '120px', height: '32px', borderRadius: '8px', marginBottom: '20px' }} />
      <div className="shimmer" style={{ height: '56px', borderRadius: '12px', marginBottom: '16px' }} />
      {[1, 2, 3].map(i => (
        <div key={i} className="shimmer" style={{ height: '112px', borderRadius: '12px', marginBottom: '12px' }} />
      ))}
    </div>
  )
}
