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
  calendarCellBackground,
  calendarCellBorder,
  joinDayTypes,
  mapDayColorRows,
  resolveDayColor,
  resolveDayTextColor,
} from '@/lib/utils/dayColors'

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]

function DayDots({ fills }: { fills: string[] }) {
  if (fills.length === 0) return null
  const size = fills.length > 1 ? 4 : 5
  return (
    <div
      style={{ display: 'flex', gap: '2px', alignItems: 'center', height: 5 }}
      aria-hidden
    >
      {fills.map((color, i) => (
        <div
          key={`${color}-${i}`}
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            backgroundColor: color,
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  )
}

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
  const [workoutDays, setWorkoutDays] = useState<Record<string, string[]>>({})
  const [dayColors, setDayColors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const loadMonth = useCallback(async () => {
    setLoading(true)
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()

    if (demoMode) {
      setWorkoutDays(demoCalendarWorkoutDays(year, month))
      setDayColors({})
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // Month bounds as YYYY-MM-DD local_date keys (authoritative streak/calendar day).
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const [{ data }, { data: colorRows, error: colorErr }] = await Promise.all([
      supabase
        .from('sessions')
        .select('local_date, day_type')
        .eq('user_id', user.id)
        .not('completed_at', 'is', null)
        .not('local_date', 'is', null)
        .gte('local_date', monthStart)
        .lte('local_date', monthEnd)
        .order('completed_at', { ascending: true }),
      supabase
        .from('user_day_colors')
        .select('day_key, color')
        .eq('user_id', user.id),
    ])

    const map: Record<string, string[]> = {}
    for (const s of data ?? []) {
      if (!s.local_date || !s.day_type) continue
      const list = map[s.local_date] ?? (map[s.local_date] = [])
      if (!list.includes(s.day_type)) list.push(s.day_type)
    }
    setWorkoutDays(map)
    setDayColors(colorErr ? {} : mapDayColorRows(colorRows))
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
  const allTypes = Object.values(workoutDays).flat()
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
    if (dateKey === todayKey && !workoutDays[dateKey]?.length) router.push('/log')
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
          const workoutTypes = workoutDays[dateKey] ?? []
          const fillHexes = workoutTypes.map(t => resolveDayColor(t, extraTypes, isLight, dayColors[t]))
          const primaryType = workoutTypes[0] ?? null
          const dayTextColor = primaryType && workoutTypes.length === 1
            ? resolveDayTextColor(primaryType, extraTypes, isLight, dayColors[primaryType])
            : workoutTypes.length > 1
              ? 'var(--text-primary)'
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

          const baseBg = calendarCellBackground(fillHexes, isLight)
          const hoverBg = calendarCellBackground(fillHexes, isLight, true)
          const tintBorder = fillHexes.length
            ? calendarCellBorder(fillHexes, isLight)
            : 'transparent'
          const hoverTintBorder = fillHexes.length
            ? calendarCellBorder(fillHexes, isLight, true)
            : 'var(--border)'
          const baseBorder = isToday
            ? '1px solid var(--border-strong)'
            : `1px solid ${tintBorder}`
          const hoverBorder = isToday
            ? '1px solid var(--border-strong)'
            : `1px solid ${hoverTintBorder}`

          const label = workoutTypes.length
            ? `${dateKey}, ${joinDayTypes(workoutTypes)} workout${workoutTypes.length > 1 ? 's' : ''}`
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
                  background: baseBg,
                  gap: '3px',
                  overflow: 'hidden',
                }}
              >
                <span style={{
                  fontSize: '13px',
                  color: textColor,
                  fontWeight: isToday ? 700 : fillHexes.length ? 600 : 400,
                  lineHeight: 1,
                  fontFamily: "'DM Sans', sans-serif",
                }}>
                  {day}
                </span>
                <DayDots fills={fillHexes} />
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
                background: baseBg,
                transition: 'background 150ms ease, border-color 150ms ease',
                gap: '3px',
                padding: 0,
                minHeight: '44px',
                font: 'inherit',
                color: 'inherit',
                overflow: 'hidden',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = hoverBg
                e.currentTarget.style.borderColor = hoverBorder.replace('1px solid ', '')
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = baseBg
                e.currentTarget.style.borderColor = baseBorder.replace('1px solid ', '')
              }}
            >
              <span style={{
                fontSize: '13px',
                color: textColor,
                fontWeight: isToday ? 700 : fillHexes.length ? 600 : 400,
                lineHeight: 1,
                fontFamily: "'DM Sans', sans-serif",
              }}>
                {day}
              </span>
              <DayDots fills={fillHexes} />
            </button>
          )
        })}
      </div>

      {/* Legend — always shows all named types; extra types from data appended */}
      <div style={{ display: 'flex', gap: '14px', marginTop: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {legendTypes.map(type => {
          const fillColor = resolveDayColor(type, extraTypes, isLight, dayColors[type])
          const labelColor = resolveDayTextColor(type, extraTypes, isLight, dayColors[type])
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
