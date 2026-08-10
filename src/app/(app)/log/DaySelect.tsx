'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Exercise, UserRotation } from '@/lib/types'
import { haptic } from '@/lib/utils/haptics'
import { effectiveSequence, nextDay as nextDayFromRotation, orderedDayKeys } from '@/lib/utils/rotation'
import WorkoutManager from './WorkoutManager'
import { useTour, type TourStep } from '@/components/onboarding/Tour'

function PushIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
      <line x1="5" y1="17" x2="5" y2="21" />
      <line x1="19" y1="17" x2="19" y2="21" />
      <rect x="3" y="14" width="18" height="3" rx="1.5" />
      <line x1="7" y1="9" x2="17" y2="9" />
      <rect x="4" y="6.5" width="3" height="5" rx="1" />
      <rect x="17" y="6.5" width="3" height="5" rx="1" />
    </svg>
  )
}

function PullIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
      <line x1="4" y1="4" x2="4" y2="20" />
      <line x1="20" y1="4" x2="20" y2="20" />
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="9" y1="7" x2="9" y2="13" />
      <line x1="15" y1="7" x2="15" y2="13" />
      <line x1="7" y1="13" x2="11" y2="13" />
      <line x1="13" y1="13" x2="17" y2="13" />
    </svg>
  )
}

function LegsIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
      <line x1="5" y1="3" x2="5" y2="21" />
      <line x1="19" y1="3" x2="19" y2="21" />
      <polyline points="5 10 8 10 8 13" />
      <polyline points="19 10 16 10 16 13" />
      <line x1="8" y1="10" x2="16" y2="10" />
      <rect x="2" y="7" width="3" height="6" rx="1" />
      <rect x="19" y="7" width="3" height="6" rx="1" />
    </svg>
  )
}

function DefaultDayIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
      <line x1="6" y1="12" x2="18" y2="12" />
      <rect x="2" y="9" width="4" height="6" rx="1.5" />
      <rect x="18" y="9" width="4" height="6" rx="1.5" />
    </svg>
  )
}

const DAY_ICONS: Record<string, React.FC> = {
  push: PushIcon,
  pull: PullIcon,
  legs: LegsIcon,
}

