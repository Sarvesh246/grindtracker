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

const ADD_OPTIONS: { label: string; sec: number }[] = [
  { label: '+15s', sec: 15 },
  { label: '+30s', sec: 30 },
  { label: '+1:00', sec: 60 },
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
  const lowTime = !paused && remainingMs <= 10_000

  return (
    <div
      role="status"
      aria-live="polite"
      className="wo-fixed-bar"
      style={{
        position: 'fixed',
        // Drop to the true physical bottom. Under viewport-fit=cover this is 0
        // (env = the indicator height); without cover env is 0, so this pushes the
        // bar down by the indicator height into that zone instead of resting above it.
        bottom: 'calc(env(safe-area-inset-bottom) - 34px)',
        paddingBottom: '8px',
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
            width: `${pct}%`,
            backgroundColor: lowTime ? 'var(--danger)' : 'var(--accent)',
            opacity: paused ? 0.4 : 1,
            transition: 'width 250ms linear, background-color 200ms ease, opacity 200ms ease',
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 16px', gap: '10px' }}>
        <button
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Collapse rest timer' : 'Expand rest timer'}
          aria-expanded={open}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
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
              color: paused ? 'var(--text-muted)' : lowTime ? 'var(--danger)' : 'var(--text-primary)',
              minWidth: '58px',
              textAlign: 'left',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmt(remainingMs)}
          </span>
          <span
            style={{
              fontSize: '11px',
              color: paused ? 'var(--accent-dim)' : 'var(--text-muted)',
              letterSpacing: 'var(--tracking-label)',
              textTransform: 'uppercase',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {paused ? 'PAUSED' : `REST · ${exerciseName}`}
          </span>
        </button>

        {/* Pause / Resume */}
        <button
          onClick={paused ? onResume : onPause}
          aria-label={paused ? 'Resume rest timer' : 'Pause rest timer'}
          style={{
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--accent)' }}>
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          )}
        </button>

        {/* Add time (popover) */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setAddOpen(o => !o)}
            aria-label="Add time to rest timer"
            aria-expanded={addOpen}
            style={{
              backgroundColor: 'var(--surface)',
              border: `1px solid ${addOpen ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)',
              color: addOpen ? 'var(--accent)' : 'var(--text-primary)',
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
            +
          </button>
          {addOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                right: 0,
                display: 'flex',
                gap: '6px',
                padding: '8px',
                backgroundColor: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                zIndex: 1,
              }}
            >
              {ADD_OPTIONS.map(opt => (
                <button
                  key={opt.sec}
                  onClick={() => {
                    onAdd(opt.sec)
                    setAddOpen(false)
                  }}
                  style={{
                    height: '34px',
                    minWidth: '52px',
                    borderRadius: 'var(--radius-pill, 9999px)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'transparent',
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                    padding: '0 12px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onStop}
          aria-label="Skip rest"
          style={{
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
          SKIP
        </button>
      </div>

      {open && (
        <div
          style={{
            padding: '0 16px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
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
                onClick={() => {
                  setExerciseRest(exerciseId, sec)
                  setRest(sec)
                }}
                aria-pressed={selected}
                style={{
                  height: '32px',
                  minWidth: '52px',
                  borderRadius: 'var(--radius-pill, 9999px)',
                  border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                  backgroundColor: selected ? 'rgba(200,241,53,0.12)' : 'transparent',
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
