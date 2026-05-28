'use client'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getLevel, getXpInCurrentLevel } from '@/lib/utils/gamification'
import { BadgeDefinition } from '@/lib/utils/badges'

interface StatsShape {
  xp_total: number
  level: number
  current_streak: number
  longest_streak: number
  total_workouts: number
}

interface Props {
  displayName: string
  avatarUrl: string | null
  stats: StatsShape
  earnedBadgeIds: string[]
  totalPRs: number
  totalSets: number
  distinctDays: number
  allBadges: BadgeDefinition[]
}

export default function ProfileDashboard({
  displayName,
  avatarUrl,
  stats,
  earnedBadgeIds,
  totalPRs,
  totalSets,
  distinctDays,
  allBadges,
}: Props) {
  const router = useRouter()
  const supabase = createClient()

  const xpTotal = stats.xp_total
  const level = getLevel(xpTotal)
  const xpInLevel = getXpInCurrentLevel(xpTotal)
  const xpPercent = (xpInLevel / 500) * 100
  const earnedSet = new Set(earnedBadgeIds)
  const earnedCount = earnedBadgeIds.length

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div style={{
      fontFamily: "'DM Sans', sans-serif",
      padding: '0 16px 48px',
    }}>

      {/* Header */}
      <div style={{ paddingTop: '24px', marginBottom: '20px' }}>
        <span style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '32px', color: '#f0f0f0', letterSpacing: '1px',
        }}>
          PROFILE
        </span>
      </div>

      {/* User card */}
      <div style={{
        backgroundColor: '#1a1a1a',
        border: '1px solid #2e2e2e',
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '16px',
      }}>
        {/* Avatar + name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              style={{
                width: '56px', height: '56px',
                borderRadius: '9999px',
                objectFit: 'cover',
                border: '2px solid #2e2e2e',
                flexShrink: 0,
              }}
            />
          ) : (
            <div style={{
              width: '56px', height: '56px',
              borderRadius: '9999px',
              backgroundColor: '#242424',
              border: '2px solid #2e2e2e',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                stroke="#555555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '16px', fontWeight: 700, color: '#f0f0f0',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              marginBottom: '3px',
            }}>
              {displayName}
            </div>
            <div style={{ fontSize: '14px', color: '#888888' }}>
              Level {level}
            </div>
          </div>

          {/* Level badge */}
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '40px', color: '#c8f135',
            lineHeight: 1, flexShrink: 0,
          }}>
            {level}
          </div>
        </div>

        {/* XP bar */}
        <div style={{
          width: '100%', height: '8px',
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
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: '12px', color: '#555555',
        }}>
          <span>{xpInLevel} / 500 XP</span>
          <span>{500 - xpInLevel} XP to Level {level + 1}</span>
        </div>
      </div>

      {/* Streak section */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          fontSize: '12px', color: '#555555',
          textTransform: 'uppercase', letterSpacing: '1.5px',
          marginBottom: '10px',
        }}>
          STREAKS
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { emoji: '🔥', value: stats.current_streak, label: 'CURRENT STREAK' },
            { emoji: '⚡', value: stats.longest_streak, label: 'LONGEST STREAK' },
          ].map((item) => (
            <div key={item.label} style={{
              flex: 1,
              backgroundColor: '#1a1a1a',
              border: '1px solid #2e2e2e',
              borderRadius: '12px',
              padding: '16px 12px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>
                {item.emoji}
              </div>
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '40px', color: '#f0f0f0',
                lineHeight: 1, marginBottom: '4px',
              }}>
                {item.value}
              </div>
              <div style={{
                fontSize: '10px', color: '#555555',
                textTransform: 'uppercase', letterSpacing: '0.5px',
                lineHeight: 1.3,
              }}>
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lifetime stats */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{
          fontSize: '12px', color: '#555555',
          textTransform: 'uppercase', letterSpacing: '1.5px',
          marginBottom: '10px',
        }}>
          LIFETIME STATS
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
        }}>
          {[
            { label: 'WORKOUTS LOGGED', value: stats.total_workouts, accent: true },
            { label: 'TOTAL PRs', value: totalPRs, accent: false },
            { label: 'SETS COMPLETED', value: totalSets, accent: false },
            { label: 'DAYS ACTIVE', value: distinctDays, accent: false },
          ].map((stat) => (
            <div key={stat.label} style={{
              backgroundColor: '#1a1a1a',
              border: '1px solid #2e2e2e',
              borderRadius: '12px',
              padding: '16px 14px',
            }}>
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '36px',
                color: stat.accent ? '#c8f135' : '#f0f0f0',
                lineHeight: 1,
                marginBottom: '4px',
              }}>
                {stat.value}
              </div>
              <div style={{
                fontSize: '11px', color: '#555555',
                textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Badges */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: '10px',
        }}>
          <div style={{
            fontSize: '12px', color: '#555555',
            textTransform: 'uppercase', letterSpacing: '1.5px',
          }}>
            BADGES
          </div>
          <div style={{ fontSize: '12px', color: '#555555' }}>
            {earnedCount}/{allBadges.length}
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '8px',
        }}>
          {allBadges.map((badge) => {
            const earned = earnedSet.has(badge.id)
            return (
              <div
                key={badge.id}
                style={{
                  backgroundColor: '#1a1a1a',
                  border: `1px solid ${earned ? 'rgba(200, 241, 53, 0.4)' : '#2e2e2e'}`,
                  borderRadius: '12px',
                  padding: '14px 8px',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Subtle glow bg for earned */}
                {earned && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    backgroundColor: 'rgba(200, 241, 53, 0.04)',
                    pointerEvents: 'none',
                  }} />
                )}

                {/* Emoji */}
                <div style={{
                  fontSize: '28px',
                  lineHeight: 1,
                  filter: earned ? 'none' : 'grayscale(100%)',
                  opacity: earned ? 1 : 0.3,
                  position: 'relative',
                }}>
                  {badge.emoji}

                  {/* Lock overlay for unearned */}
                  {!earned && (
                    <div style={{
                      position: 'absolute',
                      top: '50%', left: '50%',
                      transform: 'translate(-50%, -50%)',
                      fontSize: '14px',
                      opacity: 0.6,
                    }}>
                      🔒
                    </div>
                  )}
                </div>

                {/* Label */}
                <div style={{
                  fontSize: '11px',
                  color: earned ? '#f0f0f0' : '#555555',
                  lineHeight: 1.3,
                  fontWeight: earned ? 600 : 400,
                  textAlign: 'center',
                  wordBreak: 'break-word',
                }}>
                  {badge.label}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        style={{
          width: '100%', height: '48px',
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: '12px',
          color: '#ef4444',
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '14px', fontWeight: 600,
          cursor: 'pointer',
          transition: 'background-color 150ms ease',
          letterSpacing: '0.3px',
        }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.14)')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.08)')}
        onTouchStart={e => (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.14)')}
        onTouchEnd={e => (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.08)')}
      >
        SIGN OUT
      </button>

    </div>
  )
}
