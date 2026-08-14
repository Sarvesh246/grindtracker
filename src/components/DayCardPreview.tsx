import type { CSSProperties } from 'react'
import DayIcon from '@/components/DayIcon'
import { onDayFill } from '@/lib/utils/dayColors'

/**
 * Presentational Log day-card, used by the color picker so the user sees
 * exactly how the color reads (title, icon, idle vs UP NEXT chrome).
 * Color/border live on CSS vars so the picker can interpolate them.
 */
export default function DayCardPreview({
  dayKey,
  category,
  isFlex,
  description,
  fillColor,
  labelColor,
  upNext = true,
  exerciseCount,
  flashKey,
}: {
  dayKey: string
  category?: string | null
  isFlex?: boolean
  description?: string
  fillColor: string
  labelColor: string
  upNext?: boolean
  exerciseCount?: number
  /** Changing this remounts the one-shot ring pulse around the card. */
  flashKey?: string
}) {
  const label = dayKey.replace(/-/g, ' ').toUpperCase()
  const pillOn = onDayFill(fillColor)
  const countLabel = exerciseCount == null
    ? 'Preview'
    : `${exerciseCount} exercise${exerciseCount !== 1 ? 's' : ''}`

  return (
    <div
      aria-hidden
      className="day-color-preview"
      data-up-next={upNext ? 'true' : 'false'}
      style={{
        '--day-fill': fillColor,
        '--day-label': labelColor,
        '--day-on-fill': pillOn,
        '--day-border': upNext ? fillColor : 'var(--border)',
      } as CSSProperties}
    >
      {flashKey != null && (
        <span key={flashKey} className="day-color-flash" />
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <div className="day-color-preview__icon" style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <DayIcon dayKey={dayKey} category={category} size={28} />
          <span
            className="day-color-preview__title"
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '28px',
              letterSpacing: '1px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
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
          <div className="day-color-preview__meta">
            <span className="day-color-preview__pill" data-on={upNext ? 'true' : 'false'}>
              UP NEXT
            </span>
            <span className="day-color-preview__count" data-on={upNext ? 'false' : 'true'}>
              {countLabel}
            </span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
        {description || 'How this day looks on Log'}
      </div>
    </div>
  )
}
