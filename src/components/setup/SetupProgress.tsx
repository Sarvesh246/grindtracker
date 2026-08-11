'use client'

const TOTAL_STEPS = 6

export default function SetupProgress({
  stepIndex,
}: {
  /** 0-based step (Welcome = 0). Displayed as 1–6. */
  stepIndex: number
}) {
  const current = Math.min(Math.max(stepIndex, 0), TOTAL_STEPS - 1) + 1
  const fraction = current / TOTAL_STEPS

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '420px',
        margin: '0 auto',
        padding: '0 4px',
      }}
      aria-label={`Setup step ${current} of ${TOTAL_STEPS}`}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '10px',
        }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '12px',
            color: 'var(--text-muted)',
            letterSpacing: '0.5px',
          }}
        >
          {current} / {TOTAL_STEPS}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              aria-hidden
              style={{
                width: i === stepIndex ? '14px' : '6px',
                height: '6px',
                borderRadius: '9999px',
                backgroundColor:
                  i <= stepIndex ? 'var(--accent)' : 'var(--border)',
                transition: 'width 320ms ease, background-color 320ms ease',
              }}
            />
          ))}
        </div>
      </div>
      <div
        style={{
          height: '3px',
          borderRadius: '9999px',
          backgroundColor: 'var(--border)',
          overflow: 'hidden',
        }}
      >
        <div
          className="setup-progress-fill"
          style={{
            height: '100%',
            width: '100%',
            backgroundColor: 'var(--accent)',
            transform: `scaleX(${fraction})`,
          }}
        />
      </div>
    </div>
  )
}
