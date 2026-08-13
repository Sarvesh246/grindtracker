'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import Button from '@/components/ui/Button'
import { useUnit } from '@/lib/contexts/UnitContext'
import { localDateKey } from '@/lib/utils/formatting'
import { useKeyboardInset } from '@/lib/hooks/useKeyboardInset'

export default function BodyWeightStep({
  supabase,
  userId,
  initialWeightLbs,
  onContinue,
  onSkip,
}: {
  supabase: SupabaseClient
  userId: string
  initialWeightLbs: number | null
  onContinue: () => void
  onSkip: () => void
}) {
  const { unitLabel, fromDisplay, fmt } = useUnit()
  const [value, setValue] = useState(
    initialWeightLbs != null ? fmt(initialWeightLbs) : '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyboardInset = useKeyboardInset()

  async function handleContinue() {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) {
      setError(`Enter a weight in ${unitLabel}.`)
      return
    }
    if (saving) return

    setSaving(true)
    setError(null)
    const canonical = fromDisplay(n)
    const { error: upsertErr } = await supabase.from('body_weights').upsert(
      {
        user_id: userId,
        weight: canonical,
        recorded_at: localDateKey(),
      },
      { onConflict: 'user_id,recorded_at' },
    )

    if (upsertErr) {
      setError(upsertErr.message)
      setSaving(false)
      return
    }
    setSaving(false)
    onContinue()
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        paddingBottom: keyboardInset > 0 ? keyboardInset : 0,
        transition: 'padding-bottom 180ms ease',
      }}
    >
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
          BODY WEIGHT
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
          Optional baseline for today. Skip if you&apos;d rather log later.
        </p>
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: '10px' }}>
          <input
            type="number"
            inputMode="decimal"
            value={value}
            onChange={e => {
              setValue(e.target.value)
              setError(null)
            }}
            placeholder="0"
            aria-label={`Body weight in ${unitLabel}`}
            style={{
              flex: 1,
              padding: '16px 18px',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '28px',
              outline: 'none',
              boxSizing: 'border-box',
              minWidth: 0,
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0 16px',
              borderRadius: '12px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-elevated)',
              color: 'var(--text-secondary)',
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 700,
              fontSize: '14px',
              letterSpacing: '0.5px',
            }}
          >
            {unitLabel}
          </div>
        </div>
        {error && (
          <div
            role="alert"
            style={{
              marginTop: '12px',
              fontSize: '13px',
              color: 'var(--danger)',
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '24px' }}>
        <Button
          type="button"
          variant="primary"
          size="lg"
          fullWidth
          data-haptic="light"
          disabled={saving}
          onClick={handleContinue}
          style={{ height: '52px', fontSize: '16px' }}
        >
          {saving ? 'Saving…' : 'Continue'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          fullWidth
          data-haptic="light"
          disabled={saving}
          onClick={onSkip}
          style={{ height: '48px', fontSize: '15px' }}
        >
          Skip
        </Button>
      </div>
    </div>
  )
}
