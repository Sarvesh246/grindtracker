'use client'
import type { CSSProperties } from 'react'
import type { Charge } from '@/lib/body'

/**
 * Charge on Home: a small ring + the advice sentence, sitting inside the Up
 * Next group directly above the Start button, so the verdict reads first and
 * the action follows. Renders nothing without a score; tapping opens the
 * Today sheet.
 */

export function Ring({
  score,
  size = 52,
  stroke = 5,
  muted = false,
}: {
  /** 0–100, or null for an empty track. */
  score: number | null
  size?: number
  stroke?: number
  /** Dim the arc (e.g. a past day in the week strip). */
  muted?: boolean
}) {
  const r = (size - stroke) / 2
  const len = 2 * Math.PI * r
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100
  return (
    <span
      aria-hidden="true"
      style={{ position: 'relative', width: size, height: size, flexShrink: 0, display: 'inline-flex' }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-elevated)" strokeWidth={stroke} />
        {score != null && pct > 0 && (
          <circle
            className="body-ring-arc"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeOpacity={muted ? 0.55 : 1}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={len}
            strokeDashoffset={len * (1 - pct)}
            style={{ '--ring-len': `${len}` } as CSSProperties}
          />
        )}
      </svg>
      <span
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: `${Math.max(11, Math.round(size * 0.3))}px`,
          fontWeight: 600,
          color: score == null ? 'var(--text-muted)' : 'var(--text-primary)',
          letterSpacing: '-0.5px',
        }}
      >
        {score ?? '–'}
      </span>
    </span>
  )
}

/** The advice minus its leading "Primed." — the band already sits in the label. */
export function adviceBody(charge: Charge): string {
  return charge.advice.replace(/^(Primed|Steady|Easy)\.\s*/, '')
}

export default function ChargeRing({ charge, onOpen }: { charge: Charge | null; onOpen: () => void }) {
  if (!charge) return null
  return (
    <button
      type="button"
      className="press-card swap-in"
      data-haptic="light"
      onClick={onOpen}
      aria-label={`Charge ${charge.score}, ${charge.bandLabel}. ${charge.advice} Open your day.`}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '64px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '6px 6px 6px 2px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <Ring score={charge.score} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <span style={{
          fontSize: '11px',
          letterSpacing: 'var(--tracking-label)',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: 'var(--text-muted)',
        }}>
          Charge <span aria-hidden="true">·</span>{' '}
          <span style={{ color: 'var(--accent-text)' }}>{charge.bandLabel}</span>
        </span>
        <span style={{ fontSize: '13px', lineHeight: 1.4, color: 'var(--text-secondary)' }}>
          {adviceBody(charge)}
        </span>
      </span>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  )
}
