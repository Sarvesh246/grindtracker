'use client'
import type { CSSProperties } from 'react'
import type { Charge } from '@/lib/body'
import '@/components/health/recovery/recovery.css'

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

const CALL_ICON = {
  primed: 'M13 2 4 14h7l-1 8 9-12h-7Z',
  steady: 'M4 14a8 8 0 0 1 16 0M12 14l4-4',
  easy: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'
} as const
const CALL_DAY = { primed: 'Push day', steady: 'Steady day', easy: 'Easy day' } as const
const CALL_LEVEL = { primed: 2, steady: 1, easy: 0 } as const
const CALL_RPE = { primed: 'RPE 8–9', steady: 'RPE 7–8', easy: 'RPE ≤ 6' } as const

/** Home: today's call above Up Next. The verdict reads first; tapping opens the Today sheet. */
export default function ChargeRing({ charge, onOpen }: { charge: Charge | null; onOpen: () => void }) {
  if (!charge) return null
  return (
    <button
      type="button"
      className="rcv-strip swap-in"
      data-band={charge.band}
      data-haptic="light"
      onClick={onOpen}
      aria-label={`Charge ${charge.score}, ${charge.bandLabel}. ${charge.advice} Open your day.`}
    >
      <span className="rcv-strip-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={CALL_ICON[charge.band]} />
        </svg>
      </span>
      <span className="rcv-strip-body">
        <strong>
          {CALL_DAY[charge.band]} <span aria-hidden="true">·</span> Charge {charge.score}
        </strong>
        <span className="rcv-pips" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <i key={i} data-on={i === CALL_LEVEL[charge.band]} />
          ))}
        </span>
      </span>
      <span className="rcv-strip-rpe" aria-hidden="true">{CALL_RPE[charge.band]}</span>
    </button>
  )
}
