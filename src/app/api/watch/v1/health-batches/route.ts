import { watchHealthBatch } from '@/lib/health/watchBatch'
import { productionWatchDeps } from '@/lib/watch/deps'
import { watchError } from '@/lib/watch/http'

export const dynamic = 'force-dynamic'
function handle(request: Request) {
  if (process.env.HEALTH_WATCH_BATCHES_ENABLED !== 'true') return watchError(503, 'service_unavailable', 'Health batches are not enabled for this release.')
  return watchHealthBatch(request, productionWatchDeps())
}
export const GET = handle
export const POST = handle
