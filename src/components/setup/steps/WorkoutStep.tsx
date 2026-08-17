'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import Button from '@/components/ui/Button'
import { WORKOUT_TEMPLATES } from '@/lib/utils/workoutTemplates'
import { applyWorkoutTemplate } from '@/lib/utils/applyWorkoutTemplate'
import type { DayCategory } from '@/lib/types'
import { useKeyboardInset } from '@/lib/hooks/useKeyboardInset'
import { slugDayKey } from '@/lib/utils/dayKeys'

const CATEGORIES: { value: DayCategory; label: string }[] = [
  { value: 'push', label: 'Push' },
  { value: 'pull', label: 'Pull' },
  { value: 'legs', label: 'Legs' },
  { value: 'other', label: 'Other' },
]

type Mode = 'choose' | 'custom'

export default function WorkoutStep({
  supabase,
  userId,
  hasExistingProgram,
  onFinish,
  finishing,
}: {
  supabase: SupabaseClient
  userId: string
  /** When true, hide templates to avoid duplicate inserts. */
  hasExistingProgram: boolean
  onFinish: () => void | Promise<void>
  finishing: boolean
}) {
  const [mode, setMode] = useState<Mode>('choose')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState(hasExistingProgram)
  const [dayName, setDayName] = useState('')
  const [category, setCategory] = useState<DayCategory>('push')
  const keyboardInset = useKeyboardInset()

  const locked = busy || finishing

  async function handleTemplate(templateId: string) {
    if (locked || applied) return
    setBusy(true)
    setError(null)
    try {
      const result = await applyWorkoutTemplate(supabase, userId, templateId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setApplied(true)
      await onFinish()
    } catch {
      setError('Could not set up your template. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleKeepCurrent() {
    if (locked) return
    setBusy(true)
    try {
      await onFinish()
    } finally {
      setBusy(false)
    }
  }

  async function handleSkip() {
    if (locked) return
    setBusy(true)
    try {
      await onFinish()
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateCustomDay() {
    const key = slugDayKey(dayName)
    if (!key) {
      setError('Enter a day name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Day only — no exercises yet (user fills sets in Log manager).
      const { error: catErr } = await supabase.from('user_day_categories').upsert(
        { user_id: userId, day_key: key, category },
        { onConflict: 'user_id,day_key' },
      )
      if (catErr) {
        setError(catErr.message)
        return
      }
      // Seed rotation with the single day so Home has a suggestion.
      const { error: rotErr } = await supabase.from('user_rotation').upsert(
        {
          user_id: userId,
          mode: 'manual',
          sequence: [key],
          current_index: -1,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      if (rotErr) {
        setError(rotErr.message)
        return
      }
      await onFinish()
    } catch {
      setError('Could not create day. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'custom') {
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
        <div style={{ marginBottom: '24px' }}>
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
            BUILD YOUR OWN
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
            Create your first day. Add exercises from Log → Manage anytime.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
          <div>
            <label
              htmlFor="setup-day-name"
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                marginBottom: '6px',
              }}
            >
              DAY NAME
            </label>
            <input
              id="setup-day-name"
              type="text"
              value={dayName}
              onChange={e => setDayName(e.target.value)}
              placeholder="e.g. Push"
              maxLength={32}
              style={{
                width: '100%',
                padding: '14px 16px',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                color: 'var(--text-primary)',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '16px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                marginBottom: '8px',
              }}
            >
              LEADERBOARD CATEGORY
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {CATEGORIES.map(c => {
                const active = category === c.value
                return (
                  <button
                    key={c.value}
                    type="button"
                    data-haptic="light"
                    className="press"
                    aria-pressed={active}
                    onClick={() => {
                      setCategory(c.value)
                    }}
                    style={{
                      height: '36px',
                      padding: '0 14px',
                      borderRadius: '9999px',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      backgroundColor: active ? 'var(--accent)' : 'var(--surface)',
                      color: active ? 'var(--on-accent)' : 'var(--text-secondary)',
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
          {error && (
            <div role="alert" style={{ fontSize: '13px', color: 'var(--danger)' }}>
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
            disabled={locked || !dayName.trim()}
            onClick={handleCreateCustomDay}
            style={{ height: '52px', fontSize: '16px' }}
          >
            {locked ? 'Finishing…' : 'Create day & finish'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            fullWidth
            disabled={locked}
            onClick={() => {
              setMode('choose')
              setError(null)
            }}
            style={{ height: '48px' }}
          >
            Back to choices
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ marginBottom: '22px' }}>
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
          WORKOUTS
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
          {applied
            ? 'You already have a program. Keep it, or finish without changes.'
            : 'Start from a template, build a day, or set this up later.'}
        </p>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          minHeight: 0,
          paddingBottom: '8px',
        }}
      >
        {applied && (
          <button
            type="button"
            data-haptic="light"
            className="press-card"
            disabled={locked}
            onClick={handleKeepCurrent}
            style={{
              textAlign: 'left',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid var(--accent)',
              backgroundColor: 'var(--accent-wash)',
              cursor: locked ? 'default' : 'pointer',
            }}
          >
            <div
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 700,
                fontSize: '14px',
                color: 'var(--accent-text)',
                marginBottom: '4px',
              }}
            >
              Keep my current program
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Finish setup without changing your days or exercises.
            </div>
          </button>
        )}

        {!applied &&
          WORKOUT_TEMPLATES.map(t => (
            <button
              key={t.id}
              type="button"
              data-haptic="light"
              className="press-card"
              disabled={locked}
              onClick={() => handleTemplate(t.id)}
              style={{
                textAlign: 'left',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
                cursor: locked ? 'default' : 'pointer',
                opacity: locked ? 0.7 : 1,
              }}
            >
              <div
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 700,
                  fontSize: '14px',
                  color: 'var(--text-primary)',
                  marginBottom: '4px',
                }}
              >
                {t.label.replace(/^USE\s+/i, '')}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {t.description}
              </div>
            </button>
          ))}

        {!applied && (
          <button
            type="button"
            data-haptic="light"
            className="press-card"
            disabled={locked}
            onClick={() => {
              setMode('custom')
              setError(null)
            }}
            style={{
              textAlign: 'left',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface)',
              cursor: locked ? 'default' : 'pointer',
            }}
          >
            <div
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 700,
                fontSize: '14px',
                color: 'var(--text-primary)',
                marginBottom: '4px',
              }}
            >
              Build my own
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Create a day name now — add exercises when you&apos;re ready.
            </div>
          </button>
        )}

        <button
          type="button"
          data-haptic="light"
          className="press-card"
          disabled={locked}
          onClick={handleSkip}
          style={{
            textAlign: 'left',
            padding: '16px',
            borderRadius: '12px',
            border: '1px solid var(--border)',
            backgroundColor: 'transparent',
            cursor: locked ? 'default' : 'pointer',
          }}
        >
          <div
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 700,
              fontSize: '14px',
              color: 'var(--text-secondary)',
              marginBottom: '4px',
            }}
          >
            I&apos;ll set this up later
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            Leave the catalog blank and finish setup.
          </div>
        </button>

        {error && (
          <div role="alert" style={{ fontSize: '13px', color: 'var(--danger)', marginTop: '4px' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
