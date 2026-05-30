'use client'
import { useRouter } from 'next/navigation'
import { Session, UserStats } from '@/lib/types'
import { getLevel, getXpInCurrentLevel, getXpRequiredForLevel, getXpToNextLevel } from '@/lib/utils/gamification'
import { formatHeaderDate, formatShortDate } from '@/lib/utils/formatting'
import WorkoutCalendar from '@/components/WorkoutCalendar'
import { useUnit } from '@/lib/contexts/UnitContext'

interface Props {
  stats: UserStats | null
  lastSession: Session | null
  lastSessionLogs: { exercise_name: string; weight: number | null; sets: number; reps: number | null }[]
  nextDay: 'push' | 'pull' | 'legs'
  nextDayExercises: string[]
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
          onClick={() => router.push(`/log?day=${nextDay}`)}
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

      {/* Start Workout CTA */}
      <button
        onClick={() => router.push(`/log?day=${nextDay}`)}
        title={DAY_MUSCLES[nextDay]}
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
            START {DAY_LABELS[nextDay]}
          </span>
          <span style={{
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--on-accent)',
            opacity: 0.7,
            lineHeight: 1.2,
          }}>
            {exercisePreview}
          </span>
        </span>
        <span style={{ flexShrink: 0 }}><ChevronRight color="var(--on-accent)" /></span>
      </button>

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
              alignItems: 'baseline',
              gap: '14px',
            }}>
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '18px',
                color: 'var(--text-primary)',
              }}>
                {DAY_LABELS[lastSession.day_type]}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {formatShortDate(lastSession.completed_at!)}
              </span>
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
