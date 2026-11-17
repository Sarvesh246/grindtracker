import HealthPage from '@/components/health/HealthPage'

export const metadata = { title: 'Health · GRIND' }
export default async function Page({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams
  return <HealthPage requestedDate={date} />
}
