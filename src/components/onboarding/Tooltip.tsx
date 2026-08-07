'use client'
import { useLayoutEffect, useRef, useState } from 'react'
import { placePopover, useAnchorRect, type Side } from './anchor'

/**
 * Generic small popup hint, anchored to a target element in viewport coords so
 * it can't be clipped by a scroll container. Same visual language as the badge
 * tooltip in ProfileDashboard: `surface-elevated` fill, `border-strong` border,
 * 8px radius, drop shadow — plus a small triangular pointer and an optional "×".
 *
 * Presentational only: the caller decides when it's visible. `useFeatureTooltip`
 * uses it for the one-off ActiveWorkout hints; it can also back a hover/tap
 * primitive. Announced via `role="status"` so screen readers pick it up.
 */
export interface TooltipProps {
  /** Resolves the element to point at, live (so late mounts / re-layouts work). */
  getEl: () => HTMLElement | null
  body: string
  title?: string
  /** When set, renders a small × that dismisses just this tooltip. */
  onDismiss?: () => void
  /** When set, renders a persistent "Skip tips" link (mirrors CoachMark's
   *  "Skip tutorial") that opts out of this whole tooltip family at once. */
  onSkip?: () => void
  /** Plays the fade/slide-out variant of the entrance and stops taking clicks. */
  closing?: boolean
  /** Preferred sides in order. Defaults to below → above → right → left. */
  preferred?: Side[]
  maxWidth?: number
}

const POINTER = 7

const linkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--text-muted)',
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
  fontFamily: "'DM Sans', sans-serif",
  fontSize: '11px',
  cursor: 'pointer',
}

export default function Tooltip({ getEl, body, title, onDismiss, onSkip, closing, preferred, maxWidth = 250 }: TooltipProps) {
  const anchor = useAnchorRect(getEl, true)
  const cardRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useLayoutEffect(() => {
    if (!cardRef.current) return
    const r = cardRef.current.getBoundingClientRect()
    setSize(prev => (prev && prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }))
  }, [body, title, anchor?.width, anchor?.height])

  const placed = anchor && size ? placePopover(anchor, size.w, size.h, { preferred, offset: 10 }) : null
  const ready = !!placed

  // Pointer sits on the edge facing the anchor.
  const side = placed?.side ?? 'bottom'
  const pointerStyle: React.CSSProperties = {
    position: 'absolute',
    width: POINTER * 2,
    height: POINTER * 2,
    transform: 'rotate(45deg)',
    backgroundColor: 'var(--surface-elevated)',
    ...(side === 'bottom' && { top: -POINTER, left: (placed?.arrowLeft ?? 0) - POINTER, borderLeft: '1px solid var(--border-strong)', borderTop: '1px solid var(--border-strong)' }),
    ...(side === 'top' && { bottom: -POINTER, left: (placed?.arrowLeft ?? 0) - POINTER, borderRight: '1px solid var(--border-strong)', borderBottom: '1px solid var(--border-strong)' }),
    ...(side === 'right' && { left: -POINTER, top: (placed?.arrowTop ?? 0) - POINTER, borderLeft: '1px solid var(--border-strong)', borderBottom: '1px solid var(--border-strong)' }),
    ...(side === 'left' && { right: -POINTER, top: (placed?.arrowTop ?? 0) - POINTER, borderRight: '1px solid var(--border-strong)', borderTop: '1px solid var(--border-strong)' }),
  }

  return (
    <div
      ref={cardRef}
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: placed ? placed.top : -9999,
        left: placed ? placed.left : -9999,
        maxWidth,
        zIndex: 700,
        backgroundColor: 'var(--surface-elevated)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-sm)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
        padding: onDismiss ? '10px 30px 10px 12px' : '10px 12px',
        opacity: ready ? 1 : 0,
        pointerEvents: ready && !closing ? 'auto' : 'none',
        animation: !ready ? 'none' : closing ? 'onboard-tip-out 160ms ease forwards' : 'onboard-tip-in 160ms ease',
      }}
    >
      <span style={pointerStyle} aria-hidden="true" />
      {title && (
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '3px', letterSpacing: '0.2px' }}>
          {title}
        </div>
      )}
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', lineHeight: 1.45, color: 'var(--text-secondary)' }}>
        {body}
      </div>
      {onSkip && (
        <div style={{ marginTop: '8px' }}>
          <button type="button" onClick={onSkip} style={linkStyle}>
            Skip tips
          </button>
        </div>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss hint"
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            borderRadius: 'var(--radius-sm)',
            lineHeight: 1,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <line x1="5" y1="5" x2="19" y2="19" />
            <line x1="19" y1="5" x2="5" y2="19" />
          </svg>
        </button>
      )}
    </div>
  )
}
