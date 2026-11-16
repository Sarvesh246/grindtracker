import { watchPing } from '@/lib/watch/handlers'
import { productionWatchDeps } from '@/lib/watch/deps'

// Garmin watch API, v1. Auth is the device's Bearer token, not the user's
// Supabase session — see docs/watch-api.md.
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return watchPing(request, productionWatchDeps())
}
