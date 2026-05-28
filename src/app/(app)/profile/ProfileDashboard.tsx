'use client'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getLevel, getXpInCurrentLevel } from '@/lib/utils/gamification'
import { BadgeDefinition } from '@/lib/utils/badges'

function FlameIcon({ size = 24, color = '#c8f135' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z" />
      <path d="M12 12c0 2-1.5 3-1.5 4.5a1.5 1.5 0 0 0 3 0C13.5 15 12 14 12 12z" />
    </svg>
  )
}

function BoltIcon({ size = 24, color = '#c8f135' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function BadgeIcon({ badgeId, size = 28, earned }: { badgeId: string; size?: number; earned: boolean }) {
  const color = earned ? '#c8f135' : '#444444'
  const s = { width: size, height: size }
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' as const, stroke: color, strokeWidth: '1.8', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  switch (badgeId) {
    case 'first_workout':
      return <svg {...props}><line x1="6" y1="12" x2="18" y2="12"/><rect x="3" y="9.5" width="3" height="5" rx="1"/><rect x="18" y="9.5" width="3" height="5" rx="1"/><circle cx="12" cy="5" r="2"/><path d="M12 7v3"/></svg>
    case 'first_pr':
      return <svg {...props}><polyline points="8 6 12 2 16 6"/><path d="M12 2v10"/><path d="M5 17l1.5-5h11L19 17"/><path d="M3 22h18"/></svg>
    case 'streak_3':
      return <svg {...props}><path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z"/><path d="M12 12c0 2-1.5 3-1.5 4.5a1.5 1.5 0 0 0 3 0C13.5 15 12 14 12 12z"/></svg>
    case 'streak_7':
      return <svg {...props}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    case 'streak_30':
      return <svg {...props}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    case 'workouts_10':
      return <svg {...props}><polyline points="20 6 9 17 4 12"/></svg>
    case 'workouts_50':
      return <svg {...props}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
    case 'workouts_100':
      return <svg {...props}><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/></svg>
    case 'all_three_days':
      return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="15" x2="8.01" y2="15" strokeWidth="2.5"/><line x1="12" y1="15" x2="12.01" y2="15" strokeWidth="2.5"/><line x1="16" y1="15" x2="16.01" y2="15" strokeWidth="2.5"/></svg>
    case 'pr_5':
      return <svg {...props}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
    case 'pr_25':
      return <svg {...props}><path d="M12 2L9.1 8.6 2 9.6l5 4.9-1.2 6.9L12 18l6.2 3.4L17 14.5l5-4.9-7.1-1L12 2z"/><path d="M9 9l2 2 4-4" stroke={color} strokeWidth="1.4"/></svg>
    default:
      return <svg {...props} style={s}><circle cx="12" cy="12" r="10"/></svg>
  }
}

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
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '22px',
                color: '#c8f135',
                letterSpacing: '1px',
                lineHeight: 1,
              }}>
                {displayName.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
              </span>
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
            { icon: <FlameIcon size={24} />, value: stats.current_streak, label: 'CURRENT STREAK' },
            { icon: <BoltIcon size={24} />, value: stats.longest_streak, label: 'LONGEST STREAK' },
          ].map((item) => (
            <div key={item.label} style={{
              flex: 1,
              backgroundColor: '#1a1a1a',
              border: '1px solid #2e2e2e',
              borderRadius: '12px',
              padding: '16px 12px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}>
              <div style={{ marginBottom: '4px' }}>
                {item.icon}
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

                {/* Icon */}
                <div style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: earned ? 1 : 0.25,
                }}>
                  <BadgeIcon badgeId={badge.id} size={28} earned={earned} />

                  {/* Lock overlay for unearned */}
                  {!earned && (
                    <div style={{
                      position: 'absolute',
                      bottom: '-4px', right: '-4px',
                      backgroundColor: '#1a1a1a',
                      borderRadius: '9999px',
                      padding: '2px',
                      opacity: 1,
                    }}>
                      <LockIcon size={12} />
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
