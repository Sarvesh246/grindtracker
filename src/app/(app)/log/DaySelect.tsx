'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Exercise } from '@/lib/types'
import WorkoutManager from './WorkoutManager'

function PushIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
  const supabase = createClient()
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [loading, setLoading] = useState(true)
  const [showManager, setShowManager] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .order('day_type', { ascending: true })
      .order('sort_order', { ascending: true })
    setExercises(data ?? [])
    setLoading(false)
  }

  const grouped: Record<string, Exercise[]> = {}
  for (const ex of exercises) {
    if (!grouped[ex.day_type]) grouped[ex.day_type] = []
    grouped[ex.day_type].push(ex)
  }
  const dayKeys = Object.keys(grouped).sort()

  return (
    <>
      <div style={{ padding: '24px 16px', fontFamily: "'DM Sans', sans-serif" }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h1 style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '32px',
            color: '#f0f0f0',
            letterSpacing: '1px',
            margin: 0,
          }}>
            CHOOSE YOUR DAY
          </h1>
          <button
            onClick={() => setShowManager(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              backgroundColor: '#242424',
              border: '1px solid #2e2e2e',
              borderRadius: '8px',
              padding: '8px 12px',
              cursor: 'pointer',
              transition: 'border-color 150ms ease',
              flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#c8f135')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#2e2e2e')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span style={{ fontSize: '12px', color: '#888888', fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
              MANAGE
            </span>
          </button>
        </div>

        {loading ? (
          <div style={{ color: '#555555', fontSize: '14px' }}>Loading...</div>
        ) : dayKeys.length === 0 ? (
          <div style={{ color: '#555555', fontSize: '14px', lineHeight: 1.6 }}>
            No workout days yet.{' '}
            <button
              onClick={() => setShowManager(true)}
              style={{ background: 'none', border: 'none', color: '#c8f135', cursor: 'pointer', fontSize: '14px', padding: 0, fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}
            >
              Add one
            </button>
            {' '}to get started.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {dayKeys.map(key => {
              const exs = grouped[key]
              const Icon = DAY_ICONS[key] ?? DefaultDayIcon
              const description = exs.slice(0, 3).map(e => e.name).join(', ') + (exs.length > 3 ? '…' : '')
              return (
                <button
                  key={key}
                  onClick={() => router.push(`/log?day=${key}`)}
                  style={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #2e2e2e',
                    borderRadius: '12px',
                    padding: '20px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'border-color 150ms ease',
                    width: '100%',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#c8f135')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#2e2e2e')}
                  onTouchStart={e => (e.currentTarget.style.borderColor = '#c8f135')}
                  onTouchEnd={e => (e.currentTarget.style.borderColor = '#2e2e2e')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Icon />
                      <span style={{
                        fontFamily: "'Bebas Neue', sans-serif",
                        fontSize: '28px',
                        color: '#c8f135',
                        letterSpacing: '1px',
                      }}>
                        {key.replace(/-/g, ' ').toUpperCase()}
                      </span>
                    </div>
                    <span style={{ fontSize: '12px', color: '#555555' }}>
                      {exs.length} exercise{exs.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: '14px', color: '#888888' }}>
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
                color: '#555555',
                fontFamily: "'DM Sans', sans-serif",
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                padding: '4px 8px',
                transition: 'color 150ms ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#888888')}
              onMouseLeave={e => (e.currentTarget.style.color = '#555555')}
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
