'use client'

import Button from '@/components/ui/Button'

export default function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        position: 'relative',
        minHeight: 0,
      }}
    >
      {/* Brand field: radial lime washes + soft grid (CSS only). */}
      <div
        aria-hidden
        className="setup-welcome-grid"
        style={{
          position: 'absolute',
          inset: '-8% -12%',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '8%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(420px, 90vw)',
          height: '280px',
          borderRadius: '50%',
          background:
            'radial-gradient(ellipse at center, var(--accent-wash) 0%, transparent 70%)',
          pointerEvents: 'none',
          opacity: 0.9,
        }}
      />

      <div style={{ position: 'relative', textAlign: 'center', padding: '0 8px' }}>
        <div
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 'clamp(72px, 18vw, 96px)',
            lineHeight: 0.92,
            color: 'var(--accent-text)',
            letterSpacing: '4px',
            marginBottom: '20px',
          }}
        >
          GRIND
        </div>
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '17px',
            lineHeight: 1.45,
            color: 'var(--text-secondary)',
            maxWidth: '320px',
            margin: '0 auto 36px',
          }}
        >
          Track every set. Chase PRs. Keep the streak.
        </p>
        <Button
          type="button"
          variant="primary"
          size="lg"
          fullWidth
          data-haptic="light"
          onClick={onContinue}
          style={{ maxWidth: '320px', margin: '0 auto', height: '52px', fontSize: '16px' }}
        >
          Get started
        </Button>
      </div>
    </div>
  )
}
