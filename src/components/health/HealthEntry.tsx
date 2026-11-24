'use client'
import { useMemo, type CSSProperties } from 'react'
import Link from 'next/link'
import type { BodySummary } from '@/lib/body/queries'
import { dateLabel } from '@/lib/health/model'
import { setUiState } from '@/lib/cache/appDataCache'
import { ChevronRight } from '@/components/ui/Icons'
import { BAND, drivers, hm, weekCharges, type Driver } from './recovery/model'
import { useCountUp } from './recovery/motion'
import './health-entry.css'
import './recovery/recovery.css'

/** "Woke at 88", "HRV above usual": the card's reason line, two at most. */
function shortReason(d: Driver): string {
  const up = d.effect === 'helped'
  switch (d.key) {
    case 'body_battery':
      return `Woke at ${d.value}`
    case 'hrv':
      return `HRV ${up ? 'above' : 'below'} usual`
    case 'recovery':
      return d.value.startsWith('0') ? 'Fully recovered' : `${d.value} recovery left`
    case 'resting_hr':
      return `Resting HR ${d.value}`
    case 'respiration':
      return `Breathing ${up ? 'calm' : 'fast'}`
    default:
      return `Load ${up ? 'in range' : 'running high'}`
  }
}

const RING_R = 39.5
const RING_C = 2 * Math.PI * RING_R

/** Progress → Recovery: today's Charge, the call, the week and three numbers. */
export function HealthEntry({ body }: { body: BodySummary | null }) {
  const charge = body?.charge ?? null
  const shown = useCountUp(charge?.score ?? null, 1300, 250)
  const week = useMemo(() => (body?.available ? weekCharges(body) : null), [body])
  if (process.env.NEXT_PUBLIC_HEALTH_PAGE_ENABLED === 'false') return null
  const latest = body?.days.at(-1)
  const today = body?.todayRow ?? null
  const remember = () =>
    setUiState('progress:health-return', {
      scroll: document.querySelector('.app-main')?.scrollTop ?? 0,
      ready: false
    })
  if (!charge || !body)
    return (
      <Link
        href="/progress/health"
        className="health-entry press-card"
        data-haptic="light"
        onClick={remember}
      >
        <span className="health-entry-lead" aria-hidden="true">
          <span className="health-entry-icon">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
              <path d="M4 12h4l2-4 3 8 2-4h5" />
            </svg>
          </span>
        </span>
        <span className="health-entry-body">
          <strong>Recovery</strong>
          <span className="health-entry-sub">
            {latest ? dateLabel(latest.local_date) : 'Sleep, recovery and activity'}
          </span>
        </span>
        <ChevronRight size={20} className="health-arrow" />
      </Link>
    )
  const meta = BAND[charge.band]
  const reasons = drivers(charge.inputs)
    .filter((d) => d.effect !== 'neutral')
    .slice(0, 2)
    .map((d) => shortReason(d))
  const hrv = body.overnightHrv?.[body.today]
  const minis = [
    body.garminMorning && {
      label: 'Sleep',
      value: hm(body.garminMorning.durationSeconds),
      unit: ''
    },
    hrv != null && { label: 'HRV', value: String(Math.round(hrv)), unit: 'ms' },
    today?.resting_hr != null && { label: 'Rest HR', value: String(today.resting_hr), unit: 'bpm' },
    today?.bb_latest != null && { label: 'Battery', value: String(today.bb_latest), unit: '' },
    today?.steps != null && { label: 'Steps', value: today.steps.toLocaleString('en-US'), unit: '' }
  ]
    .filter((m): m is { label: string; value: string; unit: string } => !!m)
    .slice(0, 3)
  const value = shown ?? 0
  return (
    <Link
      href="/progress/health"
      className="rcv-entry"
      data-band={charge.band}
      data-haptic="light"
      onClick={remember}
      aria-label={`Recovery: Charge ${charge.score}, ${charge.bandLabel}. ${meta.headline} Open Recovery.`}
    >
      <div className="rcv-entry-top">
        <div className="rcv-entry-ring" aria-hidden="true">
          <svg viewBox="0 0 88 88">
            <circle cx="44" cy="44" r={RING_R} />
            <circle
              cx="44"
              cy="44"
              r={RING_R}
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - value / 100)}
            />
          </svg>
          <strong>{shown}</strong>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="rcv-entry-eyebrow">
            <i aria-hidden="true" />
            {meta.label} · Charge
          </span>
          <span className="rcv-entry-head">{meta.headline}</span>
          {reasons.length > 0 && <span className="rcv-entry-sub">{reasons.join(' · ')}</span>}
        </div>
      </div>
      <div className="rcv-entry-mid">
        {week && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span
              style={{
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: 'var(--text-muted)'
              }}
            >
              Last 7 days
            </span>
            <div className="rcv-bars" aria-hidden="true">
              {[...week].map(([day, c], i) => (
                <i
                  key={day}
                  data-band={c?.band ?? 'none'}
                  data-current={day === body.today}
                  style={{ height: `${c ? Math.max(8, c.score) : 6}%`, '--i': i } as CSSProperties}
                />
              ))}
            </div>
          </div>
        )}
        <span className="rcv-open" aria-hidden="true">
          Open
          <ChevronRight size={16} />
        </span>
      </div>
      {minis.length > 0 && (
        <div className="rcv-minis">
          {minis.map((m) => (
            <span key={m.label}>
              <em>{m.label}</em>
              <b>
                {m.value}
                {m.unit && <small>{m.unit}</small>}
              </b>
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}
