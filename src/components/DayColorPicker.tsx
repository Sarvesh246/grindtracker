'use client'

import { useEffect, useMemo, useState } from 'react'
import DayCardPreview from '@/components/DayCardPreview'
import SectionLabel from '@/components/ui/SectionLabel'
import { useTheme } from '@/lib/contexts/ThemeContext'
import {
  DAY_COLOR_PRESETS,
  categoryColorKey,
  isDayColorPreset,
  normalizeDayColor,
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
  /** Persist a hex, or `null` to restore the default. */
  onCommit: (hex: string | null) => void
  saving?: boolean
  error?: string
}) {
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const colorKey = categoryColorKey(dayKey, category ? { [dayKey]: category } : {})
  const derivedDark = resolveDayColor(colorKey, extraTypes, false)

  // Local draft so the preview tracks the native picker before the save lands.
  const [draft, setDraft] = useState<string | null>(overrideHex)
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

  function pick(hex: string) {
    const n = normalizeDayColor(hex)
    if (!n) return
    setDraft(n)
    onCommit(n)
  }

  function reset() {
    setDraft(null)
    onCommit(null)
  }

  return (
    <div style={{ padding: '20px 16px 32px' }}>
      <SectionLabel style={{ marginBottom: '10px' }}>Preview</SectionLabel>
      <DayCardPreview
        dayKey={dayKey}
        category={category}
        isFlex={isFlex}
        description={description}
        fillColor={fillColor}
        labelColor={labelColor}
        upNext
      />
      <div style={{
        fontFamily: "'DM Sans', sans-serif",
        fontSize: '12px',
        color: 'var(--text-muted)',
        marginTop: '8px',
        marginBottom: '22px',
      }}>
        Same card as Log — title, icon, and the UP NEXT pill pick up the color.
      </div>

      <SectionLabel style={{ marginBottom: '12px' }}>Presets</SectionLabel>
      <div
        role="listbox"
        aria-label="Day color presets"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: '12px',
          marginBottom: '22px',
        }}
      >
        {DAY_COLOR_PRESETS.map(hex => {
          const selected = selectedPreset === hex && !customSelected
          return (
            <button
              key={hex}
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={`Color ${hex}`}
              data-haptic="light"
              className="press"
              disabled={saving}
              onClick={() => pick(hex)}
              style={{
                width: '100%',
                aspectRatio: '1',
                borderRadius: '50%',
                backgroundColor: hex,
                border: selected ? '3px solid var(--text-primary)' : '2px solid transparent',
                boxShadow: selected
                  ? `0 0 0 2px var(--bg), 0 0 0 4px ${hex}`
                  : 'inset 0 0 0 1px rgba(0,0,0,0.18)',
                cursor: saving ? 'default' : 'pointer',
                padding: 0,
                minWidth: '44px',
                minHeight: '44px',
                opacity: saving ? 0.6 : 1,
              }}
            />
          )
        })}
      </div>

      <SectionLabel style={{ marginBottom: '12px' }}>Custom</SectionLabel>
      <label
        className="press"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          width: '100%',
          boxSizing: 'border-box',
          backgroundColor: 'var(--surface-elevated)',
          border: customSelected ? `1px solid ${pickerValue}` : '1px solid var(--border)',
          borderRadius: '12px',
          padding: '12px 14px',
          cursor: saving ? 'default' : 'pointer',
          opacity: saving ? 0.6 : 1,
        }}
      >
        <input
          type="color"
          value={pickerValue}
          disabled={saving}
          aria-label="Custom day color"
          onChange={e => pick(e.target.value)}
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
        <span
          aria-hidden
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            backgroundColor: pickerValue,
            flexShrink: 0,
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.18)',
            backgroundImage: customSelected
              ? undefined
              : `conic-gradient(from 180deg, #c8f135, #38bdf8, #fb923c, #a78bfa, #f472b6, #34d399, #c8f135)`,
          }}
        />
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
          <span style={{
            display: 'block',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '12px',
            color: 'var(--text-muted)',
            letterSpacing: '0.4px',
          }}>
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

      {pending != null && (
        <button
          type="button"
          data-haptic="light"
          className="press"
          disabled={saving}
          onClick={reset}
          style={{
            marginTop: '16px',
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
      )}

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
