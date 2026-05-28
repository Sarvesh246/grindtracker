'use client'
import { useEffect, useState } from 'react'
import { REST_PRESETS, getExerciseRest, setExerciseRest } from '@/lib/hooks/useRestTimer'

interface Props {
  exerciseId: string
  exerciseName: string
  remainingMs: number
  durationMs: number
  bottomOffsetPx?: number
  onStop: () => void
  onAdd: (sec: number) => void
}

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
  bottomOffsetPx = 0,
  onStop,
  onAdd,
}: Props) {
  const [open, setOpen] = useState(false)
  const [rest, setRest] = useState<number>(() => getExerciseRest(exerciseId))

  useEffect(() => {
    setRest(getExerciseRest(exerciseId))
  }, [exerciseId])

  const pct = durationMs > 0 ? Math.min(100, (remainingMs / durationMs) * 100) : 0
  const lowTime = remainingMs <= 10_000

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: `${bottomOffsetPx}px`,
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
            transition: 'width 250ms linear, background-color 200ms ease',
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', gap: '12px' }}>
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
              fontSize: '18px',
              color: lowTime ? 'var(--danger)' : 'var(--text-primary)',
              minWidth: '54px',
              textAlign: 'left',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmt(remainingMs)}
          </span>
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              letterSpacing: 'var(--tracking-label)',
              textTransform: 'uppercase',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            REST · {exerciseName}
          </span>
        </button>

        <button
          onClick={() => onAdd(30)}
          aria-label="Add 30 seconds"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            fontSize: '12px',
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            padding: '6px 10px',
            cursor: 'pointer',
            height: '36px',
          }}
        >
          +30s
        </button>

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
            padding: '6px 10px',
            cursor: 'pointer',
            height: '36px',
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
                  color: selected ? 'var(--accent)' : 'var(--text-secondary)',
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
