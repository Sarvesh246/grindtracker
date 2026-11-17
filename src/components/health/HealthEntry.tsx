'use client'
import Link from 'next/link'
import type { BodySummary } from '@/lib/body/queries'
import { dateLabel } from '@/lib/health/model'
import { setUiState } from '@/lib/cache/appDataCache'
import './health-entry.css'

export function HealthEntry({ body }: { body: BodySummary | null }) {
  if (process.env.NEXT_PUBLIC_HEALTH_PAGE_ENABLED === 'false') return null
  const latest = body?.days.at(-1)
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
      <span className="health-entry-icon" aria-hidden="true">
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
      <span>
        <strong>Health & recovery</strong>
        <span>
          {latest
            ? `Daily recovery & activity · ${dateLabel(latest.local_date)}`
            : 'Sleep, recovery and your daily picture'}
        </span>
      </span>
      <span className="health-arrow" aria-hidden="true">
        ›
      </span>
    </Link>
  )
}
