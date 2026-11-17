import { notFound } from 'next/navigation'
import HealthPage from '@/components/health/HealthPage'
import { isHealthMetric } from '@/lib/health/model'

export const metadata = { title: 'Health measurement · GRIND' }
export default async function Page({ params, searchParams }: { params: Promise<{ metric: string }>; searchParams: Promise<{ date?: string }> }) {
  const [{ metric }, { date }] = await Promise.all([params, searchParams])
  if (!isHealthMetric(metric)) notFound()
  return <HealthPage view="metric" metric={metric} requestedDate={date} />
}
