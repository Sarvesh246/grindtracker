'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Exercise, UserRotation } from '@/lib/types'
import { haptic } from '@/lib/utils/haptics'
import { effectiveSequence, nextDay as nextDayFromRotation } from '@/lib/utils/rotation'
import WorkoutManager from './WorkoutManager'

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
  const supabase = useMemo(() => createClient(), [])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [rotation, setRotation] = useState<UserRotation | null>(null)
  const [flexDays, setFlexDays] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [showManager, setShowManager] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
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
  const dayKeys = Object.keys(grouped).sort()

  // Non-binding hint: the day the rotation suggests next (flex days excluded).
  const upNext = nextDayFromRotation(effectiveSequence(rotation, dayKeys, flexDays), rotation?.current_index ?? -1)

  return (
    <>
      <div className="page page--wide" style={{ padding: '24px 16px', fontFamily: "'DM Sans', sans-serif" }}>
        {/* Header row */}
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

        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading...</div>
        ) : dayKeys.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.6 }}>
            No workout days yet.{' '}
            <button
              onClick={() => setShowManager(true)}
              style={{ background: 'none', border: 'none', color: 'var(--accent-text)', cursor: 'pointer', fontSize: '14px', padding: 0, fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}
            >
              Add one
            </button>
            {' '}to get started.
          </div>
        ) : (
          <div className="day-grid">
            {dayKeys.map(key => {
              const exs = grouped[key]
              const Icon = DAY_ICONS[key] ?? DefaultDayIcon
              const description = exs.slice(0, 3).map(e => e.name).join(', ') + (exs.length > 3 ? '…' : '')
              const isUpNext = key === upNext
              return (
                <button
                  key={key}
                  onClick={() => {
                    haptic('heavy')
                    router.push(`/log?day=${key}`)
                  }}
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: isUpNext ? '1px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '20px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'border-color 150ms ease',
                    width: '100%',
                  }}
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
                          {exs.length} exercise{exs.length !== 1 ? 's' : ''}
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

        {!loading && (
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button
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
          onClose={() => setShowManager(false)}
          onChanged={() => load()}
        />
      )}
    </>
  )
}
