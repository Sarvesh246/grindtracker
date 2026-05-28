'use client'
import { useRouter } from 'next/navigation'

const DAYS = [
  {
    key: 'push',
    label: 'PUSH',
    muscles: 'Chest, Shoulders, Triceps',
    count: '5 exercises',
    emoji: '🤜',
  },
  {
    key: 'pull',
    label: 'PULL',
    muscles: 'Back, Biceps, Rear Delts',
    count: '6 exercises',
    emoji: '🤛',
  },
  {
    key: 'legs',
    label: 'LEGS',
    muscles: 'Quads, Hamstrings, Glutes, Calves',
    count: '6 exercises',
    emoji: '🦵',
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
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '28px',
                color: '#c8f135',
                letterSpacing: '1px',
              }}>
                {day.emoji} {day.label}
              </span>
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
