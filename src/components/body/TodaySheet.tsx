'use client'
import Link from 'next/link'
import { ChevronRight } from '@/components/ui/Icons'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import Dialog from '@/components/ui/Dialog'
import { createClient, getClientUser } from '@/lib/supabase/client'
import { computeCharge, dayStory, type DayWorkout } from '@/lib/body'
import type { BodySummary } from '@/lib/body/queries'
import DayTide from './DayTide'
import { Ring, adviceBody } from './ChargeRing'
import { dayTitle } from './useBodySummary'

/**
 * YOUR DAY: the bottom sheet behind Home's Charge ring. Today leads with the
 * Charge verdict, then the tide, the day told as up to four lines, three stats
 * and Charge's working. Swipe (or the segmented control) for the last seven
 * days as rings. Every block hides itself when its data isn't there.
 */

type Pane = 'today' | 'week'

const labelStyle: CSSProperties = {
  fontSize: '11px',
  letterSpacing: 'var(--tracking-label)',
  textTransform: 'uppercase',
  fontWeight: 500,
  color: 'var(--text-muted)',
}

function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function weekdayShort(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
}

function weekdayLong(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })
}

export default function TodaySheet({
  open,
  onClose,
  summary,
  workouts: workoutsProp,
}: {
  open: boolean
  onClose: () => void
  summary: BodySummary
  /** Today's finished workouts; loaded here when omitted. */
  workouts?: DayWorkout[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [pane, setPane] = useState<Pane>('today')
  const [loadedWorkouts, setWorkouts] = useState<DayWorkout[]>([])
  const workouts = workoutsProp ?? loadedWorkouts
  const { charge, todayRow, today, days, sessions } = summary

  // Today's finished workouts, for the tide's windows and their story lines.
  useEffect(() => {
    if (!open || workoutsProp) return
    let cancelled = false
    void (async () => {
      const user = await getClientUser(supabase)
      if (!user || cancelled) return
      const { data, error } = await supabase
        .from('sessions')
        .select('day_type, started_at, completed_at')
        .eq('user_id', user.id)
        .eq('local_date', today)
        .not('completed_at', 'is', null)
        .order('started_at')
      if (cancelled || error) return
      setWorkouts(
        (data ?? [])
          .filter(s => s.started_at)
          .map(s => ({ name: dayTitle(s.day_type as string), started_at: s.started_at as string, completed_at: s.completed_at as string })),
      )
    })()
    return () => { cancelled = true }
  }, [open, supabase, today, workoutsProp])

  const story = todayRow ? dayStory(todayRow, workouts, true) : []
  const hasTide = !!todayRow && [...(todayRow.bb_series ?? []), ...(todayRow.stress_series ?? [])].some(v => v != null)

  const week = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const date = shiftKey(today, i - 6)
      return {
        date,
        charge: date === today
          ? charge
          : computeCharge(days, sessions, date, { readiness: summary.readinessChecks, strength: summary.strengthSets }),
      }
    }),
    [days, sessions, today, charge, summary.readinessChecks, summary.strengthSets],
  )
  const weekSentence = useMemo(() => {
    const scored = week.filter(d => d.charge)
    if (scored.length === 0) return 'Not enough watch data this week to score your Charge yet.'
    const avg = Math.round(scored.reduce((s, d) => s + (d.charge as NonNullable<typeof d.charge>).score, 0) / scored.length)
    if (scored.length === 1) return `One day scored so far: ${avg}.`
    const best = scored.reduce((a, b) => ((b.charge?.score ?? 0) > (a.charge?.score ?? 0) ? b : a))
    const bestDay = best.date === today ? 'today' : `on ${weekdayLong(best.date)}`
    return `Your Charge averaged ${avg} over ${scored.length} scored days, highest ${bestDay}.`
  }, [week, today])

  // Horizontal swipe between the two panes. Vertical drags scroll as usual.
  const drag = useRef<{ x: number; y: number } | null>(null)
  function onPointerDown(e: ReactPointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY }
  }
  function onPointerUp(e: ReactPointerEvent) {
    const start = drag.current
    drag.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    setPane(dx < 0 ? 'week' : 'today')
  }

  const stats: { label: string; value: string | null }[] = todayRow
    ? [
        { label: 'Steps', value: todayRow.steps != null ? todayRow.steps.toLocaleString('en-US') : null },
        { label: 'Rest HR', value: todayRow.resting_hr != null ? String(todayRow.resting_hr) : null },
        { label: 'Recovery (h)', value: todayRow.recovery_hours != null ? String(todayRow.recovery_hours) : null },
      ]
    : []
  const showStats = stats.some(s => s.value != null)

  const tideLabel = charge
    ? `Today's Body Battery as a tide${workouts.length ? `, with ${workouts.length} workout${workouts.length > 1 ? 's' : ''} marked` : ''}. ${story.map(l => l.lead + l.text).join(' ')}`
    : 'Today’s Body Battery and stress.'

  return (
    <Dialog open={open} onClose={onClose} labelledBy="today-sheet-title" panelStyle={{ maxWidth: '480px' }}>
      <div
        className="dlg-sheet-surface"
        style={{
          width: '100%',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderBottom: 'none',
          borderRadius: '20px 20px 0 0',
          padding: '20px 0 calc(24px + env(safe-area-inset-bottom))',
          maxHeight: '92dvh',
          overflowY: 'auto',
          overflowX: 'hidden',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', padding: '0 20px' }}>
          <div>
            <h2
              id="today-sheet-title"
              style={{ fontFamily: 'var(--font-display)', fontSize: '24px', letterSpacing: '1px', fontWeight: 'normal', color: 'var(--text-primary)', lineHeight: 1 }}
            >
              YOUR DAY
            </h2>
            {charge && (
              <div style={{ marginTop: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Charge{' '}
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{charge.score}</span>
                {' · '}
                <span style={{ color: 'var(--accent-text)', fontWeight: 600 }}>{charge.bandLabel}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press"
            style={{
              width: '44px', height: '44px', margin: '-10px -12px 0 0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '12px 20px 0' }}><Link href="/progress/health#recovery" onClick={onClose} data-haptic="light" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44, fontSize: 14, color: 'var(--accent-text)' }}>View all health<ChevronRight size={14} /></Link></div>
        {/* Segmented control */}
        <div style={{ padding: '16px 20px 0' }}>
          <div
            role="tablist"
            aria-label="Day or week"
            style={{
              display: 'flex', gap: '4px', padding: '4px',
              backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
            }}
          >
            {([['today', 'Today'], ['week', 'Last 7 days']] as const).map(([id, label]) => {
              const active = pane === id
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`today-tab-${id}`}
                  aria-selected={active}
                  aria-controls={`today-pane-${id}`}
                  className="press"
                  data-haptic="light"
                  onClick={() => setPane(id)}
                  style={{
                    flex: 1, height: '40px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                    backgroundColor: active ? 'var(--surface-elevated)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: active ? 600 : 500,
                    boxShadow: active ? 'inset 0 0 0 1px var(--border)' : 'none',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ overflow: 'hidden' }} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null }}>
          <div className="body-panes" style={{ transform: pane === 'today' ? 'translateX(0)' : 'translateX(-100%)' }}>
            {/* ── Today ─────────────────────────────────────────────── */}
            <section
              id="today-pane-today"
              role="tabpanel"
              aria-labelledby="today-tab-today"
              inert={pane !== 'today'}
              style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: '20px' }}
            >
              {charge && (
                <p style={{ fontSize: '15px', lineHeight: 1.45, color: 'var(--text-primary)', fontWeight: 500 }}>
                  {adviceBody(charge)}
                </p>
              )}

              {hasTide && todayRow && <DayTide row={todayRow} workouts={workouts} isToday ariaLabel={tideLabel} />}

              {story.length > 0 && (
                <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {story.map((line, i) => (
                    <li key={i} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: '10px', alignItems: 'baseline' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }}>{line.time}</span>
                      <span style={{ fontSize: '14px', lineHeight: 1.45, color: 'var(--text-secondary)' }}>
                        <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{line.lead}</strong>
                        {line.text}
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {showStats && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {stats.map(s => (
                    <div
                      key={s.label}
                      style={{
                        backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                        padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0,
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 600, color: s.value ? 'var(--text-primary)' : 'var(--text-muted)', lineHeight: 1 }}>
                        {s.value ?? '—'}
                      </span>
                      <span style={{ ...labelStyle, fontSize: '10px', whiteSpace: 'nowrap' }}>{s.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {charge && (
                <div>
                  <div style={{ ...labelStyle, marginBottom: '10px' }}>How Charge is made</div>
                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {charge.inputs.map(input => (
                      <li key={input.key} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                          <span style={{ flex: 1, fontSize: '13px', color: 'var(--text-secondary)' }}>{input.label}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-primary)' }}>{input.value}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', width: '40px', textAlign: 'right' }}>
                            {Math.round(input.weight * 100)}%
                          </span>
                        </div>
                        <div aria-hidden="true" style={{ height: '4px', borderRadius: '9999px', backgroundColor: 'var(--surface-elevated)', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.round(input.score)}%`, height: '100%', borderRadius: '9999px', backgroundColor: 'var(--accent)', opacity: 0.85 }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                    A training guide, not a medical measure.
                  </p>
                </div>
              )}
            </section>

            {/* ── Last 7 days ───────────────────────────────────────── */}
            <section
              id="today-pane-week"
              role="tabpanel"
              aria-labelledby="today-tab-week"
              inert={pane !== 'week'}
              style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: '20px' }}
            >
              <p style={{ fontSize: '15px', lineHeight: 1.45, color: 'var(--text-primary)', fontWeight: 500 }}>{weekSentence}</p>
              <ol
                aria-label="Charge for each of the last seven days"
                style={{ listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}
              >
                {week.map(d => {
                  const isToday = d.date === today
                  return (
                    <li
                      key={d.date}
                      aria-label={`${weekdayLong(d.date)}: ${d.charge ? `Charge ${d.charge.score}, ${d.charge.bandLabel}` : 'no score'}`}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', minWidth: 0 }}
                    >
                      <Ring score={d.charge?.score ?? null} size={40} stroke={4} muted={!isToday} />
                      <span style={{
                        fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 600,
                        color: isToday ? 'var(--accent-text)' : 'var(--text-muted)',
                      }}>
                        {isToday ? 'Today' : weekdayShort(d.date)}
                      </span>
                    </li>
                  )
                })}
              </ol>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Each ring is that morning&rsquo;s Charge. A training guide, not a medical measure.
              </p>
            </section>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
