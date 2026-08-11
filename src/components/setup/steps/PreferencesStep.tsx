'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'
import { useUnit } from '@/lib/contexts/UnitContext'
import { useTheme } from '@/lib/contexts/ThemeContext'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import {
  REST_PRESETS,
  getDefaultRest,
  setDefaultRest,
} from '@/lib/hooks/useRestTimer'
import { haptic } from '@/lib/utils/haptics'

function formatRest(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s ? `${m}m ${s}s` : `${m}m`
}

function PillToggle({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  ariaLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        gap: '0',
        backgroundColor: 'var(--surface-elevated)',
        border: '1px solid var(--border)',
        borderRadius: '9999px',
        padding: '3px',
        position: 'relative',
      }}
    >
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            data-haptic="light"
            className="press"
            aria-pressed={active}
            onClick={() => {
              onChange(opt.value)
              haptic('light')
            }}
            style={{
              flex: 1,
              minHeight: '36px',
              padding: '0 14px',
              border: 'none',
              borderRadius: '9999px',
              backgroundColor: active ? 'var(--accent)' : 'transparent',
              color: active ? 'var(--on-accent)' : 'var(--text-muted)',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '13px',
              fontWeight: 700,
              letterSpacing: '0.4px',
              cursor: 'pointer',
              transition: 'background-color 150ms ease, color 150ms ease',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export default function PreferencesStep({ onContinue }: { onContinue: () => void }) {
  const { unit, setUnit } = useUnit()
  const { theme, setTheme } = useTheme()
  const { prefReduceMotion, setReduceMotion } = useMotionPref()
  const [rest, setRest] = useState(() => {
    const d = getDefaultRest()
    return (REST_PRESETS as readonly number[]).includes(d) ? d : 120
  })

  function handleContinue() {
    setDefaultRest(rest)
    onContinue()
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ marginBottom: '28px' }}>
        <h1
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '36px',
            letterSpacing: '1px',
            color: 'var(--text-primary)',
            fontWeight: 'normal',
            margin: 0,
            lineHeight: 1.05,
          }}
        >
          PREFERENCES
        </h1>
        <p
          style={{
            margin: '10px 0 0',
            fontSize: '15px',
            color: 'var(--text-secondary)',
            lineHeight: 1.45,
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          Units, look, and default rest — change anytime in Profile.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', flex: 1 }}>
        <div>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '8px',
            }}
          >
            Weight unit
          </div>
          <PillToggle
            ariaLabel="Weight unit"
            value={unit}
            onChange={v => setUnit(v as 'metric' | 'imperial')}
            options={[
              { value: 'metric', label: 'KG' },
              { value: 'imperial', label: 'LBS' },
            ]}
          />
        </div>

        <div>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '8px',
            }}
          >
            Theme
          </div>
          <PillToggle
            ariaLabel="Theme"
            value={theme}
            onChange={v => setTheme(v as 'dark' | 'light')}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
              Reduce motion
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Soften transitions in-app
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefReduceMotion}
            data-haptic="light"
            onClick={() => {
              setReduceMotion(!prefReduceMotion)
              haptic('light')
            }}
            style={{
              width: '48px',
              height: '28px',
              borderRadius: '9999px',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              backgroundColor: prefReduceMotion ? 'var(--accent)' : 'var(--surface-elevated)',
              boxShadow: prefReduceMotion ? 'none' : 'inset 0 0 0 1px var(--border)',
              position: 'relative',
              flexShrink: 0,
              transition: 'background-color 150ms ease',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: '3px',
                left: prefReduceMotion ? '23px' : '3px',
                width: '22px',
                height: '22px',
                borderRadius: '9999px',
                backgroundColor: prefReduceMotion ? 'var(--on-accent)' : 'var(--text-muted)',
                transition: 'left 150ms ease',
              }}
            />
          </button>
        </div>

        <div>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '8px',
            }}
          >
            Default rest
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {REST_PRESETS.map(sec => {
              const active = rest === sec
              return (
                <button
                  key={sec}
                  type="button"
                  data-haptic="light"
                  className="press"
                  aria-pressed={active}
                  onClick={() => {
                    setRest(sec)
                    haptic('light')
                  }}
                  style={{
                    minWidth: '64px',
                    height: '40px',
                    padding: '0 14px',
                    borderRadius: '9999px',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    backgroundColor: active ? 'var(--accent)' : 'var(--surface)',
                    color: active ? 'var(--on-accent)' : 'var(--text-secondary)',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {formatRest(sec)}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <Button
        type="button"
        variant="primary"
        size="lg"
        fullWidth
        data-haptic="light"
        onClick={handleContinue}
        style={{ height: '52px', fontSize: '16px', marginTop: '28px' }}
      >
        Continue
      </Button>
    </div>
  )
}
