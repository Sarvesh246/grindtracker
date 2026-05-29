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
  lastSessionLogs: { exercise_name: string; weight: number | null }[]
  nextDay: 'push' | 'pull' | 'legs'
  nextDayExercises: string[]
  weeklyWorkouts: number
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

export default function HomeDashboard({
  stats,
  lastSession,
  lastSessionLogs,
  nextDay,
  nextDayExercises,
  weeklyWorkouts,
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

  return (
    <div style={{ padding: '0 16px 32px', fontFamily: "'DM Sans', sans-serif" }}>

      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: '24px',
        paddingBottom: '20px',
      }}>
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '28px',
          color: 'var(--accent)',
          letterSpacing: '1px',
          fontWeight: 'normal',
        }}>
          GRIND
        </h1>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {formatHeaderDate()}
        </span>
      </div>

      {/* First-run welcome */}
      {totalWorkouts === 0 && (
        <div
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '28px 20px',
            marginBottom: '16px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
            <line x1="6" y1="12" x2="18" y2="12" />
            <rect x="2" y="9" width="4" height="6" rx="1.5" />
            <rect x="18" y="9" width="4" height="6" rx="1.5" />
          </svg>
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
              color: 'var(--bg)',
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

      {/* Level + XP Card */}
      <div style={{
        backgroundColor: 'var(--surface)',
        borderRadius: '12px',
        border: '1px solid var(--border)',
        padding: '16px',
        marginBottom: '12px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>
              LEVEL
            </div>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '52px',
              color: 'var(--accent)',
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
      <div style={{
        backgroundColor: 'var(--surface)',
        borderRadius: '12px',
        border: '1px solid var(--border)',
        padding: '16px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}>
        {currentStreak === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            Start your streak today
          </div>
        ) : (
          <>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
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
          </>
        )}
      </div>

      {/* Start Workout CTA */}
      <button
        onClick={() => router.push(`/log?day=${nextDay}`)}
        style={{
          width: '100%',
          height: '64px',
          backgroundColor: 'var(--accent)',
          color: 'var(--bg)',
          border: 'none',
          borderRadius: '12px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2px',
          marginBottom: '24px',
          transition: 'opacity 150ms ease',
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        onMouseDown={e => (e.currentTarget.style.opacity = '0.75')}
        onMouseUp={e => (e.currentTarget.style.opacity = '0.88')}
        onTouchStart={e => (e.currentTarget.style.opacity = '0.85')}
        onTouchEnd={e => (e.currentTarget.style.opacity = '1')}
      >
        <span style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '22px',
          letterSpacing: '1px',
          lineHeight: 1,
        }}>
          START {DAY_LABELS[nextDay]}
        </span>
        <span style={{
          fontSize: '11px',
          fontWeight: 400,
          color: 'var(--bg)',
          opacity: 0.65,
          lineHeight: 1,
        }}>
          {exercisePreview}
        </span>
      </button>

      {/* Last Workout */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          marginBottom: '10px',
        }}>
          LAST WORKOUT
        </div>

        {!lastSession ? (
          <div style={{
            backgroundColor: 'var(--surface)',
            borderRadius: '12px',
            border: '1px solid var(--border)',
            padding: '20px',
            color: 'var(--text-muted)',
            fontSize: '14px',
            textAlign: 'center',
          }}>
            No workouts logged yet. Hit that first session!
          </div>
        ) : (
          <div style={{
            backgroundColor: 'var(--surface)',
            borderRadius: '12px',
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
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
            <div style={{ padding: '8px 0' }}>
              {lastSessionLogs.map((log, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '7px 16px',
                  }}
                >
                  <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                    {log.exercise_name}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '14px',
                    color: log.weight !== null ? 'var(--accent)' : 'var(--text-muted)',
                  }}>
                    {log.weight !== null ? `${fmt(log.weight)} ${unitLabel}` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        {[
          { label: 'WORKOUTS', value: totalWorkouts },
          { label: 'THIS WEEK', value: weeklyWorkouts },
          { label: 'TOTAL PRs', value: totalPRs },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              flex: 1,
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '12px 8px',
              textAlign: 'center',
            }}
          >
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '28px',
              color: 'var(--text-primary)',
              lineHeight: 1,
              marginBottom: '4px',
            }}>
              {stat.value}
            </div>
            <div style={{
              fontSize: '10px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Workout History Calendar */}
      <div style={{
        fontSize: '12px',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '1.5px',
        marginBottom: '10px',
      }}>
        WORKOUT HISTORY
      </div>
      <WorkoutCalendar />

    </div>
  )
}