export default function DaySelect() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [rotation, setRotation] = useState<UserRotation | null>(null)
  const [flexDays, setFlexDays] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  // Set only when the exercises fetch itself fails — an existing user must
  // never see the blank-slate "SET UP YOUR FIRST DAY" hero over a transient
  // network/RLS blip; that reads as their days having vanished.
  const [loadError, setLoadError] = useState(false)
  const [showManager, setShowManager] = useState(false)
  // When true, the manager opens straight into the "new day" form — used by the
  // blank-slate hero and the `?new=1` deep link from Home, so "create a day" is
  // a single tap rather than a hunt for the gear icon.
  const [managerNewDay, setManagerNewDay] = useState(false)

  const openCreateDay = useCallback(() => {
    setManagerNewDay(true)
    setShowManager(true)
  }, [])

  const closeManager = useCallback(() => {
    setShowManager(false)
    setManagerNewDay(false)
  }, [])

  // Deep link from the first-run CTAs (`/log?new=1`) opens the create-day form
  // once, then strips the param so a refresh or back-nav doesn't reopen it.
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpened.current) return
    if (searchParams.get('new')) {
      autoOpened.current = true
      // Syncing a one-shot URL intent into local state on mount — the same
      // "read from an external system once" case the login page handles this way.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      openCreateDay()
      router.replace('/log')
    }
  }, [searchParams, router, openCreateDay])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    const { data: { user } } = await supabase.auth.getUser()
    const [exRes, rotRes, flexRes] = await Promise.all([
      supabase.from('exercises').select('*')
        .order('day_type', { ascending: true })
        .order('sort_order', { ascending: true }),
      user
        ? supabase.from('user_rotation').select('*').eq('user_id', user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      user
        ? supabase.from('user_flex_days').select('day_key').eq('user_id', user.id)
        : Promise.resolve({ data: [] as { day_key: string }[] }),
    ])
    if (exRes.error) {
      console.error('[grind] failed to load exercises', exRes.error)
      setLoadError(true)
      setLoading(false)
      return
    }
    setExercises(exRes.data ?? [])
    setRotation((rotRes.data as UserRotation | null) ?? null)
    setFlexDays(new Set((flexRes.data ?? []).map(r => r.day_key)))
    setLoading(false)
  }, [supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const grouped: Record<string, Exercise[]> = {}
  for (const ex of exercises) {
    if (!grouped[ex.day_type]) grouped[ex.day_type] = []
    grouped[ex.day_type].push(ex)
  }
  // Displayed in the user's chosen "workout order" (WorkoutManager → Edit
  // workout order), not alphabetically — a manual sequence is otherwise
  // invisible everywhere except the rotation editor itself.
  const effectiveSeq = effectiveSequence(rotation, Object.keys(grouped), flexDays)
  const dayKeys = orderedDayKeys(Object.keys(grouped), effectiveSeq)

  // Non-binding hint: the day the rotation suggests next (flex days excluded).
  const upNext = nextDayFromRotation(effectiveSeq, rotation?.current_index ?? -1)

  // Walkthrough only applies once the user actually has days (the MANAGE button
  // and "log a past workout" link that steps 2/3 point at don't exist on the
  // blank slate). Paused while the manager sheet is open.
  const daySteps: TourStep[] = [
    { target: 'dayselect-days', title: 'Pick a day', body: 'Tap a day to start logging. UP NEXT highlights what GRIND suggests based on your rotation.' },
    { target: 'dayselect-manage', title: 'Manage days', body: 'Add, edit, reorder, or remove your workout days and exercises here.' },
    { target: 'dayselect-past', title: 'Log a past workout', body: 'Forgot to log a session live? Add it retroactively here.' },
  ]
  const dayTour = useTour('log-dayselect', daySteps, {
    active: !loading && dayKeys.length > 0 && !showManager,
  })

  return (
    <>
      {dayTour}
      <div className="page page--wide" style={{ padding: '24px 16px', fontFamily: "'DM Sans', sans-serif" }}>
        {/* Header row — hidden on the blank slate so the setup hero owns the
            screen (there's nothing to "choose" yet, and the hero carries its own
            create button, so the gear would just be visual noise). */}
        {(loading || dayKeys.length > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h1 style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '32px',
            color: 'var(--text-primary)',
            letterSpacing: '1px',
            margin: 0,
          }}>
            CHOOSE YOUR DAY
          </h1>
          <button
            data-onboard="dayselect-manage"
            onClick={() => setShowManager(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '8px 12px',
              cursor: 'pointer',
              transition: 'border-color 150ms ease',
              flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
              MANAGE
            </span>
          </button>
        </div>
        )}

        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading...</div>
        ) : loadError ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            textAlign: 'center', gap: '12px', padding: '56px 24px 40px',
          }}>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              Couldn&apos;t load your workout days. Check your connection and try again.
            </p>
            <button
              onClick={() => load()}
              style={{
                height: '44px', padding: '0 24px',
                backgroundColor: 'var(--surface-elevated)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', borderRadius: '10px',
                fontFamily: "'DM Sans', sans-serif", fontSize: '14px', fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        ) : dayKeys.length === 0 ? (
          /* Blank-slate hero — the direct continuation of Home's "SET UP YOUR
             FIRST DAY". Same visual language (accent icon badge, Bebas title,
             lime button) so the CTA the user tapped simply grows into this
             screen, and one obvious button opens the create-day form. */
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '16px',
            padding: '56px 24px 40px',
          }}>
            <span style={{
              width: '76px', height: '76px', borderRadius: '9999px',
              backgroundColor: 'var(--accent-wash)', color: 'var(--accent-text)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <DefaultDayIcon />
            </span>
            <h2 style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: '28px',
              color: 'var(--text-primary)', letterSpacing: '1px', lineHeight: 1, margin: 0,
            }}>
              SET UP YOUR FIRST DAY
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', maxWidth: '320px', lineHeight: 1.5 }}>
              Create a workout day — like Push, Pull, or Legs — add your exercises,
              and you&apos;re ready to train. Takes about a minute.
            </p>
            <button
              onClick={openCreateDay}
              style={{
                marginTop: '4px', height: '52px', padding: '0 32px',
                backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: 'none',
                borderRadius: '12px', fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '20px', letterSpacing: '1px', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '10px',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              CREATE A DAY
            </button>
          </div>
        ) : (
          <div className="day-grid stagger">
            {dayKeys.map((key, idx) => {
              const exs = grouped[key]
              // Preview only active exercises so it matches what the live
              // workout will actually offer (17-exercise-active-flag.sql).
              const activeExs = exs.filter(e => e.active)
              const Icon = DAY_ICONS[key] ?? DefaultDayIcon
              const description = activeExs.slice(0, 3).map(e => e.name).join(', ') + (activeExs.length > 3 ? '…' : '')
              const isUpNext = key === upNext
              return (
                <button
                  key={key}
                  className="press-card"
                  data-onboard={idx === 0 ? 'dayselect-days' : undefined}
                  data-haptic="heavy"
                  onClick={() => {
                    // Sync — Android vibrate; iOS overlay already ticked on press.
                    haptic('heavy')
                    router.push(`/log?day=${key}`)
                  }}
                  style={{
                    '--i': idx,
                    position: 'relative',
                    backgroundColor: 'var(--surface)',
                    border: isUpNext ? '1px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '20px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    width: '100%',
                  } as CSSProperties}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = isUpNext ? 'var(--accent)' : 'var(--border)')}
                  onTouchStart={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onTouchEnd={e => (e.currentTarget.style.borderColor = isUpNext ? 'var(--accent)' : 'var(--border)')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Icon />
                      <span style={{
                        fontFamily: "'Bebas Neue', sans-serif",
                        fontSize: '28px',
                        color: 'var(--accent-text)',
                        letterSpacing: '1px',
                      }}>
                        {key.replace(/-/g, ' ').toUpperCase()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {flexDays.has(key) && (
                        <span style={{
                          fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border)',
                          padding: '2px 7px', borderRadius: '9999px',
                          fontFamily: "'DM Sans', sans-serif",
                        }}>
                          FLEX
                        </span>
                      )}
                      {isUpNext ? (
                        <span style={{
                          fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
                          color: 'var(--bg)', backgroundColor: 'var(--accent)',
                          padding: '3px 8px', borderRadius: '9999px',
                          fontFamily: "'DM Sans', sans-serif",
                        }}>
                          UP NEXT
                        </span>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          {activeExs.length} exercise{activeExs.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                    {description}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* "Log a past workout" is a power feature — only surface it once the
            user actually has days/history. On the blank slate it would just pull
            focus away from the one thing that matters: creating a day. */}
        {!loading && dayKeys.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button
              data-onboard="dayselect-past"
              onClick={() => router.push('/log/past')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                color: 'var(--text-muted)',
                fontFamily: "'DM Sans', sans-serif",
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                padding: '4px 8px',
                transition: 'color 150ms ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              Log a past workout
            </button>
          </div>
        )}
      </div>

      {showManager && (
        <WorkoutManager
          onClose={closeManager}
          onChanged={() => load()}
          initialNewDay={managerNewDay}
        />
      )}
    </>
  )
}
