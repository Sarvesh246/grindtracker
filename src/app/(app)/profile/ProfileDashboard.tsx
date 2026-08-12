'use client'
import { useState, useEffect, useRef, useMemo, type CSSProperties } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getLevel, getXpInCurrentLevel, getXpRequiredForLevel, getXpToNextLevel } from '@/lib/utils/gamification'
import { localDateKey } from '@/lib/utils/formatting'
import { ALL_BADGES, formatBadgeDescription } from '@/lib/utils/badges'
import BadgeIcon from '@/components/BadgeIcon'
import BodyWeightCard from './BodyWeightCard'
import { useUnit } from '@/lib/contexts/UnitContext'
import { useToast } from '@/lib/contexts/ToastContext'
import { useTour, type TourStep } from '@/components/onboarding/Tour'
import FlameIcon from '@/components/FlameIcon'

function BoltIcon({ size = 24, color = 'var(--accent-text)' }: { size?: number; color?: string }) {
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
  joinedAt: string | null
  stats: StatsShape
  earnedBadgeIds: string[]
  totalPRs: number
  totalSets: number
  /** @deprecated prefer daysActive — kept for partial callers */
  activeDayTimestamps?: string[]
  /** Distinct local calendar days with a completed workout (server-derived). */
  daysActive?: number
  /** True when the page is showing the fake Demo Mode persona (see
   *  src/lib/demoMode/fakeData.ts) — disables username editing so a save
   *  can never overwrite the real account with the fake handle. */
  demoMode?: boolean
}

