import { watchRepLab } from '@/lib/watch/handlers'
import { productionWatchDeps } from '@/lib/watch/deps'

// Garmin watch API, v1 — one set recorded for tuning the rep counter. See docs/watch-api.md.
export const dynamic = 'force-dynamic'

export function POST(request: Request) {
  return watchRepLab(request, productionWatchDeps())
}
