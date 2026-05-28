'use client'
import { useRouter } from 'next/navigation'

function PushIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Barbell */}
      <line x1="5" y1="12" x2="19" y2="12" />
      <rect x="2" y="9.5" width="3" height="5" rx="1" />
      <rect x="19" y="9.5" width="3" height="5" rx="1" />
      {/* Arrow indicating push */}
      <polyline points="13 8 17 12 13 16" />
    </svg>
  )
}

function PullIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Barbell */}
      <line x1="5" y1="12" x2="19" y2="12" />
      <rect x="2" y="9.5" width="3" height="5" rx="1" />
      <rect x="19" y="9.5" width="3" height="5" rx="1" />
      {/* Arrow indicating pull */}
      <polyline points="11 8 7 12 11 16" />
    </svg>
  )
}

function LegsIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Squat silhouette — torso + bent legs */}
      <circle cx="12" cy="4" r="2" />
      <line x1="12" y1="6" x2="12" y2="11" />
      <line x1="12" y1="11" x2="7" y2="16" />
      <line x1="7" y1="16" x2="7" y2="21" />
      <line x1="12" y1="11" x2="17" y2="16" />
      <line x1="17" y1="16" x2="17" y2="21" />
      <line x1="5" y1="21" x2="9" y2="21" />
      <line x1="15" y1="21" x2="19" y2="21" />
    </svg>
  )
}

const DAYS = [
  {
    key: 'push',
    label: 'PUSH',
    muscles: 'Chest, Shoulders, Triceps',
    count: '5 exercises',
    Icon: PushIcon,
  },
  {
    key: 'pull',
    label: 'PULL',
    muscles: 'Back, Biceps, Rear Delts',
    count: '6 exercises',
    Icon: PullIcon,
  },
  {
    key: 'legs',
    label: 'LEGS',
    muscles: 'Quads, Hamstrings, Glutes, Calves',
    count: '6 exercises',
    Icon: LegsIcon,
  },
]

export default function DaySelect() {
  const router = useRouter()

  return (
    <div style={{ padding: '24px 16px', fontFamily: "'DM Sans', sans-serif" }}>
      <h1 style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: '32px',
        color: '#f0f0f0',
        marginBottom: '24px',
        letterSpacing: '1px',
      }}>
        CHOOSE YOUR DAY
      </h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {DAYS.map((day) => (
          <button
            key={day.key}
            onClick={() => router.push(`/log?day=${day.key}`)}
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
                <day.Icon />
                <span style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: '28px',
                  color: '#c8f135',
                  letterSpacing: '1px',
                }}>
                  {day.label}
                </span>
              </div>
              <span style={{ fontSize: '12px', color: '#555555' }}>
                {day.count}
              </span>
            </div>
            <div style={{ fontSize: '14px', color: '#888888' }}>
              {day.muscles}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
