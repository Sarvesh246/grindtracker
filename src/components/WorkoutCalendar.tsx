'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from '@/lib/contexts/ThemeContext'

// Fill colors — used for cell background tints, dot indicators, and borders.
// These stay vibrant in both themes (they're used as low-opacity decorative fills).
const NAMED_COLORS: Record<string, string> = {
  push: '#c8f135',  // lime green (matches app accent)
  pull: '#38bdf8',  // sky blue
  legs: '#fb923c',  // orange
}

// Text/label colors for LIGHT mode — dark accessible variants of the fill colors
// so the day number is legible on a white card surface.
const NAMED_TEXT_COLORS_LIGHT: Record<string, string> = {
  push: '#5a7a1a',  // dark olive  (fill: lime)
  pull: '#075985',  // dark blue   (fill: sky)
  legs: '#9a3412',  // dark sienna (fill: orange)
}

// Fallback pool for any additional day types the user adds
const EXTRA_COLORS = ['#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#e879f9']

// Dark accessible variants for the extra-color pool (same order)
const EXTRA_TEXT_COLORS_LIGHT = ['#5b21b6', '#9d174d', '#065f46', '#92400e', '#991b1b', '#86198f']

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]

function toLocalDateKey(isoString: string): string {
  const d = new Date(isoString)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Vibrant fill color used for backgrounds, borders, and dots (same in both themes).
function resolveColor(type: string, extraTypes: string[]): string {
  if (NAMED_COLORS[type]) return NAMED_COLORS[type]
  const idx = extraTypes.indexOf(type)
  return EXTRA_COLORS[idx % EXTRA_COLORS.length]
}

/** Readable text color for the day number.
 *  In dark mode: same as the fill (vibrant on dark surfaces).
 *  In light mode: darkened accessible variant (readable on white card). */
function resolveTextColor(type: string, extraTypes: string[], isLight: boolean): string {
  if (!isLight) return resolveColor(type, extraTypes)
  if (NAMED_TEXT_COLORS_LIGHT[type]) return NAMED_TEXT_COLORS_LIGHT[type]
  const idx = extraTypes.indexOf(type)
  return EXTRA_TEXT_COLORS_LIGHT[idx % EXTRA_TEXT_COLORS_LIGHT.length]
}

export default function WorkoutCalendar() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { theme } = useTheme()
  const isLight = theme === 'light'

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

  const loadMonth = useCallback(async () => {
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
  }, [supabase, currentMonth])

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
      <div className="cal-grid" style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 150ms ease' }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} className="cal-empty" />

          const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const workoutType = workoutDays[dateKey]
          // dotColor = vibrant fill (backgrounds, dots, borders — same in both themes)
          const dotColor = workoutType ? resolveColor(workoutType, extraTypes) : null
          // dayTextColor = readable day-number color (dark variants in light mode)
          const dayTextColor = workoutType
            ? resolveTextColor(workoutType, extraTypes, isLight)
            : null

          const isToday = isOnCurrentMonth && day === todayDate.getDate()
          const isFuture =
            year > todayDate.getFullYear() ||
            (year === todayDate.getFullYear() && month > todayDate.getMonth()) ||
            (isOnCurrentMonth && day > todayDate.getDate())

          const textColor = dayTextColor
            ?? (isFuture
              ? 'var(--text-disabled)'
              : isToday
                ? 'var(--text-primary)'
                : 'var(--text-muted)')

          const isClickable = !isFuture

          // Cell background: slightly higher opacity in light mode so the tint reads on white
          const bgOpacity = isLight ? '33' : '28'
          const baseBg = dotColor ? `${dotColor}${bgOpacity}` : 'transparent'
          const baseBorder = isToday
            ? '1px solid var(--border-strong)'
            : dotColor
              ? `1px solid ${dotColor}${isLight ? '88' : '55'}`
              : '1px solid transparent'

          const hoverBg = dotColor
            ? `${dotColor}${isLight ? '55' : '55'}`
            : isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)'
          const hoverBorder = isToday
            ? '1px solid var(--border-strong)'
            : dotColor
              ? `1px solid ${dotColor}cc`
              : '1px solid var(--border)'

          return (
            <div
              key={idx}
              className="cal-cell"
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
          const fillColor = resolveColor(type, extraTypes)
          const labelColor = resolveTextColor(type, extraTypes, isLight)
          return (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: fillColor,
                flexShrink: 0,
                // Glow only in dark mode — on white it looks muddy
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
