'use client'
import { useState, useEffect, useRef, useMemo, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getLevel, getXpInCurrentLevel, getXpRequiredForLevel, getXpToNextLevel } from '@/lib/utils/gamification'
import { localDateKey } from '@/lib/utils/formatting'
import { ALL_BADGES } from '@/lib/utils/badges'
import BadgeIcon from '@/components/BadgeIcon'
import BodyWeightCard from './BodyWeightCard'
import { useUnit } from '@/lib/contexts/UnitContext'
import { useToast } from '@/lib/contexts/ToastContext'
import { getDefaultRest, setDefaultRest, getPauseRestOnExit, setPauseRestOnExit } from '@/lib/hooks/useRestTimer'
import { useTheme } from '@/lib/contexts/ThemeContext'
import ThemeToggle from '@/components/ThemeToggle'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import FeedbackModal from '@/components/FeedbackModal'
import Link from 'next/link'
import { useTour, type TourStep } from '@/components/onboarding/Tour'
import { useOnboarding } from '@/lib/contexts/OnboardingContext'

function FlameIcon({ size = 24, color = 'var(--accent-text)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z" />
      <path d="M12 12c0 2-1.5 3-1.5 4.5a1.5 1.5 0 0 0 3 0C13.5 15 12 14 12 12z" />
    </svg>
  )
}

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
  isAdmin: boolean
  recurringRestDays: number[]
}

