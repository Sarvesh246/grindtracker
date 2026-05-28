'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const DAY_TYPE_COLORS: Record<string, string> = {
  push: '#c8f135',
  pull: '#8faa24',
  legs: '#5a7a1a',
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]

function toLocalDateKey(isoString: string): string {
  const d = new Date(isoString)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function WorkoutCalendar() {
  const router = useRouter()
  const supabase = createClient()

  const todayDate = new Date()
  todayDate.setHours(0, 0, 0, 0)

  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date()
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [workoutDays, setWorkoutDays] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadMonth() }, [currentMonth])

  async function loadMonth() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const monthStart = new Date(year, month, 1)
    const nextMonthStart = new Date(year, month + 1, 1)

    const { data } = await supabase
      .from('sessions')
      .select('completed_at, day_type')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .gte('completed_at', monthStart.toISOString())
      .lt('completed_at', nextMonthStart.toISOString())

    const map: Record<string, string> = {}
    for (const s of data ?? []) {
      const key = toLocalDateKey(s.completed_at)
      if (!map[key]) map[key] = s.day_type
    }
    setWorkoutDays(map)
    setLoading(false)
  }

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()

  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const isOnCurrentMonth =
    year === todayDate.getFullYear() && month === todayDate.getMonth()

  function handlePrev() {
    setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))
  }
  function handleNext() {
    if (isOnCurrentMonth) return
    setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))
  }

  return (
    <div style={{
      backgroundColor: '#1a1a1a',
      border: '1px solid #2e2e2e',
      borderRadius: '12px',
      padding: '16px',
    }}>
      {/* Month nav */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '14px',
      }}>
        <button
          onClick={handlePrev}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', color: '#888888', lineHeight: 1 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <span style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '16px',
          color: '#f0f0f0',
          letterSpacing: '1px',
        }}>
          {MONTH_NAMES[month]} {year}
        </span>

        <button
          onClick={handleNext}
          disabled={isOnCurrentMonth}
          style={{
            background: 'none', border: 'none',
            cursor: isOnCurrentMonth ? 'default' : 'pointer',
            padding: '4px 8px',
            color: isOnCurrentMonth ? '#3a3a3a' : '#888888',
            lineHeight: 1,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Weekday headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: '4px' }}>
        {WEEKDAYS.map(d => (
          <div key={d} style={{
            textAlign: 'center',
            fontSize: '9px',
            color: '#555555',
            letterSpacing: '0.5px',
            paddingBottom: '6px',
          }}>
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', opacity: loading ? 0.5 : 1, transition: 'opacity 150ms ease' }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} style={{ height: '40px' }} />

          const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const workoutType = workoutDays[dateKey]
          const dotColor = workoutType ? DAY_TYPE_COLORS[workoutType] : null

          const isToday = isOnCurrentMonth && day === todayDate.getDate()
          const isFuture =
            year > todayDate.getFullYear() ||
            (year === todayDate.getFullYear() && month > todayDate.getMonth()) ||
            (isOnCurrentMonth && day > todayDate.getDate())

          const textColor = dotColor ?? (isFuture ? '#333333' : isToday ? '#f0f0f0' : '#666666')

          const isClickable = !isFuture
          return (
            <div
              key={idx}
              onClick={() => {
                if (!isClickable) return
                // Today's record is editable from /log (active session) — past page locks to yesterday
                if (isToday) router.push('/log')
                else router.push(`/log/past?date=${dateKey}`)
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '40px',
                borderRadius: '8px',
                cursor: isClickable ? 'pointer' : 'default',
                border: isToday ? '1px solid #3a3a3a' : '1px solid transparent',
                backgroundColor: dotColor ? `${dotColor}15` : 'transparent',
                transition: 'background-color 150ms ease',
                gap: '3px',
              }}
              onMouseEnter={e => { if (isClickable) e.currentTarget.style.backgroundColor = dotColor ? `${dotColor}25` : '#242424' }}
              onMouseLeave={e => { if (isClickable) e.currentTarget.style.backgroundColor = dotColor ? `${dotColor}15` : 'transparent' }}
            >
              <span style={{
                fontSize: '13px',
                color: textColor,
                fontWeight: isToday ? 700 : 400,
                lineHeight: 1,
                fontFamily: "'DM Sans', sans-serif",
              }}>
                {day}
              </span>
              {dotColor && (
                <div style={{
                  width: '4px',
                  height: '4px',
                  borderRadius: '50%',
                  backgroundColor: dotColor,
                  flexShrink: 0,
                }} />
              )}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: '14px',
        marginTop: '12px',
        justifyContent: 'center',
      }}>
        {Object.entries(DAY_TYPE_COLORS).map(([type, color]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
            <span style={{ fontSize: '10px', color: '#555555', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {type}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
