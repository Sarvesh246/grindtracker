import { watchDaily } from '@/lib/watch/handlers'
import { productionWatchDeps } from '@/lib/watch/deps'

// Garmin watch API, v1 — the day's body snapshot. See docs/watch-api.md.
export const dynamic = 'force-dynamic'

export function POST(request: Request) {
  return watchDaily(request, productionWatchDeps())
}
