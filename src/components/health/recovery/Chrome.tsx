'use client'
import { useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import Dialog from '@/components/ui/Dialog'
import { ChevronLeft, CloseIcon } from '@/components/ui/Icons'
import type { Charge } from '@/lib/body/charge'
import { dateLabel, shiftDate } from '@/lib/health/model'
import { requestOpenCoach } from '@/lib/coach/openCoachBus'
import { weekWindow } from './model'

export function SparkleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3 13.8 9.2 20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8Z" />
    </svg>
  )
}
export function ArrowUpRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      style={{ color: 'var(--text-muted)' }}
    >
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  )
}
export function MoonIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}
/** Kept for screens that open the calendar from an icon. */
export function CalendarIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  )
}
export function ChevronDownSmall() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function CoachButton({
  label,
  draft,
  className = ''
}: {
  label: string
  draft: string
  className?: string
}) {
  return (
    <button
      type="button"
      className={`rcv-coach ${className}`}
      data-haptic="medium"
      onClick={() => requestOpenCoach({ draft })}
    >
      <SparkleIcon />
      <span>{label}</span>
    </button>
  )
}

export interface SyncState {
  state: 'ok' | 'busy' | 'error'
  label: string
}

/**
 * Title row: back, the date (tap it for the calendar), the title and the sync
 * pill that refreshes. On desktop the row opens out so the day strip and the
 * pill sit beside the title.
 */
export function RecoveryHeader({
  title,
  eyebrow,
  deskPrefix,
  date,
  today,
  backHref,
  backLabel,
  sync,
  onRefresh,
  calendar,
  children
}: {
  title: string
  /** Replaces the date eyebrow (the metric view says "Vitals"). */
  eyebrow?: string
  /** Desktop-only words before the date, e.g. "Progress". */
  deskPrefix?: string
  date: string
  today: string
  backHref: string
  backLabel: string
  sync: SyncState
  onRefresh: () => void
  calendar?: { availableDates: string[]; onDate: (date: string) => void }
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const when = date === today ? `Today · ${dateLabel(date)}` : dateLabel(date)
  return (
    <header className="rcv-headbar rcv-rise" style={{ '--i': 0 } as CSSProperties}>
      <div className="rcv-top">
        <Link
          href={backHref}
          className={`rcv-icon-btn rcv-back${backLabel === 'Progress' ? ' rcv-back--overview' : ''}`}
          aria-label={`Back to ${backLabel}`}
          data-haptic="light"
        >
          <ChevronLeft size={20} />
        </Link>
        <div className="rcv-title">
          {calendar ? (
            <button
              type="button"
              className="rcv-label rcv-date-btn"
              aria-label="Choose health date"
              data-haptic="light"
              onClick={() => setOpen(true)}
            >
              {deskPrefix && <span className="rcv-only-desk">{deskPrefix} · </span>}
              {eyebrow ?? when}
            </button>
          ) : (
            <p className="rcv-label">{eyebrow ?? when}</p>
          )}
          <h1>{title}</h1>
        </div>
        <button
          type="button"
          className="rcv-sync"
          data-state={sync.state}
          data-haptic="light"
          disabled={sync.state === 'busy'}
          aria-label={sync.state === 'error' ? 'Retry' : `${sync.label}. Refresh`}
          onClick={onRefresh}
        >
          <i aria-hidden="true" />
          <span role="status">{sync.label}</span>
        </button>
      </div>
      {children}
      {calendar && (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          labelledBy="health-calendar-title"
          panelStyle={{ maxWidth: 440 }}
        >
          <div className="health-page health-calendar">
            <div className="health-section-head">
              <h2 id="health-calendar-title">Choose a date</h2>
              <button aria-label="Close date picker" onClick={() => setOpen(false)}>
                <CloseIcon size={18} />
              </button>
            </div>
            <label>
              Selected health date
              <input
                aria-label="Selected health date"
                type="date"
                value={date}
                max={today}
                onChange={(e) => {
                  if (e.target.value && e.target.value <= today) calendar.onDate(e.target.value)
                }}
              />
            </label>
            <div className="health-calendar-grid">
              {Array.from({ length: 28 }, (_, i) => shiftDate(today, i - 27)).map((key) => (
                <button
                  key={key}
                  data-haptic="light"
                  aria-pressed={date === key}
                  aria-label={`${dateLabel(key)}${calendar.availableDates.includes(key) ? ', records available' : ''}`}
                  onClick={() => {
                    calendar.onDate(key)
                    setOpen(false)
                  }}
                >
                  <span>{new Date(`${key}T12:00:00`).getDate()}</span>
                  <i aria-hidden="true" data-on={calendar.availableDates.includes(key)} />
                </button>
              ))}
            </div>
            <button onClick={() => setOpen(false)}>Done</button>
          </div>
        </Dialog>
      )}
    </header>
  )
}

/** Seven days with each morning's Charge as a bar. */
export function WeekStrip({
  date,
  today,
  charges,
  availableDates,
  onDate
}: {
  date: string
  today: string
  charges: ReadonlyMap<string, Charge | null>
  availableDates: string[]
  onDate: (date: string) => void
}) {
  const days = weekWindow(date, today)
  return (
    <nav
      className="rcv-week rcv-rise"
      aria-label="Choose a day"
      style={{ '--i': 1 } as CSSProperties}
    >
      {days.map((key) => {
        const when = new Date(`${key}T12:00:00`)
        const charge = charges.get(key) ?? null
        const has = availableDates.includes(key)
        return (
          <button
            key={key}
            type="button"
            className="rcv-day"
            data-haptic="light"
            data-today={key === today}
            data-band={charge?.band ?? 'none'}
            aria-pressed={key === date}
            aria-label={`${dateLabel(key)}${charge ? `, Charge ${charge.score}, ${charge.bandLabel}` : has ? ', records available' : ''}`}
            onClick={() => onDate(key)}
          >
            <span aria-hidden="true">
              {when.toLocaleDateString('en-US', { weekday: 'narrow' })}
            </span>
            <span className="rcv-col" aria-hidden="true">
              <i
                style={
                  { '--h': `${charge ? Math.max(8, charge.score) : has ? 8 : 0}%` } as CSSProperties
                }
                data-empty={!charge && !has}
              />
            </span>
            <b aria-hidden="true">{when.getDate()}</b>
          </button>
        )
      })}
    </nav>
  )
}
