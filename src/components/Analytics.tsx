'use client'

import { Analytics as VercelAnalytics } from '@vercel/analytics/react'

/** Privacy-light page analytics (no custom events / PII). */
export default function Analytics() {
  return <VercelAnalytics />
}
