'use client'
import { useEffect, useState } from 'react'
import BadgeIcon from './BadgeIcon'
import type { BadgeDefinition } from '@/lib/utils/badges'

/**
 * Full-screen celebration shown before CompletionModal when a live workout
 * finish earns one or more badges — a small pill in the modal was easy to
 * miss entirely. Purely presentational: the caller decides when to mount it
 * and what happens on continue (normally revealing the already-queued
 * CompletionModal underneath).
 */
export default function BadgeUnlockOverlay({
  badges,
  onContinue,
}: {
  badges: BadgeDefinition[]
  onContinue: () => void
}) {
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  function requestClose() {
    if (closing) return
    setClosing(true)
    setVisible(false)
    window.setTimeout(onContinue, 320)
  }

  const shown = visible && !closing
  const multiple = badges.length > 1

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 320,
        backgroundColor: 'rgba(6,6,6,0.96)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        opacity: shown ? 1 : 0,
        transition: 'opacity 280ms ease',
        pointerEvents: closing ? 'none' : 'auto',
      }}
    >
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        transform: shown ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.96)',
        transition: 'transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        maxWidth: '360px',
        width: '100%',
        // Bounded to the viewport (minus the outer 32px padding) so a large
        // batch of badges scrolls internally instead of pushing the CONTINUE
        // button off-screen — only the badge list scrolls; the title and
        // button stay put, so the CTA is always reachable.
        maxHeight: 'calc(100dvh - 64px)',
      }}>
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '15px',
          letterSpacing: '3px',
          color: 'var(--accent-text)',
          marginBottom: '20px',
          opacity: shown ? 1 : 0,
          transition: 'opacity 300ms ease 120ms',
          flexShrink: 0,
        }}>
          {multiple ? 'NEW BADGES UNLOCKED' : 'NEW BADGE UNLOCKED'}
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          width: '100%',
          marginBottom: '28px',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          flex: '1 1 auto',
          minHeight: 0,
          // Room for the focus ring / scrollbar without clipping either.
          padding: '2px 2px',
        }}>
          {badges.map((badge, i) => {
            const delay = 160 + i * 130
            return (
              <div
                key={badge.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  backgroundColor: 'var(--surface-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '16px',
                  padding: '16px 18px',
                  opacity: shown ? 1 : 0,
                  transform: shown ? 'translateY(0)' : 'translateY(10px)',
                  transition: `opacity 320ms ease ${delay}ms, transform 320ms ease ${delay}ms`,
                }}
              >
                <div style={{
                  position: 'relative',
                  width: '56px',
                  height: '56px',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '9999px',
                    backgroundColor: 'var(--accent)',
                    opacity: shown ? 0.16 : 0,
                    transform: shown ? 'scale(1)' : 'scale(0.4)',
                    transition: `transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}ms, opacity 420ms ease ${delay}ms`,
                  }} />
                  <div style={{
                    position: 'relative',
                    transform: shown ? 'scale(1) rotate(0deg)' : 'scale(0.3) rotate(-25deg)',
                    transition: `transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1) ${delay + 40}ms`,
                  }}>
                    <BadgeIcon badgeId={badge.id} size={30} earned />
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: '20px',
                    letterSpacing: '0.5px',
                    color: 'var(--text-primary)',
                    lineHeight: 1.15,
                  }}>
                    {badge.label}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.35, marginTop: '2px' }}>
                    {badge.description}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <button
          onClick={requestClose}
          style={{
            width: '100%',
            height: '52px',
            backgroundColor: 'var(--accent)',
            color: 'var(--on-accent)',
            border: 'none',
            borderRadius: '12px',
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '18px',
            letterSpacing: '1px',
            cursor: 'pointer',
            opacity: shown ? 1 : 0,
            flexShrink: 0,
            transition: `opacity 300ms ease ${160 + badges.length * 130}ms`,
          }}
        >
          CONTINUE
        </button>
      </div>
    </div>
  )
}
