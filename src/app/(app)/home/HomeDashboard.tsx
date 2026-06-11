'use client'
import { useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { Session, UserStats } from '@/lib/types'
import { getLevel, getXpInCurrentLevel, getXpRequiredForLevel, getXpToNextLevel } from '@/lib/utils/gamification'
import { formatHeaderDate, formatShortDate, localDateKey } from '@/lib/utils/formatting'
import { overdueDays } from '@/lib/utils/rotation'
import WorkoutCalendar from '@/components/WorkoutCalendar'
import { useUnit } from '@/lib/contexts/UnitContext'

// The dismissed-overdue signature lives in localStorage and is read via
// useSyncExternalStore so hydration stays clean (server snapshot = null, client
// reads the real value). A custom event lets our own writes trigger a re-render,
// since the native 'storage' event doesn't fire in the document that wrote it.
const OVERDUE_DISMISS_KEY = 'grind_overdue_dismissed'
const OVERDUE_DISMISS_EVENT = 'grind:overdue-dismissed'

function subscribeDismiss(cb: () => void): () => void {
  window.addEventListener('storage', cb)
  window.addEventListener(OVERDUE_DISMISS_EVENT, cb)
  return () => {
    window.removeEventListener('storage', cb)
    window.removeEventListener(OVERDUE_DISMISS_EVENT, cb)
  }
}
function readDismissedSig(): string | null {
  try { return localStorage.getItem(OVERDUE_DISMISS_KEY) } catch { return null }
}

interface Props {
  stats: UserStats | null
  lastSession: Session | null
  lastSessionLogs: { exercise_name: string; weight: number | null; sets: number; reps: number | null }[]
  nextDay: string
  nextDayExercises: string[]
  hasDays: boolean
  rotationSeq: string[]
  rotationIndex: number
  lastTrainedByDay: Record<string, string | null>
  firstName: string
  weeklyWorkouts: number
  monthlyWorkouts: number
  totalPRs: number
}

const DAY_LABELS: Record<string, string> = {
  push: 'PUSH DAY',
  pull: 'PULL DAY',
  legs: 'LEGS DAY',
}

const DAY_MUSCLES: Record<string, string> = {
  push: 'Chest, Shoulders, Triceps',
  pull: 'Back, Biceps, Rear Delts',
  legs: 'Quads, Hamstrings, Glutes',
}

// Standard days read "PUSH DAY"; custom days (abs, cardio, …) just use the name.
function dayLabel(key: string): string {
  return DAY_LABELS[key] ?? key.replace(/-/g, ' ').toUpperCase()
}

// Just the day's name (no "DAY" suffix) for the overdue nudge.
function dayName(key: string): string {
  return key.replace(/-/g, ' ').toUpperCase()
}

// A small dumbbell/barbell glyph, reused for the welcome state and the CTA.
function BarbellIcon({ size = 24, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="12" x2="18" y2="12" />
      <rect x="2" y="9" width="4" height="6" rx="1.5" />
      <rect x="18" y="9" width="4" height="6" rx="1.5" />
    </svg>
  )
}

function ChevronRight({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export default function HomeDashboard({
  stats,
  lastSession,
  lastSessionLogs,
  nextDay,
  nextDayExercises,
  hasDays,
  rotationSeq,
  rotationIndex,
  lastTrainedByDay,
  firstName,
  weeklyWorkouts,
  monthlyWorkouts,
  totalPRs,
}: Props) {
  const router = useRouter()
  const { unitLabel, fmt } = useUnit()

  const xpTotal = stats?.xp_total ?? 0
  const level = getLevel(xpTotal)
  const xpInLevel = getXpInCurrentLevel(xpTotal)
  const levelSize = getXpRequiredForLevel(level)
  const xpToNext = getXpToNextLevel(xpTotal)
  const xpPercent = (xpInLevel / levelSize) * 100
  const currentStreak = stats?.current_streak ?? 0
  const longestStreak = stats?.longest_streak ?? 0
  const totalWorkouts = stats?.total_workouts ?? 0

  const exercisePreview = nextDayExercises.length <= 2
    ? nextDayExercises.join(', ')
    : `${nextDayExercises.slice(0, 2).join(', ')} +${nextDayExercises.length - 2} more`

  // Days the rotation pointer skipped past — a subtle, dismissible nudge so a day
  // you jumped over isn't lost. Computed client-side so daysSince uses the viewer's
  // timezone. The position system still picks `nextDay`; this never surfaces the
  // merely-next/earliest day, only one trained out of order and left behind.
  const overdue = totalWorkouts > 0 ? overdueDays(rotationSeq, rotationIndex, lastTrainedByDay) : []
  const overdueSig = overdue.map(d => d.dayType).join(',')

  // Dismissal is keyed to the overdue set, so hiding it sticks across reloads but
  // returns if a *different* day later gets skipped.
  const dismissedSig = useSyncExternalStore(subscribeDismiss, readDismissedSig, () => null)
  const dismissOverdue = () => {
    try { localStorage.setItem(OVERDUE_DISMISS_KEY, overdueSig) } catch {}
    window.dispatchEvent(new Event(OVERDUE_DISMISS_EVENT))
  }
  const showOverdue = overdue.length > 0 && dismissedSig !== overdueSig
  const overdueNames = overdue.map(d => dayName(d.dayType))

  // Shared card surface — one radius (20px) and one padding (24px) across the
  // whole dashboard so every card edge aligns to the same grid.
  const card: React.CSSProperties = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '20px',
    padding: '24px',
  }

  return (
    <div className="page page--dashboard" style={{ fontFamily: "'DM Sans', sans-serif" }}>

      {/* Mobile-only wordmark — desktop carries the brand in the fixed TopNav. */}
      <h1 className="home-brand" style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: '28px',
        color: 'var(--accent-text)',
        letterSpacing: '1px',
        fontWeight: 'normal',
        paddingTop: '24px',
      }}>
        GRIND
      </h1>

      {/* First-run welcome */}
      {totalWorkouts === 0 && (
        <div
          style={{
            ...card,
            padding: '32px 24px',
            marginBottom: '24px',
            marginTop: '16px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <span style={{ color: 'var(--accent-text)' }}><BarbellIcon size={48} /></span>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '28px',
              color: 'var(--text-primary)',
              letterSpacing: '1px',
              fontWeight: 'normal',
              lineHeight: 1,
            }}
          >
            WELCOME TO GRIND
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', maxWidth: '280px', lineHeight: 1.4 }}>
            Pick today&apos;s workout to begin. Your first session unlocks your streak.
          </p>
          <button
            onClick={() => router.push('/log')}
            style={{
              marginTop: '4px',
              height: '48px',
              padding: '0 28px',
              backgroundColor: 'var(--accent)',
              color: 'var(--on-accent)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-display)',
              fontSize: '18px',
              letterSpacing: '1px',
              fontWeight: 'normal',
              cursor: 'pointer',
            }}
          >
            START YOUR FIRST WORKOUT
          </button>
        </div>
      )}

      <div className="home-grid">
      <div className="home-col hg-left" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Greeting — the visual starting point of the dashboard. */}
      <div>
        <div style={{
          fontSize: '13px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          marginBottom: '10px',
        }}>
          {formatHeaderDate()}
        </div>
        <h2 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '34px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.5px',
          lineHeight: 1.1,
        }}>
          Let&apos;s get after it, {firstName}.
        </h2>
      </div>

      {/* Level + XP Card */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>
              LEVEL
            </div>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '68px',
              color: 'var(--accent-text)',
              lineHeight: 1,
            }}>
              {level}
            </div>
          </div>
          <div style={{ textAlign: 'right', paddingTop: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              → LVL {level + 1}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {xpToNext} XP away
            </div>
          </div>
        </div>
        {/* XP Bar */}
        <div style={{
          width: '100%',
          height: '8px',
          backgroundColor: 'var(--border)',
          borderRadius: '9999px',
          overflow: 'hidden',
          marginBottom: '6px',
        }}>
          <div style={{
            height: '100%',
            width: `${xpPercent}%`,
            backgroundColor: 'var(--accent)',
            borderRadius: '9999px',
            transition: 'width 600ms ease',
          }} />
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {xpInLevel} / {levelSize} XP
        </div>
      </div>

      {/* Streak Card */}
      {currentStreak === 0 ? (
        <button
          onClick={() => router.push(hasDays ? `/log?day=${nextDay}` : '/log')}
          style={{
            ...card,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ color: 'var(--accent-text)', flexShrink: 0 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z"/><path d="M12 12c0 2-1.5 3-1.5 4.5a1.5 1.5 0 0 0 3 0C13.5 15 12 14 12 12z"/>
            </svg>
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
              Start your streak today
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Consistency is the key to progress.
            </div>
          </div>
          <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}><ChevronRight /></span>
        </button>
      ) : (
        <div style={{
          ...card,
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
                <path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z"/><path d="M12 12c0 2-1.5 3-1.5 4.5a1.5 1.5 0 0 0 3 0C13.5 15 12 14 12 12z"/>
              </svg>
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '52px',
                color: 'var(--text-primary)',
                lineHeight: 1,
              }}>
                {currentStreak}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '2px' }}>
              DAY STREAK
            </div>
          </div>
          <div style={{ width: '1px', height: '48px', backgroundColor: 'var(--border)' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>
              BEST
            </div>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '36px',
              color: 'var(--text-secondary)',
              lineHeight: 1,
            }}>
              {longestStreak}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>DAYS</div>
          </div>
        </div>
      )}

      {/* Primary CTA — start the suggested day, or (for a brand-new blank-slate
          user with no days yet) set up the first day so the button is never a
          dead end into an empty workout. */}
      <button
        onClick={() => router.push(hasDays ? `/log?day=${nextDay}` : '/log')}
        title={hasDays ? DAY_MUSCLES[nextDay] : undefined}
        style={{
          width: '100%',
          minHeight: '96px',
          padding: '0 24px',
          backgroundColor: 'var(--accent)',
          color: 'var(--on-accent)',
          border: 'none',
          borderRadius: '20px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '18px',
          transition: 'opacity 150ms ease',
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        onMouseDown={e => (e.currentTarget.style.opacity = '0.75')}
        onMouseUp={e => (e.currentTarget.style.opacity = '0.88')}
        onTouchStart={e => (e.currentTarget.style.opacity = '0.85')}
        onTouchEnd={e => (e.currentTarget.style.opacity = '1')}
      >
        <span style={{ flexShrink: 0 }}><BarbellIcon size={32} color="var(--on-accent)" /></span>
        <span style={{ flex: 1, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '28px',
            letterSpacing: '1px',
            lineHeight: 1,
          }}>
            {hasDays ? `START ${dayLabel(nextDay)}` : 'CREATE YOUR FIRST DAY'}
          </span>
          <span style={{
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--on-accent)',
            opacity: 0.7,
            lineHeight: 1.2,
          }}>
            {hasDays ? exercisePreview : 'Set up your workout days to get started'}
          </span>
        </span>
        <span style={{ flexShrink: 0 }}><ChevronRight color="var(--on-accent)" /></span>
      </button>

      {/* Overdue nudge — a slim, dismissible line that surfaces a day the rotation
          skipped past (trained out of order and left behind), so you don't have to
          scan the calendar. Tap to start it; × hides it until a new day is skipped. */}
      {showOverdue && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 12px',
          borderRadius: '12px',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
        }}>
          <span style={{ color: 'var(--danger)', flexShrink: 0, display: 'flex' }} aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <button
            onClick={() => router.push(`/log?day=${overdue[0].dayType}`)}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'none',
              border: 'none',
              padding: 0,
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: 1.3,
            }}
          >
            You&apos;re overdue for{' '}
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {overdueNames.join(', ')}
            </span>
            {overdue[0].daysSince !== null && overdueNames.length === 1 && (
              <span style={{ color: 'var(--text-muted)' }}> · {overdue[0].daysSince}d ago</span>
            )}
          </button>
          <button
            onClick={dismissOverdue}
            aria-label="Dismiss"
            style={{
              flexShrink: 0,
              background: 'none',
              border: 'none',
              // ~32px touch target without growing the row's visual height.
              padding: '8px',
              margin: '-6px -4px',
              borderRadius: '8px',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              transition: 'color 150ms ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      </div>{/* end left column */}

      {/* Last Workout — full-width band beneath both columns on desktop */}
      <div className="hg-last">
        <div style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          marginBottom: '12px',
        }}>
          LAST WORKOUT
        </div>

        {!lastSession ? (
          <div style={{
            ...card,
            color: 'var(--text-muted)',
            fontSize: '14px',
            textAlign: 'center',
          }}>
            No workouts logged yet. Hit that first session!
          </div>
        ) : (
          <div className="lw-card" style={{
            backgroundColor: 'var(--surface)',
            borderRadius: '20px',
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}>
            <div className="lw-main">
            <div className="lw-header" style={{
              padding: '18px 24px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '14px',
            }}>
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '18px',
                color: 'var(--text-primary)',
              }}>
                {dayLabel(lastSession.day_type)}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {formatShortDate(lastSession.completed_at!)}
                </span>
                <button
                  onClick={() => router.push(`/log/past?date=${localDateKey(new Date(lastSession.completed_at!))}`)}
                  title="Edit or delete this workout"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '4px 9px',
                    color: 'var(--text-secondary)',
                    fontSize: '11px',
                    fontFamily: "'Bebas Neue', sans-serif",
                    letterSpacing: '0.5px',
                    cursor: 'pointer',
                    transition: 'color 150ms ease, border-color 150ms ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.color = 'var(--text-primary)'
                    e.currentTarget.style.borderColor = 'var(--border-strong)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.color = 'var(--text-secondary)'
                    e.currentTarget.style.borderColor = 'var(--border)'
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  EDIT
                </button>
              </div>
            </div>
            <div style={{ padding: '12px 0' }}>
              {lastSessionLogs.map((log, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '9px 24px',
                  }}
                >
                  <span style={{ fontSize: '14px', color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.exercise_name}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '14px',
                    color: log.weight !== null ? 'var(--accent-text)' : 'var(--text-muted)',
                    textAlign: 'right',
                    minWidth: '78px',
                  }}>
                    {log.weight !== null ? `${fmt(log.weight)} ${unitLabel}` : '—'}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '13px',
                    color: 'var(--text-muted)',
                    textAlign: 'right',
                    minWidth: '54px',
                  }}>
                    {log.sets > 0 && log.reps !== null ? `${log.sets} × ${log.reps}` : ''}
                  </span>
                </div>
              ))}
            </div>
            </div>{/* end lw-main */}
            {/* Notes panel — always rendered on desktop so the card keeps its
                two-region balance; falls back to a muted placeholder, and stays
                hidden on mobile when there's nothing to show. */}
            <div className={`lw-notes${lastSession.note ? '' : ' lw-notes--empty'}`} style={{ padding: '20px 24px' }}>
              <div style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '4px',
              }}>
                NOTES
              </div>
              <div style={{
                fontSize: '13px',
                color: lastSession.note ? 'var(--text-secondary)' : 'var(--text-muted)',
                fontStyle: lastSession.note ? 'normal' : 'italic',
                lineHeight: 1.4,
              }}>
                {lastSession.note || 'No notes for this session.'}
              </div>
            </div>
          </div>
        )}
      </div>{/* end last-workout band */}

      <div className="home-col hg-right" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Stats Row — three equal-width, equal-height cards. */}
      <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch' }}>
        {[
          { value: weeklyWorkouts, label: 'WORKOUTS', sub: 'This Week' },
          { value: monthlyWorkouts, label: 'WORKOUTS', sub: 'This Month' },
          { value: totalPRs, label: 'TOTAL PRS', sub: 'All Time' },
        ].map((stat, i) => (
          <div
            key={i}
            style={{
              ...card,
              flex: 1,
              padding: '22px 12px',
              textAlign: 'center',
            }}
          >
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '52px',
              color: 'var(--text-primary)',
              lineHeight: 1,
              marginBottom: '8px',
            }}>
              {stat.value}
            </div>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              fontWeight: 600,
            }}>
              {stat.label}
            </div>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              marginTop: '2px',
            }}>
              {stat.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Workout History Calendar — the dominant element of the right column.
          flex-fills so the card bottom aligns with the left column's CTA. */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          marginBottom: '12px',
        }}>
          WORKOUT HISTORY
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <WorkoutCalendar />
        </div>
      </div>

      </div>{/* end right column */}
      </div>{/* end home-grid */}

    </div>
  )
}
