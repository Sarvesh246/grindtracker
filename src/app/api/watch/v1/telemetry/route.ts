import { watchTelemetry } from '@/lib/watch/handlers'
import { productionWatchDeps } from '@/lib/watch/deps'

// Garmin watch API, v1 — app health: crashes and per-workout vitals. See docs/watch-api.md.
export const dynamic = 'force-dynamic'

export function POST(request: Request) {
  return watchTelemetry(request, productionWatchDeps())
}