const REST_DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] // 0=Sun..6=Sat, matches Date.getDay()/extract(dow)

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
  isAdmin,
  recurringRestDays,
}: Props) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { unit, toggleUnit, fmt, unitLabel } = useUnit()
  const { theme } = useTheme()
  const { reduceMotion, toggleReduceMotion } = useMotionPref()
  const toast = useToast()
  const [tooltipBadgeId, setTooltipBadgeId] = useState<string | null>(null)
  const [badgesOpen, setBadgesOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  // Default rest time (min:sec), persisted to localStorage via the rest-timer hook.
  const [restMin, setRestMin] = useState(2)
  const [restSec, setRestSec] = useState(0)
  // Whether "Save & Exit" freezes the active rest timer (default) or leaves it
  // running in the background, persisted to localStorage via the rest-timer hook.
  const [pauseRestOnExit, setPauseRestOnExitState] = useState(true)

  // Hydrate the default rest time and pause-on-exit preference from
  // localStorage (client-only external store) after mount.
  useEffect(() => {
    const total = getDefaultRest()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestMin(Math.floor(total / 60))
    setRestSec(total % 60)
    setPauseRestOnExitState(getPauseRestOnExit())
  }, [])

  function commitRest(min: number, sec: number) {
    const m = Math.max(0, Math.floor(min) || 0)
    const s = Math.min(59, Math.max(0, Math.floor(sec) || 0))
    setRestMin(m)
    setRestSec(s)
    setDefaultRest(Math.max(5, m * 60 + s)) // floor at 5s so the timer is never trivial
  }

  function togglePauseRestOnExit() {
    const next = !pauseRestOnExit
    setPauseRestOnExitState(next)
    setPauseRestOnExit(next)
  }

  // Recurring rest days (see docs/sql/14-rest-days.sql). Optimistic toggle
  // against user_rest_days directly — no recompute needed, since this config
  // only affects future recomputes (same reasoning as flex days, which never
  // trigger one either).
  const [restDays, setRestDays] = useState<Set<number>>(new Set(recurringRestDays))
  const [savingRestDay, setSavingRestDay] = useState<number | null>(null)

  async function toggleRestDay(dayOfWeek: number) {
    if (savingRestDay !== null) return
    const wasActive = restDays.has(dayOfWeek)
    setSavingRestDay(dayOfWeek)
    setRestDays(prev => {
      const next = new Set(prev)
      if (wasActive) next.delete(dayOfWeek); else next.add(dayOfWeek)
      return next
    })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSavingRestDay(null); return }

    const { error } = wasActive
      ? await supabase.from('user_rest_days').delete().eq('user_id', user.id).eq('day_of_week', dayOfWeek)
      : await supabase.from('user_rest_days').insert({ user_id: user.id, day_of_week: dayOfWeek })

    setSavingRestDay(null)
    if (error) {
      // Revert on failure.
      setRestDays(prev => {
        const next = new Set(prev)
        if (wasActive) next.add(dayOfWeek); else next.delete(dayOfWeek)
        return next
      })
      toast.show("Couldn't save rest day", 'error')
    } else {
      toast.show(wasActive ? 'Rest day removed' : 'Rest day saved')
    }
  }

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

  const xpTotal = stats.xp_total
  const level = getLevel(xpTotal)
  const xpInLevel = getXpInCurrentLevel(xpTotal)
  const levelSize = getXpRequiredForLevel(level)
  const xpToNext = getXpToNextLevel(xpTotal)
  const xpPercent = (xpInLevel / levelSize) * 100
  const earnedSet = new Set(earnedBadgeIds)
  const earnedCount = earnedBadgeIds.length
  // Distinct active days from server (local_date count) or legacy timestamp list.
  const distinctDays = useMemo(() => {
    if (typeof daysActive === 'number') return daysActive
    return new Set(activeDayTimestamps.map(t => localDateKey(new Date(t)))).size
  }, [daysActive, activeDayTimestamps])
  const joinedLabel = joinedAt
    ? new Date(joinedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Settings walkthrough. Paused while the username field is being edited (its
  // pencil target is swapped out) or the feedback modal is open.
  const profileSteps: TourStep[] = [
    { target: 'profile-username', title: 'Change your handle', body: 'Tap the pencil to change your @handle.' },
    { target: 'profile-unit', title: 'Weight units', body: 'Switch how weights display app-wide. Everything is still stored consistently under the hood.' },
    { target: 'profile-rest', title: 'Default rest time', body: 'Set your default rest between sets — override per-exercise from the rest timer during a workout.' },
    { target: 'profile-badges', title: 'Badges', body: 'Tap a badge to see how to earn it.' },
  ]
  const profileTour = useTour('profile', profileSteps, {
    active: !editingUsername && !feedbackOpen,
  })

  const { resetAllTours } = useOnboarding()
  function handleReplayTutorial() {
    resetAllTours()
    toast.show("Tutorial reset — it'll show again as you use the app")
    router.push('/home')
  }

  return (
    <div className="page page--profile" style={{
      fontFamily: "'DM Sans', sans-serif",
      padding: '0 16px 48px',
    }}>
      {profileTour}

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
                <button
                  data-onboard="profile-username"
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
                      fontSize: '16px', // ≥16px — anything smaller makes iOS auto-zoom on focus
                      outline: 'none',
                      minWidth: 0,
                    }}
                  />
                  <button
                    onClick={saveUsername}
                    style={{
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

      {/* Settings */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          fontSize: '12px', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '1.5px',
          marginBottom: '10px',
        }}>
          SETTINGS
        </div>
        <div style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}>
          {/* Appearance */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '2px' }}>
                Appearance
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {theme === 'light' ? 'Light mode' : 'Dark mode'}
              </div>
            </div>
            <ThemeToggle size={32} />
          </div>

          <div style={{ height: '1px', backgroundColor: 'var(--border)' }} />

          {/* Reduce motion */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '2px' }}>
                Reduce Motion
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Minimizes motion — notifications, charts, and celebrations appear instantly instead of animating in
              </div>
            </div>
            <button
              onClick={toggleReduceMotion}
              role="switch"
              aria-checked={reduceMotion}
              aria-label="Reduce motion"
              style={{
                width: '44px',
                height: '26px',
                flexShrink: 0,
                borderRadius: '9999px',
                border: 'none',
                position: 'relative',
                cursor: 'pointer',
                backgroundColor: reduceMotion ? 'var(--accent)' : 'var(--surface-elevated)',
                boxShadow: reduceMotion ? 'none' : 'inset 0 0 0 1px var(--border)',
                transition: 'background-color 150ms ease',
              }}
            >
              <span style={{
                position: 'absolute',
                top: '3px',
                left: reduceMotion ? '21px' : '3px',
                width: '20px',
                height: '20px',
                borderRadius: '9999px',
                backgroundColor: reduceMotion ? 'var(--on-accent)' : 'var(--text-muted)',
                transition: 'left 150ms ease',
              }} />
            </button>
          </div>

          <div style={{ height: '1px', backgroundColor: 'var(--border)' }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '2px' }}>
              Weight Unit
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {unit === 'metric' ? 'Kilograms (kg)' : 'Pounds (lbs)'}
            </div>
          </div>
          <button
            data-onboard="profile-unit"
            onClick={toggleUnit}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '9999px',
              padding: '3px',
              cursor: 'pointer',
              position: 'relative',
              width: '80px',
              height: '32px',
              flexShrink: 0,
            }}
          >
            {/* KG label */}
            <span style={{
              flex: 1,
              textAlign: 'center',
              fontSize: '11px',
              fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif",
              color: unit === 'metric' ? 'var(--on-accent)' : 'var(--text-muted)',
              position: 'relative',
              zIndex: 1,
              letterSpacing: '0.5px',
            }}>KG</span>
            {/* LBS label */}
            <span style={{
              flex: 1,
              textAlign: 'center',
              fontSize: '11px',
              fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif",
              color: unit === 'imperial' ? 'var(--on-accent)' : 'var(--text-muted)',
              position: 'relative',
              zIndex: 1,
              letterSpacing: '0.5px',
            }}>LBS</span>
            {/* Sliding pill */}
            <div style={{
              position: 'absolute',
              top: '3px',
              left: unit === 'metric' ? '3px' : 'calc(50% + 1px)',
              width: 'calc(50% - 4px)',
              height: 'calc(100% - 6px)',
              backgroundColor: 'var(--accent)',
              borderRadius: '9999px',
              transition: 'left 150ms ease',
            }} />
          </button>
          </div>

          <div style={{ height: '1px', backgroundColor: 'var(--border)' }} />

          {/* Default rest time */}
          <div data-onboard="profile-rest" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '2px' }}>
                Default Rest Time
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Used between sets unless changed per exercise
              </div>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '9999px',
              padding: '3px 10px',
              height: '32px',
            }}>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={restMin}
                onChange={e => commitRest(Number(e.target.value), restSec)}
                aria-label="Default rest minutes"
                style={{
                  width: '28px', background: 'transparent', border: 'none', outline: 'none',
                  color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '16px', textAlign: 'right', // ≥16px input prevents iOS auto-zoom on focus
                }}
              />
              <span style={{ color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", fontSize: '14px' }}>:</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                value={String(restSec).padStart(2, '0')}
                onChange={e => commitRest(restMin, Number(e.target.value))}
                aria-label="Default rest seconds"
                style={{
                  width: '28px', background: 'transparent', border: 'none', outline: 'none',
                  color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '16px', textAlign: 'left', // ≥16px input prevents iOS auto-zoom on focus
                }}
              />
            </div>
          </div>

          <div style={{ height: '1px', backgroundColor: 'var(--border)' }} />

          {/* Rest timer on Save & Exit — default freezes it in place so it doesn't
              keep counting down while the workout is closed; toggling this off
              leaves it running in the background instead. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '2px' }}>
                Pause Rest Timer on Exit
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {pauseRestOnExit
                  ? 'Save & Exit freezes the timer, resumes where you left off'
                  : 'Save & Exit lets the timer keep counting down'}
              </div>
            </div>
            <button
              onClick={togglePauseRestOnExit}
              role="switch"
              aria-checked={pauseRestOnExit}
              aria-label="Pause rest timer on exit"
              style={{
                width: '44px',
                height: '26px',
                flexShrink: 0,
                borderRadius: '9999px',
                border: 'none',
                position: 'relative',
                cursor: 'pointer',
                backgroundColor: pauseRestOnExit ? 'var(--accent)' : 'var(--surface-elevated)',
                boxShadow: pauseRestOnExit ? 'none' : 'inset 0 0 0 1px var(--border)',
                transition: 'background-color 150ms ease',
              }}
            >
              <span style={{
                position: 'absolute',
                top: '3px',
                left: pauseRestOnExit ? '21px' : '3px',
                width: '20px',
                height: '20px',
                borderRadius: '9999px',
                backgroundColor: pauseRestOnExit ? 'var(--on-accent)' : 'var(--text-muted)',
                transition: 'left 150ms ease',
              }} />
            </button>
          </div>

          <div style={{ height: '1px', backgroundColor: 'var(--border)' }} />

          {/* Rest days — recurring weekly days off that don't break the streak.
              A day covered here bridges any gap it falls in automatically; see
              CLAUDE.md → Rest days for how this connects to the home banner.
              Stacked (label above, pills below) rather than this card's usual
              label-left/control-right row — a 7-pill control is wider than
              any sibling control here and would crowd the label on mobile. */}
          <div>
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '2px' }}>
                Rest Days
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Won&apos;t break your streak
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'space-between' }}>
              {REST_DAY_LABELS.map((label, dayOfWeek) => {
                const active = restDays.has(dayOfWeek)
                return (
                  <button
                    key={dayOfWeek}
                    onClick={() => toggleRestDay(dayOfWeek)}
                    disabled={savingRestDay !== null}
                    aria-pressed={active}
                    aria-label={`${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayOfWeek]} rest day`}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '9999px',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      backgroundColor: active ? 'var(--accent)' : 'var(--surface-elevated)',
                      color: active ? 'var(--on-accent)' : 'var(--text-muted)',
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: savingRestDay !== null ? 'default' : 'pointer',
                      opacity: savingRestDay !== null && savingRestDay !== dayOfWeek ? 0.6 : 1,
                      transition: 'all 150ms ease',
                      padding: 0,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ height: '1px', backgroundColor: 'var(--border)' }} />

          {/* Send feedback — the only entry point users have to reach me. */}
          <button
            onClick={() => setFeedbackOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '12px', width: '100%',
              background: 'transparent', border: 'none', padding: 0,
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '2px' }}>
                Send Feedback
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Report a bug or request a feature
              </div>
            </div>
            <span style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '32px', height: '32px', flexShrink: 0,
              borderRadius: '9999px',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              color: 'var(--accent-text)',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </span>
          </button>

          <div style={{ height: '1px', backgroundColor: 'var(--border)' }} />

          {/* Replay tutorial — resets every tour/tooltip (and both the tours'
              "skip all" and the tooltips' "skip tips" opt-outs) server-side,
              so the full walkthrough runs again from Home. */}
          <button
            onClick={handleReplayTutorial}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '12px', width: '100%',
              background: 'transparent', border: 'none', padding: 0,
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '2px' }}>
                Replay Tutorial
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Show the app walkthrough again from Home
              </div>
            </div>
            <span style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '32px', height: '32px', flexShrink: 0,
              borderRadius: '9999px',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              color: 'var(--accent-text)',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 2.6-6.36" />
                <path d="M3 4v5h5" />
              </svg>
            </span>
          </button>

          {/* Developer inbox. Rendered only for the admin account; the route
              404s and RLS returns nothing for anyone else regardless. */}
          {isAdmin && (
            <>
              <div style={{ height: '1px', backgroundColor: 'var(--border)' }} />
              <Link
                href="/admin/feedback"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: '12px', textDecoration: 'none',
                }}
              >
                <div>
                  <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '2px' }}>
                    Feedback Inbox
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Everything users have sent in
                  </div>
                </div>
                <span style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '32px', height: '32px', flexShrink: 0,
                  borderRadius: '9999px',
                  backgroundColor: 'var(--accent-wash)',
                  border: '1px solid var(--border)',
                  color: 'var(--accent-text)',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16v16H4z" />
                    <polyline points="4 7 12 13 20 7" />
                  </svg>
                </span>
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Mounted only while open so each visit starts from a clean form. */}
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}

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
                      {badge.formatDescription ? badge.formatDescription(fmt, unitLabel) : badge.description}
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

      {joinedLabel && (
        <div style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)', marginTop: '20px' }}>
          <span style={{ color: 'var(--accent-text)', fontWeight: 700 }}>GRINDing</span> since {joinedLabel}
        </div>
      )}

    </div>
  )
}
