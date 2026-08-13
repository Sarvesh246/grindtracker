'use client'
import { useEffect, useState } from 'react'
import { REST_PRESETS, getExerciseRest, setExerciseRest } from '@/lib/hooks/useRestTimer'

interface Props {
  exerciseId: string
  exerciseName: string
  remainingMs: number
  durationMs: number
  paused: boolean
  onStop: () => void
  onAdd: (sec: number) => void
  onPause: () => void
  onResume: () => void
}

const ADJUST_OPTIONS: { label: string; sec: number }[] = [
  { label: '+15s', sec: 15 },
  { label: '+30s', sec: 30 },
  { label: '+1:00', sec: 60 },
  { label: '−1:00', sec: -60 },
  { label: '−30s', sec: -30 },
  { label: '−15s', sec: -15 },
]

function fmt(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function RestTimerBar({
  exerciseId,
  exerciseName,
  remainingMs,
  durationMs,
  paused,
  onStop,
  onAdd,
  onPause,
  onResume,
}: Props) {
  const [open, setOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [rest, setRest] = useState<number>(() => getExerciseRest(exerciseId))

  // Re-sync the per-exercise rest preference from localStorage whenever the
  // active exercise changes (an external store, read client-side only).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRest(getExerciseRest(exerciseId))
  }, [exerciseId])

  const pct = durationMs > 0 ? Math.min(100, (remainingMs / durationMs) * 100) : 0
  const done = !paused && remainingMs <= 0
  const lowTime = !paused && !done && remainingMs <= 10_000

  // Collapse expanders while flashing REST DONE so a new start() doesn't
  // remount with presets still open.
  useEffect(() => {
    if (!done) return
    setOpen(false)
    setAddOpen(false)
  }, [done])

  return (
    <div
      role="status"
      aria-live="polite"
      className="wo-fixed-bar"
      style={{
        position: 'fixed',
        // Owns the bottom edge while active — Finish is hidden during rest.
        bottom: 0,
        // Bar background fills through the home-indicator safe area to the true
        // bottom; controls stay clear of the indicator.
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
        backgroundColor: 'var(--surface-elevated)',
        borderTop: '1px solid var(--border)',
        boxShadow: '0 -4px 16px rgba(0,0,0,0.4)',
        zIndex: 90,
      }}
    >
      <div
        style={{
          height: '3px',
          width: '100%',
          backgroundColor: 'var(--border)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${done ? 0 : pct}%`,
            backgroundColor: done ? 'var(--accent)' : lowTime ? 'var(--danger)' : 'var(--accent)',
            opacity: paused ? 0.4 : 1,
            // Shorter than the 250ms tick so the bar doesn't lag a full frame behind.
            transition: 'width 100ms linear, background-color 200ms ease, opacity 200ms ease',
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 16px', gap: '10px' }}>
        <button
          data-haptic="light"
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Collapse rest timer' : 'Expand rest timer'}
          aria-expanded={open}
          disabled={done}
          style={{
            position: 'relative',
            background: 'none',
            border: 'none',
            cursor: done ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flex: 1,
            minWidth: 0,
            padding: 0,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '20px',
              color: paused
                ? 'var(--text-muted)'
                : done
                  ? 'var(--accent-text)'
                  : lowTime
                    ? 'var(--danger)'
                    : 'var(--text-primary)',
              minWidth: '58px',
              textAlign: 'left',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {done ? '0:00' : fmt(remainingMs)}
          </span>
          <span
            style={{
              fontSize: '11px',
              color: done
                ? 'var(--accent-text)'
                : paused
                  ? 'var(--accent-dim)'
                  : 'var(--text-muted)',
              letterSpacing: 'var(--tracking-label)',
              textTransform: 'uppercase',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: done ? 700 : undefined,
            }}
          >
            {done ? 'REST DONE' : paused ? 'PAUSED' : `REST · ${exerciseName}`}
          </span>
        </button>

        {/* Pause / Resume — hidden once rest hits 0 (flash before unmount). */}
        {!done && (
        <button
          data-haptic="light"
          onClick={paused ? onResume : onPause}
          aria-label={paused ? 'Resume rest timer' : 'Pause rest timer'}
          style={{
            position: 'relative',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {paused ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--accent-text)' }}>
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          )}
        </button>
        )}

        {/* Adjust time (popover) — add or subtract from the countdown */}
        {!done && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            data-onboard="aw-rest-adjust"
            data-haptic="light"
            onClick={() => setAddOpen(o => !o)}
            aria-label="Adjust rest timer"
            aria-expanded={addOpen}
            style={{
              position: 'relative',
              backgroundColor: 'var(--surface)',
              border: `1px solid ${addOpen ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)',
              color: addOpen ? 'var(--accent-text)' : 'var(--text-primary)',
              fontSize: '18px',
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              cursor: 'pointer',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
            }}
          >
            ±
          </button>
          {addOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                right: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '6px',
                width: '198px',
                padding: '8px',
                backgroundColor: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                zIndex: 1,
                animation: 'popover-in 140ms ease',
              }}
            >
              {ADJUST_OPTIONS.map(opt => (
                <button
                  key={opt.sec}
                  data-haptic="light"
                  onClick={() => {
                    onAdd(opt.sec)
                    setAddOpen(false)
                  }}
                  style={{
                    position: 'relative',
                    height: '34px',
                    borderRadius: 'var(--radius-pill, 9999px)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'transparent',
                    color: opt.sec < 0 ? 'var(--danger)' : 'var(--text-secondary)',
                    fontSize: '13px',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                    padding: '0 4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        )}

        <button
          data-haptic="light"
          onClick={onStop}
          aria-label={done ? 'Dismiss rest' : 'Skip rest'}
          style={{
            position: 'relative',
            backgroundColor: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            fontFamily: 'var(--font-sans)',
            fontWeight: 500,
            padding: '0 12px',
            cursor: 'pointer',
            height: '40px',
            flexShrink: 0,
          }}
        >
          {done ? 'OK' : 'SKIP'}
        </button>
      </div>

      {!done && (
      <button
        data-haptic="light"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Hide default rest options' : 'Show default rest options'}
        aria-expanded={open}
        style={{
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          width: '100%',
          height: '14px',
          marginTop: '-6px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: 'var(--text-muted)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 200ms ease',
          }}
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
      )}

      {open && !done && (
        <div
          style={{
            padding: '8px 16px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
            animation: 'popover-in 140ms ease',
          }}
        >
          <span
            style={{
              fontSize: '10px',
              letterSpacing: 'var(--tracking-label)',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              marginRight: '4px',
            }}
          >
            Default rest
          </span>
          {REST_PRESETS.map(sec => {
            const selected = rest === sec
            return (
              <button
                key={sec}
                data-haptic="light"
                onClick={() => {
                  setExerciseRest(exerciseId, sec)
                  setRest(sec)
                }}
                aria-pressed={selected}
                style={{
                  position: 'relative',
                  height: '32px',
                  minWidth: '52px',
                  borderRadius: 'var(--radius-pill, 9999px)',
                  border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                  backgroundColor: selected ? 'var(--accent-wash)' : 'transparent',
                  color: selected ? 'var(--accent-text)' : 'var(--text-secondary)',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  padding: '0 12px',
                }}
              >
                {sec}s
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
