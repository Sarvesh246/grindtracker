'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import Button from '@/components/ui/Button'
import { haptic } from '@/lib/utils/haptics'

const REST_DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] // 0=Sun..6=Sat
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function RestDaysStep({
  supabase,
  userId,
  initialRestDays,
  onContinue,
}: {
  supabase: SupabaseClient
  userId: string
  initialRestDays: number[]
  onContinue: () => void
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(initialRestDays),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(day: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
    haptic('light')
  }

  async function handleContinue() {
    setSaving(true)
    setError(null)
    const existing = new Set(initialRestDays)
    const next = selected
    const toInsert = [...next].filter(d => !existing.has(d))
    const toDelete = [...existing].filter(d => !next.has(d))

    try {
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from('user_rest_days')
          .delete()
          .eq('user_id', userId)
          .in('day_of_week', toDelete)
        if (delErr) throw delErr
      }
      if (toInsert.length > 0) {
        const { error: insErr } = await supabase.from('user_rest_days').insert(
          toInsert.map(day_of_week => ({ user_id: userId, day_of_week })),
        )
        if (insErr) throw insErr
      }
      onContinue()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save rest days.')
      setSaving(false)
    }
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
          REST DAYS
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
          Weekly days off that don&apos;t break your streak. None is fine.
        </p>
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
          {REST_DAY_LABELS.map((label, dayOfWeek) => {
            const active = selected.has(dayOfWeek)
            return (
              <button
                key={dayOfWeek}
                type="button"
                data-haptic="light"
                className="press"
                aria-pressed={active}
                aria-label={`${DAY_NAMES[dayOfWeek]} rest day`}
                onClick={() => toggle(dayOfWeek)}
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '9999px',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  backgroundColor: active ? 'var(--accent)' : 'var(--surface)',
                  color: active ? 'var(--on-accent)' : 'var(--text-muted)',
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'all 150ms ease',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
        {error && (
          <div
            role="alert"
            style={{
              marginTop: '16px',
              fontSize: '13px',
              color: 'var(--danger)',
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {error}
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="primary"
        size="lg"
        fullWidth
        data-haptic="light"
        disabled={saving}
        onClick={handleContinue}
        style={{ height: '52px', fontSize: '16px', marginTop: '24px' }}
      >
        {saving ? 'Saving…' : 'Continue'}
      </Button>
    </div>
  )
}
