export default function ProgressLoading() {
  return (
    <div className="page page--progress progress-workspace" aria-busy="true">
      <span className="sr-only">Loading progress</span>
      <div className="progress-heading" aria-hidden="true">
        <div className="shimmer" style={{ width: 110, height: 32, borderRadius: 8 }} />
      </div>
      <div className="progress-layout" aria-hidden="true">
        <div className="progress-filters">
          <div className="progress-selectors">
            {[1, 2].map(i => <div key={i} className="shimmer" style={{ height: 58, borderRadius: 8 }} />)}
          </div>
          <div className="progress-chips shimmer" style={{ height: 88, borderRadius: 12 }} />
        </div>
        <div className="progress-main">
          <div className="progress-chart-card">
            <div className="progress-chart-header">
              <div className="shimmer" style={{ width: '55%', height: 36, borderRadius: 8 }} />
            </div>
            <div className="progress-chart-plot shimmer" />
            <div className="progress-stats shimmer" style={{ height: 55 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
