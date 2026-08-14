import type { CSSProperties } from 'react'
import DayIcon from '@/components/DayIcon'
import { onDayFill } from '@/lib/utils/dayColors'

/**
 * Presentational Log day-card, used by the color picker so the user sees
 * exactly how the color reads (title, icon, UP NEXT chrome) before saving.
 */
export default function DayCardPreview({
  dayKey,
  category,
  isFlex,
  description,
  fillColor,
  labelColor,
  upNext = true,
}: {
  dayKey: string
  category?: string | null
  isFlex?: boolean
  description?: string
  fillColor: string
  labelColor: string
  upNext?: boolean
}) {
  const label = dayKey.replace(/-/g, ' ').toUpperCase()
  const pillOn = onDayFill(fillColor)
  const idleBorder = upNext ? `2px solid ${fillColor}` : '1px solid var(--border)'

  return (
    <div
      aria-hidden
      style={{
        position: 'relative',
        backgroundColor: 'var(--surface)',
        border: idleBorder,
        borderRadius: '12px',
        padding: '20px',
        textAlign: 'left',
        width: '100%',
        boxSizing: 'border-box',
      } as CSSProperties}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: labelColor, minWidth: 0 }}>
          <DayIcon dayKey={dayKey} category={category} size={28} />
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '28px',
            color: labelColor,
            letterSpacing: '1px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {label}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginLeft: '8px' }}>
          {isFlex && (
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
          {upNext ? (
            <span style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
              color: pillOn, backgroundColor: fillColor,
              padding: '3px 8px', borderRadius: '9999px',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              UP NEXT
            </span>
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Preview
            </span>
          )}
        </div>
      </div>
      <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
        {description || 'How this day looks on Log'}
      </div>
    </div>
  )
}
