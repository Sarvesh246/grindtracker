'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Distinct, clearly differentiated colors for known day types
const NAMED_COLORS: Record<string, string> = {
  push: '#c8f135',  // lime green (matches app accent)
  pull: '#38bdf8',  // sky blue
  legs: '#fb923c',  // orange
}

// Fallback pool for any additional day types the user adds
const EXTRA_COLORS = ['#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#e879f9']

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]

function toLocalDateKey(isoString: string): string {
  const d = new Date(isoString)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function resolveColor(type: string, extraTypes: string[]): string {
  if (NAMED_COLORS[type]) return NAMED_COLORS[type]
  const idx = extraTypes.indexOf(type)
  return EXTRA_COLORS[idx % EXTRA_COLORS.length]
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

  // eslint-disable-next-line react-hooks/immutability
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

  // Resolve colors dynamically so any extra day types get a unique color
  const allTypes = Object.values(workoutDays)
  const extraTypes = [...new Set(allTypes.filter(t => !NAMED_COLORS[t]))]
  // Always show all named day types; append any unrecognised ones from this month's data
  const legendTypes = [...Object.keys(NAMED_COLORS), ...extraTypes]

  function handlePrev() {
    setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))
  }
  function handleNext() {
    if (isOnCurrentMonth) return
    setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))
  }

  return (
    <div style={{
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
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
          aria-label="Previous month"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', color: 'var(--text-secondary)', lineHeight: 1 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <span style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '16px',
          color: 'var(--text-primary)',
          letterSpacing: '1px',
        }}>
          {MONTH_NAMES[month]} {year}
        </span>

        <button
          onClick={handleNext}
          disabled={isOnCurrentMonth}
          aria-label="Next month"
          style={{
            background: 'none', border: 'none',
            cursor: isOnCurrentMonth ? 'default' : 'pointer',
            padding: '4px 8px',
            color: isOnCurrentMonth ? 'var(--border-strong)' : 'var(--text-secondary)',
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
            color: 'var(--text-muted)',
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
          const dotColor = workoutType ? resolveColor(workoutType, extraTypes) : null

          const isToday = isOnCurrentMonth && day === todayDate.getDate()
          const isFuture =
            year > todayDate.getFullYear() ||
            (year === todayDate.getFullYear() && month > todayDate.getMonth()) ||
            (isOnCurrentMonth && day > todayDate.getDate())

          const textColor = dotColor
            ? dotColor
            : isFuture
              ? 'var(--text-disabled)'
              : isToday
                ? 'var(--text-primary)'
                : 'var(--text-muted)'

          const isClickable = !isFuture

          // Base styles for the cell background and border
          const baseBg = dotColor ? `${dotColor}28` : 'transparent'
          const baseBorder = isToday
            ? '1px solid var(--border-strong)'
            : dotColor
              ? `1px solid ${dotColor}55`
              : '1px solid transparent'

          const hoverBg = dotColor ? `${dotColor}55` : 'rgba(255,255,255,0.06)'
          const hoverBorder = isToday
            ? '1px solid var(--border-strong)'
            : dotColor
              ? `1px solid ${dotColor}cc`
              : '1px solid var(--border)'

          return (
            <div
              key={idx}
              onClick={() => {
                if (!isClickable) return
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
                border: baseBorder,
                backgroundColor: baseBg,
                transition: 'background-color 150ms ease, border-color 150ms ease',
                gap: '3px',
              }}
              onMouseEnter={e => {
                if (!isClickable) return
                e.currentTarget.style.backgroundColor = hoverBg
                e.currentTarget.style.borderColor = hoverBorder.replace('1px solid ', '')
              }}
              onMouseLeave={e => {
                if (!isClickable) return
                e.currentTarget.style.backgroundColor = baseBg
                e.currentTarget.style.borderColor = baseBorder.replace('1px solid ', '')
              }}
            >
              <span style={{
                fontSize: '13px',
                color: textColor,
                fontWeight: isToday ? 700 : dotColor ? 600 : 400,
                lineHeight: 1,
                fontFamily: "'DM Sans', sans-serif",
              }}>
                {day}
              </span>
              {dotColor && (
                <div style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  backgroundColor: dotColor,
                  flexShrink: 0,
                }} />
              )}
            </div>
          )
        })}
      </div>

      {/* Legend — always shows all named types; extra types from data appended */}
      <div style={{ display: 'flex', gap: '14px', marginTop: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {legendTypes.map(type => {
          const color = resolveColor(type, extraTypes)
          return (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: color,
                flexShrink: 0,
                boxShadow: `0 0 4px ${color}80`,
              }} />
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {type}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
