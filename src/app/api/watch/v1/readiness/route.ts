import { watchReadiness } from '@/lib/watch/handlers'
import { productionWatchDeps } from '@/lib/watch/deps'

// Garmin watch API, v1 — one morning HRV readiness check. See docs/watch-api.md.
export const dynamic = 'force-dynamic'

export function POST(request: Request) {
  return watchReadiness(request, productionWatchDeps())
}
