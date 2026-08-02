'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getLevel, getXpInCurrentLevel, getXpRequiredForLevel, getXpToNextLevel } from '@/lib/utils/gamification'
import { BadgeDefinition } from '@/lib/utils/badges'
import BadgeIcon from '@/components/BadgeIcon'
import type { FriendProfile } from '@/lib/types'

function FlameIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--accent-text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z" />
      <path d="M12 12c0 2-1.5 3-1.5 4.5a1.5 1.5 0 0 0 3 0C13.5 15 12 14 12 12z" />
    </svg>
  )
}

function BoltIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--accent-text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function LockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function initials(name: string) {
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

interface Props {
  profile: FriendProfile
  allBadges: BadgeDefinition[]
}

export default function FriendProfileView({ profile, allBadges }: Props) {
  const router = useRouter()
  const [badgesOpen, setBadgesOpen] = useState(false)
  const [tooltipBadgeId, setTooltipBadgeId] = useState<string | null>(null)

  // Recomputed from XP (not the stored `level` column) to stay pixel-identical
  // with ProfileDashboard's own XP bar math — same reasoning as there.
  const xpTotal = profile.xp_total
  const level = getLevel(xpTotal)
  const xpInLevel = getXpInCurrentLevel(xpTotal)
  const levelSize = getXpRequiredForLevel(level)
  const xpToNext = getXpToNextLevel(xpTotal)
  const xpPercent = (xpInLevel / levelSize) * 100
  const earnedSet = new Set(profile.badge_ids)

  const joinedLabel = new Date(profile.joined_at).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="page page--profile" style={{
      fontFamily: "'DM Sans', sans-serif",
      padding: '0 16px 48px',
    }}>
      {/* Header */}
      <div style={{
        paddingTop: '24px', marginBottom: '20px',
        display: 'flex', alignItems: 'center', gap: '12px',
      }}>
        <button
          onClick={() => router.back()}
          aria-label="Back"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '4px', margin: '-4px',
            display: 'flex', alignItems: 'center', flexShrink: 0,
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '32px', color: 'var(--text-primary)', letterSpacing: '1px',
          fontWeight: 'normal',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          @{profile.username}
        </h1>
      </div>

      {/* User card */}
      <div style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt={profile.display_name}
              style={{
                width: '56px', height: '56px',
                borderRadius: '9999px',
                objectFit: 'cover',
                border: '2px solid var(--border)',
                flexShrink: 0,
              }}
            />
          ) : (
            <div style={{
              width: '56px', height: '56px',
              borderRadius: '9999px',
              backgroundColor: 'var(--surface-elevated)',
              border: '2px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '22px',
                color: 'var(--accent-text)',
                letterSpacing: '1px',
                lineHeight: 1,
              }}>
                {initials(profile.display_name)}
              </span>
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              marginBottom: '3px',
            }}>
              {profile.display_name}
            </div>
            <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              Level {level}
            </div>
          </div>

          <div style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '40px', color: 'var(--accent-text)',
            lineHeight: 1, flexShrink: 0,
          }}>
            {level}
          </div>
        </div>

        {/* XP bar */}
        <div style={{
          width: '100%', height: '8px',
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
          }} />
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: '12px', color: 'var(--text-muted)',
        }}>
          <span>{xpInLevel} / {levelSize} XP</span>
          <span>{xpToNext} XP to Level {level + 1}</span>
        </div>
      </div>

      {/* Streak section */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          fontSize: '12px', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '1.5px',
          marginBottom: '10px',
        }}>
          STREAKS
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { icon: <FlameIcon size={24} />, value: profile.current_streak, label: 'CURRENT STREAK' },
            { icon: <BoltIcon size={24} />, value: profile.longest_streak, label: 'LONGEST STREAK' },
          ].map((item) => (
            <div key={item.label} style={{
              flex: 1,
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '16px 12px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}>
              <div style={{ marginBottom: '4px' }}>{item.icon}</div>
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '40px', color: 'var(--text-primary)',
                lineHeight: 1, marginBottom: '4px',
              }}>
                {item.value}
              </div>
              <div style={{
                fontSize: '10px', color: 'var(--text-muted)',
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
          fontSize: '12px', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '1.5px',
          marginBottom: '10px',
        }}>
          LIFETIME STATS
        </div>

        <div className="stat-grid-4">
          {[
            { label: 'WORKOUTS LOGGED', value: profile.total_workouts, accent: true },
            { label: 'TOTAL PRs', value: profile.total_prs, accent: false },
            { label: 'SETS COMPLETED', value: profile.total_sets, accent: false },
            { label: 'DAYS ACTIVE', value: profile.days_active, accent: false },
          ].map((stat) => (
            <div key={stat.label} style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '16px 14px',
            }}>
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '36px',
                color: stat.accent ? 'var(--accent-text)' : 'var(--text-primary)',
                lineHeight: 1,
                marginBottom: '4px',
              }}>
                {stat.value}
              </div>
              <div style={{
                fontSize: '11px', color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Badges */}
      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={() => setBadgesOpen(v => !v)}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: badgesOpen ? '12px 12px 0 0' : '12px',
            padding: '14px 16px',
            cursor: 'pointer',
          }}
        >
          <div style={{
            fontSize: '12px', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '1.5px',
          }}>
            BADGES
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{earnedSet.size}/{allBadges.length}</span>
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transition: 'transform 150ms ease', transform: badgesOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--text-muted)' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </button>

        {badgesOpen && (
          <div className="badge-grid" style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderTop: 'none',
            borderRadius: '0 0 12px 12px',
            padding: '10px',
          }}>
            {allBadges.map((badge) => {
              const earned = earnedSet.has(badge.id)
              const showTooltip = tooltipBadgeId === badge.id
              return (
                <div
                  key={badge.id}
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: `1px solid ${earned ? 'rgba(200, 241, 53, 0.4)' : 'var(--border)'}`,
                    borderRadius: '12px',
                    padding: '14px 8px',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                    position: 'relative',
                    overflow: 'visible',
                    cursor: 'pointer',
                    zIndex: showTooltip ? 2 : 'auto',
                  }}
                  onMouseEnter={() => setTooltipBadgeId(badge.id)}
                  onMouseLeave={() => setTooltipBadgeId(null)}
                  onTouchEnd={(e) => { e.preventDefault(); setTooltipBadgeId(v => v === badge.id ? null : badge.id) }}
                  onClick={() => setTooltipBadgeId(v => v === badge.id ? null : badge.id)}
                >
                  {earned && (
                    <div style={{
                      position: 'absolute', inset: 0,
                      backgroundColor: 'rgba(200, 241, 53, 0.04)',
                      pointerEvents: 'none',
                      borderRadius: '12px',
                    }} />
                  )}

                  <div style={{
                    position: 'relative',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: earned ? 1 : 0.25,
                  }}>
                    <BadgeIcon badgeId={badge.id} size={28} earned={earned} />
                    {!earned && (
                      <div style={{
                        position: 'absolute',
                        bottom: '-4px', right: '-4px',
                        backgroundColor: 'var(--surface)',
                        borderRadius: '9999px',
                        padding: '2px',
                      }}>
                        <LockIcon size={12} />
                      </div>
                    )}
                  </div>

                  <div style={{
                    fontSize: '11px',
                    color: earned ? 'var(--text-primary)' : 'var(--text-muted)',
                    lineHeight: 1.3,
                    fontWeight: earned ? 600 : 400,
                    textAlign: 'center',
                    wordBreak: 'break-word',
                  }}>
                    {badge.label}
                  </div>

                  {showTooltip && (
                    <div style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      width: '140px',
                      zIndex: 50,
                      pointerEvents: 'none',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                    }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '3px' }}>
                        {badge.label}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        {badge.description}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Grinding since — the one deliberately branded line on an otherwise
          neutral read-only page; "Grinding" in the neon accent, everything
          else muted. */}
      <div style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--accent-text)', fontWeight: 700 }}>Grinding</span> since {joinedLabel}
      </div>
    </div>
  )
}
