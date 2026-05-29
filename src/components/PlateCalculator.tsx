'use client'
import { useEffect, useState } from 'react'
import { useUnit } from '@/lib/contexts/UnitContext'

// Plate / bar denominations differ by unit system. The calculator works entirely in the
// active display unit and converts back to canonical lbs at the apply boundary.
const PLATES_LB = [45, 35, 25, 10, 5, 2.5] as const
const BAR_PRESETS_LB = [45, 35, 25, 15] as const
const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const
const BAR_PRESETS_KG = [20, 15, 10] as const

function calcPerSide(target: number, bar: number, plates: readonly number[]): { plates: number[]; usable: number } {
  const each = (target - bar) / 2
  if (each <= 0) return { plates: [], usable: 0 }
  const out: number[] = []
  let left = each
  for (const p of plates) {
    while (left >= p - 0.0001) {
      out.push(p)
      left -= p
    }
  }
  const usable = target - left * 2
  return { plates: out, usable }
}

function getStoredBar(unitLabel: 'kg' | 'lbs'): number {
  const fallback = unitLabel === 'kg' ? 20 : 45
  if (typeof window === 'undefined') return fallback
  const v = Number(localStorage.getItem(`grind.barWeight.${unitLabel}`))
  return Number.isFinite(v) && v > 0 ? v : fallback
}

interface Props {
  /** Target weight in the active display unit. */
  initialTarget?: number
  onClose: () => void
  /** Receives the chosen weight converted back to canonical lbs. */
  onApply: (weight: number) => void
}

export default function PlateCalculator({ initialTarget, onClose, onApply }: Props) {
  const { unitLabel, fromDisplay } = useUnit()
  const metric = unitLabel === 'kg'
  const plateSet = metric ? PLATES_KG : PLATES_LB
  const barPresets = metric ? BAR_PRESETS_KG : BAR_PRESETS_LB

  const [bar, setBar] = useState<number>(() => getStoredBar(unitLabel))
  const [target, setTarget] = useState<string>(
    initialTarget && initialTarget > 0 ? String(Math.round(initialTarget * 10) / 10) : '',
  )

  useEffect(() => {
    localStorage.setItem(`grind.barWeight.${unitLabel}`, String(bar))
  }, [bar, unitLabel])

  const targetNum = Number(target)
  const valid = Number.isFinite(targetNum) && targetNum >= bar
  const { plates, usable } = valid ? calcPerSide(targetNum, bar, plateSet) : { plates: [], usable: 0 }
  const remainder = valid ? targetNum - usable : 0

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 600,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Plate calculator"
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
          border: '1px solid var(--border)',
          borderBottom: 'none',
          padding: '20px 16px calc(20px + env(safe-area-inset-bottom))',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '22px',
              color: 'var(--text-primary)',
              letterSpacing: '1px',
              fontWeight: 'normal',
            }}
          >
            PLATE CALCULATOR
          </h2>
          <button
            onClick={onClose}
            aria-label="Close plate calculator"
            style={{
              width: '40px',
              height: '40px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '20px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span
              style={{
                fontSize: '10px',
                letterSpacing: 'var(--tracking-label)',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
              }}
            >
              Target ({unitLabel})
            </span>
            <input
              type="number"
              inputMode="decimal"
              value={target}
              onChange={e => setTarget(e.target.value)}
              autoFocus
              style={{
                backgroundColor: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '18px',
                padding: '10px 12px',
              }}
            />
          </label>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span
              style={{
                fontSize: '10px',
                letterSpacing: 'var(--tracking-label)',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
              }}
            >
              Bar ({unitLabel})
            </span>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {barPresets.map(b => {
                const selected = bar === b
                return (
                  <button
                    key={b}
                    onClick={() => setBar(b)}
                    aria-pressed={selected}
                    style={{
                      height: '38px',
                      flex: '1 1 0',
                      minWidth: '46px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                      backgroundColor: selected ? 'rgba(200,241,53,0.1)' : 'var(--surface-elevated)',
                      color: selected ? 'var(--accent)' : 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {b}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px',
            minHeight: '120px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {valid && plates.length > 0 ? (
            <>
              <div
                style={{
                  fontSize: '10px',
                  letterSpacing: 'var(--tracking-label)',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                }}
              >
                Per side
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                {plates.map((p, i) => (
                  <span
                    key={i}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-pill, 9999px)',
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border)',
                      color: 'var(--accent)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px',
                    }}
                  >
                    {p}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Loads to{' '}
                <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {usable}
                </span>{' '}
                {unitLabel}
                {remainder > 0.01 && (
                  <>
                    {' '}
                    <span style={{ color: 'var(--danger)' }}>(off by {remainder.toFixed(1)})</span>
                  </>
                )}
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px', alignSelf: 'center', margin: 'auto' }}>
              Enter a target weight ≥ bar weight.
            </div>
          )}
        </div>

        <button
          onClick={() => {
            if (!valid) return
            onApply(fromDisplay(targetNum))
            onClose()
          }}
          disabled={!valid}
          style={{
            height: '48px',
            backgroundColor: valid ? 'var(--accent)' : 'var(--surface-elevated)',
            color: valid ? 'var(--bg)' : 'var(--text-disabled)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'var(--font-sans)',
            fontSize: '14px',
            fontWeight: 700,
            letterSpacing: '0.5px',
            cursor: valid ? 'pointer' : 'not-allowed',
          }}
        >
          USE {valid ? targetNum : '—'} {unitLabel.toUpperCase()}
        </button>
      </div>
    </div>
  )
}
