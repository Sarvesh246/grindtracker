import { garminPersonalConfig } from '@/lib/health/garmin/config'
import { syncGarmin } from '@/lib/health/garmin/sync'
import { recordGarminMorning } from '@/lib/health/garmin/push'
import { authorizeCron } from '@/lib/push/sendDue'

export const maxDuration = 60

export async function POST(request: Request) {
  if (!authorizeCron(request)) return Response.json({ status: 'unauthorized' }, { status: 401 })
  const config = garminPersonalConfig()
  if (!config) return Response.json({ status: 'disabled' })
  const result = await syncGarmin(config)
  if (result.status === 'synced') await recordGarminMorning(config.userId).catch(() => {})
  return Response.json(result, { status: result.status === 'storage' ? 503 : 200 })
}
