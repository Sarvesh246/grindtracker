'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import DayCardPreview from '@/components/DayCardPreview'
import SectionLabel from '@/components/ui/SectionLabel'
import { useTheme } from '@/lib/contexts/ThemeContext'
import {
  DAY_COLOR_PRESETS,
  categoryColorKey,
  isDayColorPreset,
  normalizeDayColor,
  onDayFill,
  resolveDayColor,
  resolveDayTextColor,
} from '@/lib/utils/dayColors'

export default function DayColorPicker({
  dayKey,
  category,
  isFlex,
  description,
  extraTypes,
  overrideHex,
  exerciseCount,
  onCommit,
  saving = false,
  error = '',
}: {
  dayKey: string
  category?: string | null
  isFlex?: boolean
  description?: string
  extraTypes: string[]
  /** Saved override, or null when using the derived default. */
  overrideHex: string | null
  exerciseCount?: number
  /** Persist a hex, or `null` to restore the default. */
  onCommit: (hex: string | null) => void
  saving?: boolean
  error?: string
}) {
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const colorKey = categoryColorKey(dayKey, category ? { [dayKey]: category } : {})
  const derivedDark = resolveDayColor(colorKey, extraTypes, false)

  const [draft, setDraft] = useState<string | null>(overrideHex)
  const [upNext, setUpNext] = useState(true)
  const [flashKey, setFlashKey] = useState(0)
  useEffect(() => { setDraft(overrideHex) }, [overrideHex, dayKey])

  const pending = draft
  const fillColor = resolveDayColor(colorKey, extraTypes, isLight, pending)
  const labelColor = resolveDayTextColor(colorKey, extraTypes, isLight, pending)
  const pickerValue = pending ?? derivedDark
  const customSelected = pending != null && !isDayColorPreset(pending)

  const selectedPreset = useMemo(() => {
    const hex = pending ?? derivedDark
    return isDayColorPreset(hex) ? hex : null
  }, [pending, derivedDark])

  function pick(hex: string, pulse = true) {
    const n = normalizeDayColor(hex)
    if (!n) return
    const changed = n !== (pending ?? derivedDark)
    setDraft(n)
    if (pulse && changed) setFlashKey(k => k + 1)
    onCommit(n)
  }

  function reset() {
    if (pending == null) return
    setDraft(null)
    setFlashKey(k => k + 1)
    onCommit(null)
  }

  return (
    <div
      className="day-color-picker swap-in"
      style={{
        '--day-fill': fillColor,
        '--day-label': labelColor,
      } as CSSProperties}
    >
      <div className="day-color-picker__stage">
        <div className="day-color-picker__glow" aria-hidden />
        <DayCardPreview
          dayKey={dayKey}
          category={category}
          isFlex={isFlex}
          description={description}
          fillColor={fillColor}
          labelColor={labelColor}
          upNext={upNext}
          exerciseCount={exerciseCount}
          flashKey={flashKey > 0 ? String(flashKey) : undefined}
        />
      </div>

      <div className="day-color-modes" role="tablist" aria-label="Card preview">
        <span className="day-color-modes__thumb" data-pos={upNext ? 'next' : 'idle'} />
        <button
          type="button"
          role="tab"
          className="day-color-modes__btn"
          aria-selected={!upNext}
          data-haptic="light"
          onClick={() => setUpNext(false)}
        >
          Idle
        </button>
        <button
          type="button"
          role="tab"
          className="day-color-modes__btn"
          aria-selected={upNext}
          data-haptic="light"
          onClick={() => setUpNext(true)}
        >
          Up next
        </button>
      </div>

      <SectionLabel style={{ marginBottom: '12px' }}>Presets</SectionLabel>
      <div
        className="day-color-swatches stagger"
        role="listbox"
        aria-label="Day color presets"
      >
        {DAY_COLOR_PRESETS.map((hex, i) => {
          const selected = selectedPreset === hex && !customSelected
          return (
            <button
              key={hex}
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={`Color ${hex}`}
              data-haptic="medium"
              className="day-color-swatch"
              onClick={() => pick(hex)}
              style={{
                '--i': i,
                '--day-swatch': hex,
                '--day-on-fill': onDayFill(hex),
              } as CSSProperties}
            >
              <span className="day-color-swatch__fill" />
              <span className="day-color-swatch__check" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            </button>
          )
        })}
      </div>

      <SectionLabel style={{ marginBottom: '12px' }}>Custom</SectionLabel>
      <label
        className="day-color-custom"
        data-on={customSelected ? 'true' : 'false'}
        style={{
          '--day-fill': pickerValue,
        } as CSSProperties}
      >
        <input
          type="color"
          value={pickerValue}
          aria-label="Custom day color"
          data-haptic="medium"
          onChange={e => pick(e.target.value, false)}
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0,
            width: '100%',
            height: '100%',
            cursor: saving ? 'default' : 'pointer',
            border: 0,
            WebkitAppearance: 'none',
            appearance: 'none',
          }}
        />
        <span className="day-color-custom__spectrum" aria-hidden />
        <span style={{ flex: 1, minWidth: 0, pointerEvents: 'none' }}>
          <span style={{
            display: 'block',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: '2px',
          }}>
            {customSelected ? 'Custom color' : 'Pick any color'}
          </span>
          <span className="day-color-custom__hex">
            {pickerValue.toUpperCase()}
          </span>
        </span>
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: 'var(--text-muted)', flexShrink: 0, pointerEvents: 'none' }}
          aria-hidden
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </label>

      <div className="drawer" data-open={pending != null ? 'true' : undefined}>
        <div>
          <div style={{ paddingTop: '4px' }} inert={pending == null ? true : undefined}>
            <button
              type="button"
              data-haptic="light"
              className="press"
              disabled={pending == null}
              onClick={reset}
              style={{
                marginTop: '12px',
                width: '100%',
                height: '44px',
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                color: 'var(--text-secondary)',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '14px',
                fontWeight: 600,
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              Use default color
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          marginTop: '14px',
          fontSize: '13px',
          color: 'var(--danger)',
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {error}
        </div>
      )}
    </div>
  )
}
