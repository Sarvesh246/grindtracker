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
  nextDay: string
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

// Standard days read "PUSH DAY"; custom days (abs, cardio, …) just use the name.
function dayLabel(key: string): string {
  return DAY_LABELS[key] ?? key.replace(/-/g, ' ').toUpperCase()
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

  return (
    <div className="page page--dashboard" style={{ padding: '0 16px 32px', fontFamily: "'DM Sans', sans-serif" }}>

      {/* Mobile-only wordmark — desktop carries the brand in the fixed TopNav. */}
      <h1 className="home-brand" style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: '28px',
        color: 'var(--accent)',
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
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '28px 20px',
            marginBottom: '16px',
            marginTop: '16px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <span style={{ color: 'var(--accent)' }}><BarbellIcon size={48} /></span>
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

      <div className="home-grid">
      <div className="home-col">

      {/* Greeting */}
      <div style={{ paddingTop: '20px', paddingBottom: '20px' }}>
        <div style={{
          fontSize: '13px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          marginBottom: '8px',
        }}>
          {formatHeaderDate()}
        </div>
        <h2 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '32px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.5px',
          lineHeight: 1.15,
        }}>
          Let&apos;s get after it, {firstName}.
        </h2>
      </div>

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
      {currentStreak === 0 ? (
        <button
          onClick={() => router.push(`/log?day=${nextDay}`)}
          style={{
            width: '100%',
            backgroundColor: 'var(--surface)',
            borderRadius: '12px',
            border: '1px solid var(--border)',
            padding: '16px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ color: 'var(--accent)', flexShrink: 0 }}>
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
          backgroundColor: 'var(--surface)',
          borderRadius: '12px',
          border: '1px solid var(--border)',
          padding: '16px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}>
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
        </div>
      )}

      {/* Start Workout CTA */}
      <button
        onClick={() => router.push(`/log?day=${nextDay}`)}
        title={DAY_MUSCLES[nextDay]}
        style={{
          width: '100%',
          minHeight: '72px',
          padding: '0 20px',
          backgroundColor: 'var(--accent)',
          color: 'var(--bg)',
          border: 'none',
          borderRadius: '12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
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
        <span style={{ flexShrink: 0 }}><BarbellIcon size={28} color="var(--bg)" /></span>
        <span style={{ flex: 1, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '22px',
            letterSpacing: '1px',
            lineHeight: 1,
          }}>
            START {dayLabel(nextDay)}
          </span>
          <span style={{
            fontSize: '11px',
            fontWeight: 400,
            color: 'var(--bg)',
            opacity: 0.65,
            lineHeight: 1.2,
          }}>
            {exercisePreview}
          </span>
        </span>
        <span style={{ flexShrink: 0 }}><ChevronRight color="var(--bg)" /></span>
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
                {dayLabel(lastSession.day_type)}
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
                    gap: '12px',
                    padding: '7px 16px',
                  }}
                >
                  <span style={{ fontSize: '14px', color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.exercise_name}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '14px',
                    color: log.weight !== null ? 'var(--accent)' : 'var(--text-muted)',
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
            {lastSession.note && (
              <div style={{
                padding: '12px 16px',
                borderTop: '1px solid var(--border)',
              }}>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  marginBottom: '4px',
                }}>
                  NOTES
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {lastSession.note}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      </div>{/* end left column */}
      <div className="home-col">

      {/* Stats Row */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '20px', marginBottom: '24px' }}>
        {[
          { value: weeklyWorkouts, label: 'WORKOUTS', sub: 'This Week' },
          { value: monthlyWorkouts, label: 'WORKOUTS', sub: 'This Month' },
          { value: totalPRs, label: 'TOTAL PRS', sub: 'All Time' },
        ].map((stat, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '18px 8px',
              textAlign: 'center',
            }}
          >
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '40px',
              color: 'var(--text-primary)',
              lineHeight: 1,
              marginBottom: '6px',
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
              marginTop: '1px',
            }}>
              {stat.sub}
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

      </div>{/* end right column */}
      </div>{/* end home-grid */}

    </div>
  )
}
