'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/lib/contexts/ToastContext'
import { localDateKey } from '@/lib/utils/formatting'
import {
  MAX_REST_WEEKDAYS,
  REST_PASS_LIMIT,
  REST_PASS_WINDOW_DAYS,
  WEEKDAYS,
  describeRestWeekdays,
  formatGapDay,
  passesRemaining,
  passesUsed,
} from '@/lib/utils/restDays'

/**
 * Rest-day settings — the "which days am I not training?" control, living inside
 * Profile → Settings as an expandable row so it sits beside the other prefs
 * instead of adding another top-level card to an already long page.
 *
 * Two things are configured here, and they are deliberately different:
 *   • the weekday chips are your PROGRAM (unlimited, free, edit any time);
 *   • the pass meter below is the ad-hoc rescue you spend from Home, shown here
 *     read-only so the allowance is discoverable BEFORE you need it.
 *
 * Saving a weekday change re-derives history: rest days change where streak runs
 * break, so `refresh_stats` has to run or the streak on Home would keep reflecting
 * the old schedule until the next workout. See docs/sql/14-rest-days.sql.
 */
export default function RestDaysCard({
  initialWeekdays,
  claimedDates,
}: {
  initialWeekdays: number[]
  /** `YYYY-MM-DD` keys of passes already claimed (newest window only). */
  claimedDates: string[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [weekdays, setWeekdays] = useState<number[]>(initialWeekdays)
  const [saving, setSaving] = useState(false)

  // Pass accounting is display-only here; `claim_rest_days` is the enforcement.
  const used = passesUsed(claimedDates)
  const left = passesRemaining(claimedDates)
  const recentClaims = useMemo(
    () => [...claimedDates].sort((a, b) => b.localeCompare(a)).slice(0, REST_PASS_LIMIT),
    [claimedDates],
  )

  async function commit(next: number[]) {
    const previous = weekdays
    setWeekdays(next)
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')

      const { error } = await supabase
        .from('user_rest_settings')
        .upsert(
          { user_id: user.id, weekdays: next, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        )
      if (error) throw error

      // Rest days move where streak runs break — settle the derived stats now,
      // in the viewer's own calendar day, so Home doesn't show a stale streak.
      await supabase.rpc('refresh_stats', { p_local_date: localDateKey(new Date()) })
      router.refresh()
    } catch {
      setWeekdays(previous)
      toast.show("Couldn't save your rest days. Try again.")
    } finally {
      setSaving(false)
    }
  }

  function toggle(value: number) {
    if (saving) return
    const selected = weekdays.includes(value)
    if (!selected && weekdays.length >= MAX_REST_WEEKDAYS) {
      toast.show('Keep at least one training day a week.')
      return
    }
    const next = selected
      ? weekdays.filter(v => v !== value)
      : [...weekdays, value].sort((a, b) => a - b)
    commit(next)
  }

  const summary = weekdays.length === 0
    ? 'No rest days set'
    : describeRestWeekdays(weekdays)

  return (
    <div data-onboard="profile-rest-days">
      {/* Row header — matches the other settings rows, plus a disclosure chevron. */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px', width: '100%',
          background: 'transparent', border: 'none', padding: 0,
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '2px' }}>
            Rest Days
          </div>
          <div style={{
            fontSize: '12px', color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {summary} · {left} of {REST_PASS_LIMIT} passes left
          </div>
        </div>
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '32px', height: '32px', flexShrink: 0,
          borderRadius: '9999px',
          backgroundColor: 'var(--surface-elevated)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transition: 'transform 150ms ease', transform: open ? 'rotate(180deg)' : 'none' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {open && (
        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Pick the days you plan not to train. Your streak carries straight over
            them — it just doesn&apos;t count them as workouts.
          </p>

          {/* Weekday chips. flex:1 with a minimum touch height keeps all seven on
              one row down to ~320px without any of them dropping below 40px. */}
          <div style={{ display: 'flex', gap: '6px' }} role="group" aria-label="Weekly rest days">
            {WEEKDAYS.map(day => {
              const on = weekdays.includes(day.value)
              return (
                <button
                  key={day.value}
                  onClick={() => toggle(day.value)}
                  aria-pressed={on}
                  aria-label={day.full}
                  title={day.full}
                  disabled={saving}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: '44px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: on ? 'var(--accent)' : 'var(--surface-elevated)',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                    color: on ? 'var(--on-accent)' : 'var(--text-secondary)',
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: saving ? 'default' : 'pointer',
                    opacity: saving ? 0.6 : 1,
                    transition: 'background-color 150ms ease, border-color 150ms ease, color 150ms ease',
                  }}
                >
                  {day.letter}
                </button>
              )
            })}
          </div>

          {/* Pass meter — read-only here; passes are spent from Home when a day
              actually slips, which is the only moment the choice is meaningful. */}
          <div style={{
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '10px', marginBottom: '8px',
            }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Rest passes
              </span>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '13px',
                color: left > 0 ? 'var(--accent-text)' : 'var(--text-muted)',
              }}>
                {left}/{REST_PASS_LIMIT}
              </span>
            </div>

            {/* One pip per pass, so "what's left" is legible without reading. */}
            <div style={{ display: 'flex', gap: '5px', marginBottom: '8px' }} aria-hidden>
              {Array.from({ length: REST_PASS_LIMIT }, (_, i) => (
                <span
                  key={i}
                  style={{
                    flex: 1,
                    height: '5px',
                    borderRadius: '9999px',
                    backgroundColor: i < left ? 'var(--accent)' : 'var(--border)',
                  }}
                />
              ))}
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {`Miss a day that isn't scheduled rest and GRIND offers you a pass from the home screen. ${REST_PASS_LIMIT} per ${REST_PASS_WINDOW_DAYS} days.`}
            </div>

            {used > 0 && (
              <div style={{ fontSize: '11px', color: 'var(--text-disabled)', marginTop: '6px' }}>
                Recently used: {recentClaims.map(formatGapDay).join(' · ')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
