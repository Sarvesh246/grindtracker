'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { placePopover, useAnchorRect, type Side } from './anchor'

/**
 * One onboarding popup anchored to a target element, with a spotlight cutout that
 * dims everything except the target (box-shadow technique — NOT an opaque backdrop
 * over the target). Auto-flips to stay on-screen; on mobile it drops to a bottom
 * sheet above the nav when the target is in the lower half (a clipped floating
 * bubble is never acceptable). Rendered by `Tour`, one step at a time.
 *
 * Every mark carries a persistent "Skip tour" link and a small "×"; the × advances
 * (marks this step seen) without ending the tour. The very first coach mark a user
 * ever sees also gets "Skip all tours" via `onSkipAll`.
 */
export interface CoachMarkProps {
  getEl: () => HTMLElement | null
  step: number
  total: number
  title: string
  body: string
  isLast: boolean
  /** Next / Done / × — advance the tour (marks the current step seen). */
  onAdvance: () => void
  /** Back — omitted on the first step. */
  onBack?: () => void
  /** End the whole tour now (still marks it seen so it won't reappear). */
  onSkipTour: () => void
  /** Only supplied on the first-ever coach mark: opt out of every future tour. */
  onSkipAll?: () => void
}

const SPOT_PAD = 6
const POINTER = 7

export default function CoachMark({
  getEl,
  step,
  total,
  title,
  body,
  isLast,
  onAdvance,
  onBack,
  onSkipTour,
  onSkipAll,
}: CoachMarkProps) {
  const anchor = useAnchorRect(getEl, true)
  const cardRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Move focus into the card on mount / step change so it's keyboard reachable,
  // and let Escape skip the tour (matches the app's modal dismissal affordances).
  useEffect(() => {
    primaryRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onSkipTour()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, onSkipTour])

  useLayoutEffect(() => {
    if (!cardRef.current) return
    const r = cardRef.current.getBoundingClientRect()
    setSize(prev => (prev && prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }))
  }, [title, body, step, isMobile, anchor?.width])

  const vh = typeof window !== 'undefined' ? window.innerHeight : 0
  const anchorCenterY = anchor ? anchor.top + anchor.height / 2 : 0

  // Bottom sheet on mobile when the target is in the lower half (a floating bubble
  // there would sit over the nav or clip). Floating bubble otherwise; centered
  // fallback if the target can't be found.
  const mode: 'sheet' | 'bubble' | 'center' = !anchor
    ? 'center'
    : isMobile && anchorCenterY > vh / 2
      ? 'sheet'
      : 'bubble'

  const placed =
    mode === 'bubble' && anchor && size
      ? placePopover(anchor, size.w, size.h, {
          preferred: (isMobile ? ['bottom', 'top'] : ['bottom', 'top', 'right', 'left']) as Side[],
          offset: 12,
        })
      : null

  const ready = mode === 'sheet' || mode === 'center' || !!placed

  // Card position depends on mode.
  const cardPosition: React.CSSProperties =
    mode === 'sheet'
      ? {
          position: 'fixed',
          left: '12px',
          right: '12px',
          // Clear the mobile bottom nav — mirrors the proven offset the passive
          // toast uses (env safe-area + ~84px nav) with a little extra room.
          bottom: 'calc(env(safe-area-inset-bottom) + 88px)',
          animation: 'onboard-sheet-in 190ms ease',
        }
      : mode === 'center'
        ? {
            position: 'fixed',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(340px, calc(100vw - 32px))',
            animation: 'onboard-pop-in 180ms ease',
          }
        : {
            position: 'fixed',
            top: placed ? placed.top : -9999,
            left: placed ? placed.left : -9999,
            width: 'min(320px, calc(100vw - 24px))',
            animation: 'onboard-pop-in 180ms ease',
          }

  const side = placed?.side ?? 'bottom'
  const showPointer = mode === 'bubble' && !!placed
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

  const linkStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    padding: 0,
    color: 'var(--text-muted)',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
    fontFamily: "'DM Sans', sans-serif",
    fontSize: '12px',
    cursor: 'pointer',
  }

  return (
    <>
      {/* Full-screen catcher so page controls can't be tapped mid-tour. Transparent;
          the dim itself is the spotlight's box-shadow below. */}
      <div
        onClick={e => e.stopPropagation()}
        style={{ position: 'fixed', inset: 0, zIndex: 698, background: 'transparent' }}
        aria-hidden="true"
      />

      {/* Spotlight cutout — dims everything except a padded ring around the target. */}
      {anchor && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: anchor.top - SPOT_PAD,
            left: anchor.left - SPOT_PAD,
            width: anchor.width + SPOT_PAD * 2,
            height: anchor.height + SPOT_PAD * 2,
            borderRadius: 'var(--radius-md)',
            // Accent ring listed first so it paints ON TOP of the dim (box-shadow
            // paints first-listed uppermost); the dim's huge spread fills the rest.
            boxShadow: '0 0 0 2px var(--accent), 0 0 0 9999px rgba(0,0,0,0.55)',
            zIndex: 699,
            pointerEvents: 'none',
            animation: 'onboard-dim-in 180ms ease',
          }}
        />
      )}
      {/* Centered fallback (target missing): plain dim, no hole. */}
      {mode === 'center' && (
        <div
          aria-hidden="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 699, pointerEvents: 'none', animation: 'onboard-dim-in 180ms ease' }}
        />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} — step ${step} of ${total}`}
        style={{
          ...cardPosition,
          zIndex: 701,
          backgroundColor: 'var(--surface-elevated)',
          border: '1px solid var(--border-strong)',
          borderRadius: mode === 'sheet' ? 'var(--radius-lg) var(--radius-lg) 0 0' : 'var(--radius-md)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          padding: '16px',
          opacity: ready ? 1 : 0,
        }}
      >
        {showPointer && <span style={pointerStyle} aria-hidden="true" />}

        {/* × — dismiss this mark and advance (never kills the rest of the tour). */}
        <button
          type="button"
          onClick={onAdvance}
          aria-label={isLast ? 'Finish tour' : 'Dismiss this step'}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <line x1="5" y1="5" x2="19" y2="19" />
            <line x1="19" y1="5" x2="5" y2="19" />
          </svg>
        </button>

        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '11px',
            color: 'var(--text-muted)',
            letterSpacing: '0.5px',
            marginBottom: '6px',
          }}
        >
          {step} / {total}
        </div>
        <div
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '24px',
            letterSpacing: '1px',
            lineHeight: 1.05,
            color: 'var(--text-primary)',
            marginBottom: '6px',
            paddingRight: '24px',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '14px',
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
            marginBottom: '16px',
          }}
        >
          {body}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              style={{
                minHeight: '44px',
                padding: '0 16px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Back
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            onClick={onAdvance}
            style={{
              flex: 1,
              minHeight: '44px',
              padding: '0 16px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--accent)',
              border: '1px solid var(--accent)',
              color: 'var(--on-accent)',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
          <button type="button" onClick={onSkipTour} style={linkStyle}>
            Skip tour
          </button>
          {onSkipAll && (
            <button type="button" onClick={onSkipAll} style={linkStyle}>
              Skip all tours
            </button>
          )}
        </div>
      </div>
    </>
  )
}
