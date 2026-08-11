'use client'
import { useEffect, useState } from 'react'
import { useUnit } from '@/lib/contexts/UnitContext'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import Dialog from '@/components/ui/Dialog'

interface CompletionData {
  xpEarned: number
  leveledUp: boolean
  newLevel: number
  prCount: number
  prExercises: { name: string; weight: number; reps: number }[]
  duration: number
  setsCompleted: number
  currentStreak: number
  isNewBestStreak: boolean
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

// Quick start, gentle settle onto the final number.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export default function CompletionModal({
  data,
  onDone,
  onUndo,
}: {
  data: CompletionData
  onDone: () => void
  /** Return false (or a rejected promise) to keep the modal open on failure. */
  onUndo?: () => void | boolean | Promise<void | boolean>
}) {
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const [undoBusy, setUndoBusy] = useState(false)
  const { unitLabel, fmt } = useUnit()
  const { reduceMotion } = useMotionPref()
  // Start at 0 when animating so we don't flash the full XP then jump back to 0.
  const [xpDisplay, setXpDisplay] = useState(() => (reduceMotion ? data.xpEarned : 0))

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  function requestClose(action: () => void) {
    if (closing || undoBusy) return
    setClosing(true)
    setVisible(false)
    window.setTimeout(action, reduceMotion ? 0 : 380)
  }

  async function handleUndoClick() {
    if (!onUndo || closing || undoBusy) return
    // Await undo BEFORE closing — on failure the modal used to stay stuck
    // closing/invisible with pointer-events none while the session stayed completed.
    setUndoBusy(true)
    try {
      const ok = await Promise.resolve(onUndo())
      if (ok === false) return
      setClosing(true)
      setVisible(false)
    } finally {
      setUndoBusy(false)
    }
  }

  const shown = visible && !closing

  // XP count-up respects Reduce Motion — keep final value, animate only when allowed.
  // Initial state already snaps when reduceMotion; this effect only runs the RAF count-up.
  useEffect(() => {
    const target = data.xpEarned
    if (target <= 0 || reduceMotion) return
    const durationMs = 700
    const start = performance.now()
    let raf: number
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs)
      setXpDisplay(Math.round(target * easeOutCubic(t)))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [data.xpEarned, reduceMotion])

  function sectionStyle(index: number): React.CSSProperties {
    if (reduceMotion) return { opacity: 1, transform: 'none' }
    const delay = index * 55
    return {
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(10px)',
      transition: `opacity 320ms ease ${delay}ms, transform 320ms ease ${delay}ms`,
    }
  }

  const stats = [
    { label: 'DURATION', value: formatDuration(data.duration) },
    { label: 'SETS', value: String(data.setsCompleted) },
    { label: 'PRs', value: String(data.prCount) },
    { label: 'STREAK', value: String(data.currentStreak) },
  ]

  return (
    <Dialog
      open
      title="Workout complete"
      closeOnBackdrop={false}
      zIndex={300}
      style={{
        opacity: shown ? 1 : 0,
        transition: reduceMotion ? 'none' : 'opacity 250ms ease',
        pointerEvents: closing ? 'none' : 'auto',
      }}
      panelStyle={{ maxWidth: '100%' }}
    >
      <div style={{
        width: '100%',
        backgroundColor: 'var(--surface)',
        borderRadius: '20px 20px 0 0',
        border: '1px solid var(--border)',
        borderBottom: 'none',
        padding: '32px 24px 48px',
        transform: shown || reduceMotion ? 'translateY(0)' : 'translateY(100%)',
        transition: reduceMotion
          ? 'none'
          : closing
            ? 'transform 320ms cubic-bezier(0.4, 0, 1, 1)'
            : 'transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        maxHeight: '90dvh',
        overflowY: 'auto',
      }}>

        <div style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '40px', color: 'var(--accent-text)',
          textAlign: 'center', letterSpacing: '2px',
          marginBottom: '8px',
          ...sectionStyle(0),
        }}>
          WORKOUT COMPLETE
        </div>

        <div style={{ textAlign: 'center', marginBottom: '24px', ...sectionStyle(1) }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '72px', lineHeight: 1,
            color: 'var(--text-primary)',
          }}>
            <span style={{ color: 'var(--accent-text)' }}>+</span>{xpDisplay}
          </span>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '2px' }}>
            XP EARNED
          </div>
        </div>

        {data.leveledUp && (
          <div style={{
            backgroundColor: 'rgba(200, 241, 53, 0.08)',
            border: '1px solid rgba(200, 241, 53, 0.25)',
            borderRadius: '12px',
            padding: '14px',
            textAlign: 'center',
            marginBottom: '20px',
            ...sectionStyle(2),
          }}>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '28px', color: 'var(--accent-text)', letterSpacing: '1px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              LEVEL UP → LVL {data.newLevel}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', ...sectionStyle(3) }}>
          {stats.map(stat => (
            <div key={stat.label} style={{
              flex: 1,
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '12px 6px',
              textAlign: 'center',
              position: 'relative',
            }}>
              {stat.label === 'STREAK' && data.isNewBestStreak && (
                <div style={{
                  position: 'absolute', top: '-8px', left: '50%', transform: 'translateX(-50%)',
                  backgroundColor: 'var(--accent)', color: 'var(--on-accent)',
                  fontSize: '8px', fontWeight: 700, letterSpacing: '0.4px',
                  padding: '2px 6px', borderRadius: '9999px', whiteSpace: 'nowrap',
                }}>
                  NEW BEST
                </div>
              )}
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '22px', color: 'var(--text-primary)', lineHeight: 1, marginBottom: '4px',
              }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {data.prExercises.length > 0 && (
          <div style={{ marginBottom: '20px', ...sectionStyle(4) }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px' }}>
              PERSONAL RECORDS
            </div>
            {data.prExercises.map((pr, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 12px',
                backgroundColor: 'var(--surface-elevated)',
                borderRadius: '8px',
                marginBottom: '6px',
              }}>
                <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{pr.name}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '14px', color: 'var(--accent-text)',
                  }}>
                    {fmt(pr.weight)} {unitLabel} × {pr.reps}
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
                    <polyline points="8 6 12 2 16 6"/><path d="M12 2v10"/><path d="M5 17l1.5-5h11L19 17"/><path d="M3 22h18"/>
                  </svg>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Badges earned get their own full-screen celebration (BadgeUnlockOverlay)
            shown before this modal on the live-finish path — repeating them here
            too would just be the same news twice in a row. */}

        <div style={{ ...sectionStyle(6) }}>
          <button
            data-haptic="medium"
            onClick={() => requestClose(onDone)}
            style={{
              position: 'relative',
              width: '100%', height: '56px',
              backgroundColor: 'var(--accent)',
              color: 'var(--on-accent)',
              border: 'none', borderRadius: '12px',
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '22px', letterSpacing: '1px',
              cursor: 'pointer',
            }}
          >
            BACK TO HOME
          </button>

          {onUndo && (
            <button
              data-haptic="medium"
              onClick={() => void handleUndoClick()}
              disabled={undoBusy || closing}
              style={{
                position: 'relative',
                width: '100%', height: '44px', marginTop: '10px',
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '14px', fontWeight: 600,
                cursor: undoBusy || closing ? 'default' : 'pointer',
                opacity: undoBusy ? 0.7 : 1,
              }}
            >
              {undoBusy ? 'Resuming…' : 'Accidentally finished? Resume workout'}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
