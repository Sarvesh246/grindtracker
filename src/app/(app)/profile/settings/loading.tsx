/** Mirrors SettingsView's shell: tab bar (rail on desktop) + a two-column panel. */
export default function SettingsLoading() {
  const card = (h: number) => (
    <div>
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
          <div className="shimmer settings-nav-skeleton" style={{ height: '62px', borderRadius: '14px' }} />
        </div>
        <div className="settings-panel">
          <div className="settings-col">{card(120)}{card(64)}</div>
          <div className="settings-col">{card(120)}</div>
        </div>
      </div>
    </div>
  )
}
