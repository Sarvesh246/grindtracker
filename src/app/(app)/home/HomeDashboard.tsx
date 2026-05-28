'use client'
import { useRouter } from 'next/navigation'
import { Session, UserStats } from '@/lib/types'
import { getLevel, getXpInCurrentLevel } from '@/lib/utils/gamification'
import { formatHeaderDate, formatShortDate } from '@/lib/utils/formatting'

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

  const xpTotal = stats?.xp_total ?? 0
  const level = getLevel(xpTotal)
  const xpInLevel = getXpInCurrentLevel(xpTotal)
  const xpPercent = (xpInLevel / 500) * 100
  const currentStreak = stats?.current_streak ?? 0
  const longestStreak = stats?.longest_streak ?? 0
  const totalWorkouts = stats?.total_workouts ?? 0

  const exercisePreview = nextDayExercises.join(', ')

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
        <span style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '28px',
          color: '#c8f135',
          letterSpacing: '1px',
        }}>
          GRIND
        </span>
        <span style={{ fontSize: '13px', color: '#555555' }}>
          {formatHeaderDate()}
        </span>
      </div>

      {/* Level + XP Card */}
      <div style={{
        backgroundColor: '#1a1a1a',
        borderRadius: '12px',
        border: '1px solid #2e2e2e',
        padding: '16px',
        marginBottom: '12px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#555555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>
              LEVEL
            </div>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '52px',
              color: '#c8f135',
              lineHeight: 1,
            }}>
              {level}
            </div>
          </div>
          <div style={{ textAlign: 'right', paddingTop: '8px' }}>
            <div style={{ fontSize: '12px', color: '#555555' }}>
              → LVL {level + 1}
            </div>
            <div style={{ fontSize: '12px', color: '#888888', marginTop: '4px' }}>
              {500 - xpInLevel} XP away
            </div>
          </div>
        </div>
        {/* XP Bar */}
        <div style={{
          width: '100%',
          height: '8px',
          backgroundColor: '#2e2e2e',
          borderRadius: '9999px',
          overflow: 'hidden',
          marginBottom: '6px',
        }}>
          <div style={{
            height: '100%',
            width: `${xpPercent}%`,
            backgroundColor: '#c8f135',
            borderRadius: '9999px',
            transition: 'width 600ms ease',
          }} />
        </div>
        <div style={{ fontSize: '12px', color: '#555555' }}>
          {xpInLevel} / 500 XP
        </div>
      </div>

      {/* Streak Card */}
      <div style={{
        backgroundColor: '#1a1a1a',
        borderRadius: '12px',
        border: '1px solid #2e2e2e',
        padding: '16px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}>
        {currentStreak === 0 ? (
          <div style={{ color: '#555555', fontSize: '14px' }}>
            Start your streak today 💪
          </div>
        ) : (
          <>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <span style={{ fontSize: '28px', lineHeight: 1 }}>🔥</span>
                <span style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: '52px',
                  color: '#f0f0f0',
                  lineHeight: 1,
                }}>
                  {currentStreak}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#555555', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '2px' }}>
                DAY STREAK
              </div>
            </div>
            <div style={{ width: '1px', height: '48px', backgroundColor: '#2e2e2e' }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', color: '#555555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>
                BEST
              </div>
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '36px',
                color: '#888888',
                lineHeight: 1,
              }}>
                {longestStreak}
              </div>
              <div style={{ fontSize: '11px', color: '#555555' }}>DAYS</div>
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
          backgroundColor: '#c8f135',
          color: '#0f0f0f',
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
        onMouseDown={e => (e.currentTarget.style.opacity = '0.85')}
        onMouseUp={e => (e.currentTarget.style.opacity = '1')}
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
          color: '#0f0f0f',
          opacity: 0.65,
          maxWidth: '280px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1,
        }}>
          {exercisePreview}
        </span>
      </button>

      {/* Last Workout */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          fontSize: '12px',
          color: '#555555',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          marginBottom: '10px',
        }}>
          LAST WORKOUT
        </div>

        {!lastSession ? (
          <div style={{
            backgroundColor: '#1a1a1a',
            borderRadius: '12px',
            border: '1px solid #2e2e2e',
            padding: '20px',
            color: '#555555',
            fontSize: '14px',
            textAlign: 'center',
          }}>
            No workouts logged yet. Hit that first session! 💪
          </div>
        ) : (
          <div style={{
            backgroundColor: '#1a1a1a',
            borderRadius: '12px',
            border: '1px solid #2e2e2e',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid #2e2e2e',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '18px',
                color: '#f0f0f0',
              }}>
                {DAY_LABELS[lastSession.day_type]}
              </span>
              <span style={{ fontSize: '12px', color: '#555555' }}>
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
                  <span style={{ fontSize: '14px', color: '#f0f0f0' }}>
                    {log.exercise_name}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '14px',
                    color: log.weight !== null ? '#c8f135' : '#555555',
                  }}>
                    {log.weight !== null ? `${log.weight} lbs` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {[
          { label: 'WORKOUTS', value: totalWorkouts },
          { label: 'THIS WEEK', value: weeklyWorkouts },
          { label: 'TOTAL PRs', value: totalPRs },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              flex: 1,
              backgroundColor: '#1a1a1a',
              border: '1px solid #2e2e2e',
              borderRadius: '12px',
              padding: '12px 8px',
              textAlign: 'center',
            }}
          >
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '28px',
              color: '#f0f0f0',
              lineHeight: 1,
              marginBottom: '4px',
            }}>
              {stat.value}
            </div>
            <div style={{
              fontSize: '10px',
              color: '#555555',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}
