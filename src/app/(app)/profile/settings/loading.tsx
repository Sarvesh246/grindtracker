/** Mirrors the Settings shell and the first category. */
export default function SettingsLoading() {
  const card = (height: number) => (
    <div className="settings-section">
      <div className="shimmer" style={{ width: '100px', height: '12px', borderRadius: '4px', marginBottom: '10px' }} />
      <div className="shimmer" style={{ height, borderRadius: 'var(--radius-md)' }} />
    </div>
  )
  return (
    <div className="page page--settings" aria-hidden="true">
      <div className="settings-header">
        <div className="shimmer" style={{ width: 44, height: 44, borderRadius: '50%' }} />
        <div className="shimmer" style={{ width: 104, height: 32, borderRadius: 6 }} />
        <div className="shimmer" style={{ width: 44, height: 44, borderRadius: '50%', marginInlineStart: 'auto' }} />
      </div>
      <div className="settings-shell">
        <div className="settings-nav">
          <div className="shimmer settings-nav-skeleton" style={{ height: 62, borderRadius: 16 }} />
        </div>
        <div className="settings-panel settings-panel--general">
          <div className="settings-panel-head">
            <div className="shimmer" style={{ width: 84, height: 26, borderRadius: 6 }} />
          </div>
          {card(206)}
          {card(150)}
        </div>
      </div>
    </div>
  )
}
