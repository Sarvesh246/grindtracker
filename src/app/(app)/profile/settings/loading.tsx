/** Mirrors SettingsView's shell: tab bar (rail on desktop) + a panel of paired rows. */
export default function SettingsLoading() {
  const card = (h: number, span = false) => (
    <div className={span ? 'settings-section settings-span' : 'settings-section'}>
      <div className="shimmer" style={{ width: '100px', height: '12px', borderRadius: '4px', marginBottom: '10px' }} />
      <div className="shimmer" style={{ width: '100%', height: `${h}px`, borderRadius: '12px' }} />
    </div>
  )
  return (
    <div className="page page--settings" style={{ padding: '0 16px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingTop: '24px', marginBottom: '16px' }}>
        <div className="shimmer" style={{ width: '24px', height: '24px', borderRadius: '6px', flexShrink: 0 }} />
        <div className="shimmer" style={{ width: '120px', height: '32px', borderRadius: '8px' }} />
      </div>
      <div className="settings-shell">
        <div className="settings-nav">
          <div className="shimmer settings-nav-skeleton" style={{ height: '66px', borderRadius: '16px' }} />
        </div>
        <div className="settings-panel">
          {card(150)}
          {card(150)}
          {card(76, true)}
        </div>
      </div>
    </div>
  )
}
