import { watchToday } from '@/lib/watch/handlers'
import { productionWatchDeps } from '@/lib/watch/deps'

// Garmin watch API, v1 — today's planned workout. See docs/watch-api.md.
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return watchToday(request, productionWatchDeps())
}
