import { healthImportRequest } from '@/lib/health/importApi'
import { productionWatchDeps } from '@/lib/watch/deps'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const POST = (request: Request) => healthImportRequest(request, productionWatchDeps())
