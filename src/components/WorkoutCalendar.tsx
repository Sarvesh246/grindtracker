'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from '@/lib/contexts/ThemeContext'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import { demoCalendarWorkoutDays } from '@/lib/demoMode/fakeData'
import { localDateKey } from '@/lib/utils/formatting'
import {
  NAMED_DAY_COLORS,
  dayTintBg,
  dayTintBorder,
  resolveDayColor,
  resolveDayTextColor,
} from '@/lib/utils/dayColors'

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]

export default function WorkoutCalendar() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { demoMode } = useDemoMode()
  const { theme } = useTheme()
  const isLight = theme === 'light'

  const todayDate = new Date()
  todayDate.setHours(0, 0, 0, 0)
  const todayKey = localDateKey(todayDate)

  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date()
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [workoutDays, setWorkoutDays] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const loadMonth = useCallback(async () => {
    setLoading(true)
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()

    if (demoMode) {
      setWorkoutDays(demoCalendarWorkoutDays(year, month))
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // Month bounds as YYYY-MM-DD local_date keys (authoritative streak/calendar day).
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const { data } = await supabase
      .from('sessions')
      .select('local_date, day_type')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .not('local_date', 'is', null)
      .gte('local_date', monthStart)
      .lte('local_date', monthEnd)

    const map: Record<string, string> = {}
    for (const s of data ?? []) {
      if (!s.local_date) continue
      if (!map[s.local_date]) map[s.local_date] = s.day_type
    }
    setWorkoutDays(map)
    setLoading(false)
  }, [supabase, currentMonth, demoMode])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadMonth() }, [loadMonth])

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
  const extraTypes = [...new Set(allTypes.filter(t => !NAMED_DAY_COLORS[t]))]
  // Always show all named day types; append any unrecognised ones from this month's data
  const legendTypes = [...Object.keys(NAMED_DAY_COLORS), ...extraTypes]

  function handlePrev() {
    setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))
  }
  function handleNext() {
    if (isOnCurrentMonth) return
    setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))
  }

  function navigateTo(dateKey: string) {
    if (dateKey === todayKey) router.push('/log')
    else router.push(`/log/past?date=${dateKey}`)
  }

  return (
    <div className="cal-card" style={{
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '20px',
      padding: '24px',
    }}>
      {/* Month nav */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '14px',
      }}>
        <button
          className="press"
          data-haptic="light"
          onClick={handlePrev}
          aria-label="Previous month"
          style={{
            position: 'relative',
            background: 'none', border: 'none', cursor: 'pointer',
            width: '44px', height: '44px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)', lineHeight: 1,
          }}
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
          className="press"
          data-haptic="light"
          onClick={handleNext}
          disabled={isOnCurrentMonth}
          aria-label="Next month"
          style={{
            position: 'relative',
            background: 'none', border: 'none',
            cursor: isOnCurrentMonth ? 'default' : 'pointer',
            width: '44px', height: '44px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
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

      {/* Day grid. Keyed on the month so paging re-runs the entrance — the
          whole grid changes underneath and a hard cut hides which way you moved. */}
      <div
        key={`${year}-${month}`}
        className="cal-grid swap-in"
        role="grid"
        aria-label={`${MONTH_NAMES[month]} ${year} workout calendar`}
        style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 150ms ease' }}
      >
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} className="cal-empty" role="gridcell" />

          const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const workoutType = workoutDays[dateKey]
          const dotColor = workoutType ? resolveDayColor(workoutType, extraTypes) : null
          const dayTextColor = workoutType
            ? resolveDayTextColor(workoutType, extraTypes, isLight)
            : null

          const isToday = dateKey === todayKey
          const isFuture = dateKey > todayKey

          const textColor = dayTextColor
            ?? (isFuture
              ? 'var(--text-disabled)'
              : isToday
                ? 'var(--text-primary)'
                : 'var(--text-muted)')

          const isClickable = !isFuture

          const baseBg = dotColor ? dayTintBg(dotColor, isLight) : 'transparent'
          const baseBorder = isToday
            ? '1px solid var(--border-strong)'
            : dotColor
              ? `1px solid ${dayTintBorder(dotColor, isLight)}`
              : '1px solid transparent'

          const hoverBg = dotColor
            ? `${dotColor}55`
            : isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)'
          const hoverBorder = isToday
            ? '1px solid var(--border-strong)'
            : dotColor
              ? `1px solid ${dotColor}cc`
              : '1px solid var(--border)'

          const label = workoutType
            ? `${dateKey}, ${workoutType} workout`
            : isToday
              ? `${dateKey}, today`
              : dateKey

          if (!isClickable) {
            return (
              <div
                key={idx}
                className="cal-cell"
                role="gridcell"
                aria-disabled="true"
                aria-label={label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '8px',
                  border: baseBorder,
                  backgroundColor: baseBg,
                  gap: '3px',
                }}
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
              </div>
            )
          }

          return (
            <button
              key={idx}
              type="button"
              className="cal-cell"
              role="gridcell"
              aria-label={label}
              onClick={() => navigateTo(dateKey)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                cursor: 'pointer',
                border: baseBorder,
                backgroundColor: baseBg,
                transition: 'background-color 150ms ease, border-color 150ms ease',
                gap: '3px',
                padding: 0,
                minHeight: '44px',
                font: 'inherit',
                color: 'inherit',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = hoverBg
                e.currentTarget.style.borderColor = hoverBorder.replace('1px solid ', '')
              }}
              onMouseLeave={e => {
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
                }} aria-hidden />
              )}
            </button>
          )
        })}
      </div>

      {/* Legend — always shows all named types; extra types from data appended */}
      <div style={{ display: 'flex', gap: '14px', marginTop: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {legendTypes.map(type => {
          const fillColor = resolveDayColor(type, extraTypes)
          const labelColor = resolveDayTextColor(type, extraTypes, isLight)
          return (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: fillColor,
                flexShrink: 0,
                boxShadow: isLight ? 'none' : `0 0 4px ${fillColor}80`,
              }} />
              <span style={{ fontSize: '10px', color: labelColor, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {type}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
