'use client'
import Link from 'next/link'
import type { BodySummary } from '@/lib/body/queries'
import { dateLabel } from '@/lib/health/model'
import { setUiState } from '@/lib/cache/appDataCache'
import { Ring } from '@/components/body/ChargeRing'
import { ChevronRight } from '@/components/ui/Icons'
import './health-entry.css'

export function HealthEntry({ body }: { body: BodySummary | null }) {
  if (process.env.NEXT_PUBLIC_HEALTH_PAGE_ENABLED === 'false') return null
  const latest = body?.days.at(-1)
  const charge = body?.charge ?? null
  const glance = [
    latest?.resting_hr != null && {
      label: 'Resting HR',
      value: `${latest.resting_hr}`,
      unit: 'bpm'
    },
    latest?.bb_latest != null && {
      label: 'Body Battery',
      value: `${latest.bb_latest}`,
      unit: ''
    },
    latest?.steps != null && {
      label: 'Steps',
      value: latest.steps.toLocaleString(),
      unit: ''
    }
  ].filter((g): g is { label: string; value: string; unit: string } => !!g)
  return (
    <Link
      href="/progress/health"
      className="health-entry press-card"
      data-haptic="light"
      onClick={() =>
        setUiState('progress:health-return', {
          scroll: document.querySelector('.app-main')?.scrollTop ?? 0,
          ready: false
        })
      }
    >
      <span className="health-entry-lead" aria-hidden="true">
        {charge ? (
          <Ring score={charge.score} size={56} stroke={6} />
        ) : (
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
        )}
      </span>
      <span className="health-entry-body">
        <strong>Health & recovery</strong>
        <span className="health-entry-sub">
          {charge
            ? `Charge ${charge.score} · ${charge.bandLabel}${latest ? ` · ${dateLabel(latest.local_date)}` : ''}`
            : latest
              ? dateLabel(latest.local_date)
              : 'Sleep, recovery and activity'}
        </span>
        {glance.length > 0 && (
          <span className="health-entry-glance">
            {glance.map((g) => (
              <span key={g.label}>
                <b>{g.value}</b>
                {g.unit && <small>{g.unit}</small>}
                <em>{g.label}</em>
              </span>
            ))}
          </span>
        )}
      </span>
      <ChevronRight size={20} className="health-arrow" />
    </Link>
  )
}
