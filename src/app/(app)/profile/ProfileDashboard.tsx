'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getLevel, getXpInCurrentLevel, getXpRequiredForLevel, getXpToNextLevel } from '@/lib/utils/gamification'
import { BadgeDefinition } from '@/lib/utils/badges'
import BodyWeightCard from './BodyWeightCard'

function FlameIcon({ size = 24, color = 'var(--accent)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z" />
      <path d="M12 12c0 2-1.5 3-1.5 4.5a1.5 1.5 0 0 0 3 0C13.5 15 12 14 12 12z" />
    </svg>
  )
}

function BoltIcon({ size = 24, color = 'var(--accent)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function BadgeIcon({ badgeId, size = 28, earned }: { badgeId: string; size?: number; earned: boolean }) {
  const color = earned ? 'var(--accent)' : '#444444'
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
    case 'level_5':
      return <svg {...props}><polygon points="12 2 20 12 12 22 4 12 12 2"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
    case 'level_10':
      return <svg {...props}><polygon points="12 2 20 12 12 22 4 12 12 2"/><polygon points="12 6 17 12 12 18 7 12 12 6" fill={color} fillOpacity="0.15"/></svg>
    case 'level_20':
      return <svg {...props}><polygon points="12 2 15.5 8.5 22 9.5 17 14.5 18.2 21 12 17.8 5.8 21 7 14.5 2 9.5 8.5 8.5 12 2"/><circle cx="12" cy="12" r="2.5" fill={color} fillOpacity="0.3"/></svg>
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

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

interface Props {
  displayName: string
  avatarUrl: string | null
  username: string | null
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
  username: initialUsername,
  stats,
  earnedBadgeIds,
  totalPRs,
  totalSets,
  distinctDays,
  allBadges,
}: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [tooltipBadgeId, setTooltipBadgeId] = useState<string | null>(null)
  const [badgesOpen, setBadgesOpen] = useState(false)

  // Username editing
  const [username, setUsername] = useState(initialUsername ?? '')
  const [editingUsername, setEditingUsername] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [usernameChecking, setUsernameChecking] = useState(false)
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!editingUsername) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setUsernameAvailable(null)
    setUsernameError(null)

    const trimmed = newUsername.trim().toLowerCase()
    // Same as current → always valid, no check needed
    if (trimmed === username) { setUsernameAvailable(true); return }
    if (!trimmed || !USERNAME_RE.test(trimmed)) return

    setUsernameChecking(true)
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('username', trimmed)
        .maybeSingle()
      setUsernameChecking(false)
      setUsernameAvailable(!data)
    }, 400)
  }, [newUsername, editingUsername, username])

  function openUsernameEdit() {
    setNewUsername(username)
    setUsernameAvailable(null)
    setUsernameError(null)
    setEditingUsername(true)
  }

  function cancelUsernameEdit() {
    setEditingUsername(false)
    setUsernameError(null)
  }

  async function saveUsername() {
    const trimmed = newUsername.trim().toLowerCase()
    if (!USERNAME_RE.test(trimmed)) {
      setUsernameError('3–20 chars, lowercase letters, numbers, underscores only.')
      return
    }
    if (usernameChecking) { setUsernameError('Still checking — try again in a moment.'); return }
    if (!usernameAvailable) { setUsernameError('That username is taken.'); return }

    setUsernameSaving(true)
    setUsernameError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase
      .from('user_profiles')
      .update({ username: trimmed })
      .eq('id', user.id)

    setUsernameSaving(false)
    if (error) { setUsernameError(error.message); return }

    setUsername(trimmed)
    setEditingUsername(false)
  }

  function usernameStatusText() {
    const trimmed = newUsername.trim().toLowerCase()
    if (!trimmed) return ''
    if (trimmed === username) return ''
    if (!USERNAME_RE.test(trimmed)) return '3–20 chars, lowercase letters, numbers, underscores only'
    if (usernameChecking) return 'Checking…'
    if (usernameAvailable === true) return '@' + trimmed + ' is available'
    if (usernameAvailable === false) return 'Username taken'
    return ''
  }

  function usernameStatusColor() {
    const trimmed = newUsername.trim().toLowerCase()
    if (!trimmed || trimmed === username) return 'var(--text-muted)'
    if (!USERNAME_RE.test(trimmed) || usernameChecking) return 'var(--text-muted)'
    return usernameAvailable ? '#4ade80' : 'var(--danger)'
  }

  const canSaveUsername = (() => {
    const trimmed = newUsername.trim().toLowerCase()
    if (trimmed === username) return false // unchanged
    return USERNAME_RE.test(trimmed) && usernameAvailable === true && !usernameChecking && !usernameSaving
  })()

  useEffect(() => {
    if (!tooltipBadgeId) return
    const close = () => setTooltipBadgeId(null)
    document.addEventListener('touchstart', close, { passive: true })
    return () => document.removeEventListener('touchstart', close)
  }, [tooltipBadgeId])

  const xpTotal = stats.xp_total
  const level = getLevel(xpTotal)
  const xpInLevel = getXpInCurrentLevel(xpTotal)
  const levelSize = getXpRequiredForLevel(level)
  const xpToNext = getXpToNextLevel(xpTotal)
  const xpPercent = (xpInLevel / levelSize) * 100
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
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '32px', color: 'var(--text-primary)', letterSpacing: '1px',
          fontWeight: 'normal',
        }}>
          PROFILE
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
                color: 'var(--accent)',
                letterSpacing: '1px',
                lineHeight: 1,
              }}>
                {displayName.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
              </span>
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              marginBottom: '3px',
            }}>
              {displayName}
            </div>
            <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '3px' }}>
              Level {level}
            </div>

            {/* Username row */}
            {!editingUsername ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>
                  {username ? `@${username}` : '—'}
                </span>
                <button
                  onClick={openUsernameEdit}
                  title="Change username"
                  style={{
                    background: 'none', border: 'none', padding: '2px',
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
            ) : (
              <div style={{ marginTop: '8px' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value.toLowerCase())}
                    maxLength={20}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      backgroundColor: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: '13px',
                      outline: 'none',
                      minWidth: 0,
                    }}
                  />
                  <button
                    onClick={saveUsername}
                    style={{
                      padding: '7px 12px',
                      backgroundColor: canSaveUsername ? 'var(--accent)' : 'var(--surface-elevated)',
                      color: canSaveUsername ? 'var(--bg)' : 'var(--text-muted)',
                      border: 'none',
                      borderRadius: '8px',
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 700,
                      fontSize: '12px',
                      cursor: canSaveUsername ? 'pointer' : 'default',
                      transition: 'all 150ms ease',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {usernameSaving ? '…' : 'Save'}
                  </button>
                  <button
                    onClick={cancelUsernameEdit}
                    style={{
                      padding: '7px 10px',
                      backgroundColor: 'transparent',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >✕</button>
                </div>
                {usernameStatusText() && (
                  <div style={{
                    marginTop: '5px',
                    fontSize: '12px',
                    fontFamily: "'DM Sans', sans-serif",
                    color: usernameStatusColor(),
                    paddingLeft: '2px',
                  }}>
                    {usernameStatusText()}
                  </div>
                )}
                {usernameError && (
                  <div style={{
                    marginTop: '5px',
                    fontSize: '12px',
                    fontFamily: "'DM Sans', sans-serif",
                    color: 'var(--danger)',
                    paddingLeft: '2px',
                  }}>
                    {usernameError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Level badge */}
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '40px', color: 'var(--accent)',
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
            transition: 'width 600ms ease',
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
            { icon: <FlameIcon size={24} />, value: stats.current_streak, label: 'CURRENT STREAK' },
            { icon: <BoltIcon size={24} />, value: stats.longest_streak, label: 'LONGEST STREAK' },
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
              <div style={{ marginBottom: '4px' }}>
                {item.icon}
              </div>
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
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '16px 14px',
            }}>
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '36px',
                color: stat.accent ? 'var(--accent)' : 'var(--text-primary)',
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

      <BodyWeightCard />

      {/* Badges */}
      <div style={{ marginBottom: '32px' }}>
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
            transition: 'border-color 150ms ease',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(200,241,53,0.5)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          <div style={{
            fontSize: '12px', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '1.5px',
          }}>
            BADGES
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{earnedCount}/{allBadges.length}</span>
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transition: 'transform 150ms ease', transform: badgesOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--text-muted)' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </button>

        {badgesOpen && <div style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderTop: 'none',
          borderRadius: '0 0 12px 12px',
          padding: '10px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '8px',
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
                {/* Subtle glow bg for earned */}
                {earned && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    backgroundColor: 'rgba(200, 241, 53, 0.04)',
                    pointerEvents: 'none',
                    borderRadius: '12px',
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
                      backgroundColor: 'var(--surface)',
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
                  color: earned ? 'var(--text-primary)' : 'var(--text-muted)',
                  lineHeight: 1.3,
                  fontWeight: earned ? 600 : 400,
                  textAlign: 'center',
                  wordBreak: 'break-word',
                }}>
                  {badge.label}
                </div>

                {/* Tooltip */}
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
        </div>}
      </div>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        style={{
          width: '100%', height: '48px',
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: '12px',
          color: 'var(--danger)',
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
