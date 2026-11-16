import { watchSessions } from '@/lib/watch/handlers'
import { productionWatchDeps } from '@/lib/watch/deps'

// Garmin watch API, v1 — idempotent session/set upload. See docs/watch-api.md.
export const dynamic = 'force-dynamic'

export function POST(request: Request) {
  return watchSessions(request, productionWatchDeps())
}