export default function ProfileDashboard({
  displayName,
  avatarUrl,
  username: initialUsername,
  joinedAt,
  stats,
  earnedBadgeIds,
  totalPRs,
  totalSets,
  activeDayTimestamps = [],
  daysActive,
  demoMode = false,
}: Props) {
  const supabase = useMemo(() => createClient(), [])
  const { fmt, unitLabel } = useUnit()
  const toast = useToast()
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
    // Clear the prior result immediately as the user types, then debounce the
    // availability lookup against Supabase (an external system).
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  }, [newUsername, editingUsername, username, supabase])

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
    toast.show('Username updated')
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

  const xpTotal = Number(stats.xp_total ?? 0) || 0
  const level = getLevel(xpTotal)
  const xpInLevel = getXpInCurrentLevel(xpTotal)
  const levelSize = getXpRequiredForLevel(level)
  const xpToNext = getXpToNextLevel(xpTotal)
  const xpPercent = (xpInLevel / levelSize) * 100
  const earnedSet = new Set(earnedBadgeIds ?? [])
  const earnedCount = (earnedBadgeIds ?? []).length
  // Distinct active days from server (local_date count) or legacy timestamp list.
  const distinctDays = useMemo(() => {
    if (typeof daysActive === 'number') return daysActive
    return new Set(activeDayTimestamps.map(t => localDateKey(new Date(t)))).size
  }, [daysActive, activeDayTimestamps])
  const joinedLabel = joinedAt
    ? new Date(joinedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null

  // Athlete walkthrough (settings has its own unit/rest tour).
  const profileSteps: TourStep[] = [
    { target: 'profile-username', title: 'Change your handle', body: 'Tap the pencil to change your @handle.' },
    { target: 'profile-badges', title: 'Badges', body: 'Tap a badge to see how to earn it.' },
  ]
  const profileTour = useTour('profile', profileSteps, {
    active: !editingUsername,
  })

  return (
    <div className="page page--profile" style={{
      fontFamily: "'DM Sans', sans-serif",
      padding: '0 16px 48px',
    }}>
      {profileTour}

      {/* Header */}
      <div style={{
        paddingTop: '24px', marginBottom: '20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
      }}>
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '32px', color: 'var(--text-primary)', letterSpacing: '1px',
          fontWeight: 'normal', margin: 0,
        }}>
          PROFILE
        </h1>
        <Link
          href="/profile/settings"
          aria-label="Settings"
          data-haptic="light"
          className="press"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            color: 'var(--text-secondary)',
            flexShrink: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
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
            // External avatar URL (Google / Supabase storage) at a fixed 56px —
            // next/image would require remote-domain config and add no real
            // benefit at this size, so a plain <img> is intentional here.
            // eslint-disable-next-line @next/next/no-img-element
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
                color: 'var(--accent-text)',
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
                {!demoMode && (
                  <button
                    data-onboard="profile-username"
                    data-haptic="light"
                    onClick={openUsernameEdit}
                    title="Change username"
                    style={{
                      position: 'relative',
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
                )}
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
                      fontSize: '16px', // ≥16px — anything smaller makes iOS auto-zoom on focus
                      outline: 'none',
                      minWidth: 0,
                    }}
                  />
                  <button
                    data-haptic="medium"
                    onClick={saveUsername}
                    style={{
                      position: 'relative',
                      padding: '7px 12px',
                      backgroundColor: canSaveUsername ? 'var(--accent)' : 'var(--surface-elevated)',
                      color: canSaveUsername ? 'var(--on-accent)' : 'var(--text-muted)',
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
                    data-haptic="light"
                    onClick={cancelUsernameEdit}
                    style={{
                      position: 'relative',
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
            { icon: <FlameIcon size={24} color="var(--accent-text)" />, value: stats.current_streak, label: 'CURRENT STREAK' },
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

        <div className="stat-grid-4">
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

      <BodyWeightCard />

      {/* Badges */}
      <div style={{ marginBottom: '32px' }}>
        <button
          data-onboard="profile-badges"
          aria-expanded={badgesOpen}
          aria-controls="profile-badge-grid"
          onClick={() => {
            // Drop any open tooltip on the way out — it's absolutely
            // positioned and would otherwise ride the drawer closed.
            if (badgesOpen) setTooltipBadgeId(null)
            setBadgesOpen(v => !v)
          }}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: badgesOpen ? '12px 12px 0 0' : '12px',
            padding: '14px 16px',
            cursor: 'pointer',
            transition: 'border-color 150ms ease, border-radius 260ms ease',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-border-strong)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          <div style={{
            fontSize: '12px', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '1.5px',
          }}>
            BADGES
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{earnedCount}/{ALL_BADGES.length}</span>
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transition: 'transform 150ms ease', transform: badgesOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--text-muted)' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </button>

        {/* Always mounted so the drawer can animate to its natural height (see
            .drawer in globals.css). The inner wrapper clips during the slide;
            it opens up again only while a badge tooltip needs to escape the
            bottom edge, which can't happen until the drawer is already open. */}
        <div className="drawer" data-open={badgesOpen}>
        <div style={{ overflow: tooltipBadgeId ? 'visible' : undefined }}>
        <div
          id="profile-badge-grid"
          className="badge-grid"
          inert={!badgesOpen}
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderTop: 'none',
            borderRadius: '0 0 12px 12px',
            padding: '10px',
          }}>
          {ALL_BADGES.map((badge) => {
            const earned = earnedSet.has(badge.id)
            const showTooltip = tooltipBadgeId === badge.id
            return (
              <div
                key={badge.id}
                className="press"
                style={{
                  backgroundColor: 'var(--surface)',
                  border: `1px solid ${earned ? 'var(--accent-border)' : 'var(--border)'}`,
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
                } as CSSProperties}
                onMouseEnter={() => setTooltipBadgeId(badge.id)}
                onMouseLeave={() => setTooltipBadgeId(null)}
                onTouchEnd={(e) => { e.preventDefault(); setTooltipBadgeId(v => v === badge.id ? null : badge.id) }}
                onClick={() => setTooltipBadgeId(v => v === badge.id ? null : badge.id)}
              >
                {/* Subtle glow bg for earned */}
                {earned && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    backgroundColor: 'var(--accent-wash)',
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
                      {formatBadgeDescription(badge, fmt, unitLabel)}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        </div>
        </div>
      </div>

      {joinedLabel && (
        <div style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)', marginTop: '20px' }}>
          <span style={{ color: 'var(--accent-text)', fontWeight: 700 }}>GRINDing</span> since {joinedLabel}
        </div>
      )}

    </div>
  )
}
