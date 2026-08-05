'use client'
import { useEffect, useRef } from 'react'
import { formatShortDate } from '@/lib/utils/formatting'

/**
 * Horizontal date scrubber pinned under the timeline-mode lightbox. Tracks
 * the currently-shown photo's date, auto-scrolls the active marker into
 * view, and jumps straight to a date on tap.
 */
export default function TimelineStrip({
  dates,
  activeDate,
  onJump,
}: {
  dates: string[]
  activeDate: string
  onJump: (date: string) => void
}) {
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeDate])

  return (
    <div
      className="scrollbar-hide"
      style={{
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        padding: '10px 16px',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {dates.map(date => {
        const active = date === activeDate
        return (
          <button
            key={date}
            ref={active ? activeRef : undefined}
            onClick={() => onJump(date)}
            aria-current={active}
            style={{
              flexShrink: 0,
              padding: '6px 12px',
              borderRadius: 'var(--radius-pill, 9999px)',
              backgroundColor: active ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
              border: `1px solid ${active ? 'var(--accent)' : 'rgba(255,255,255,0.16)'}`,
              color: active ? 'var(--on-accent)' : 'rgba(255,255,255,0.75)',
              fontFamily: 'var(--font-sans)',
              fontSize: '11px',
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 150ms ease',
            }}
          >
            {formatShortDate(date)}
          </button>
        )
      })}
    </div>
  )
}
