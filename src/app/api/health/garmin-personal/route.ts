import { createClient, getAuthUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { garminApi, GarminApiError } from '@/lib/health/garmin/api'
import { garminPersonalConfig } from '@/lib/health/garmin/config'
import { probeGarmin, scopes, type GarminScope } from '@/lib/health/garmin/collect'
import { syncGarmin } from '@/lib/health/garmin/sync'
import { z } from 'zod'
import { readBoundedJson } from '@/lib/utils/requestBody'
import { requestOrigin } from '@/lib/utils/requestOrigin'

export const maxDuration = 60

const action = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['probe', 'enable', 'pause', 'disconnect', 'sync', 'push_on', 'push_off']) }).strict(),
  z.object({ action: z.literal('scopes'), scopes: z.array(z.enum(scopes)).max(scopes.length) }).strict(),
  z.object({ action: z.literal('link'), id: z.string().regex(/^\d{1,16}$/), session: z.uuid().nullable() }).strict()
])

async function owner() {
  const config = garminPersonalConfig()
  const user = config && await getAuthUser()
  return config && user?.id === config.userId ? config : null
}

function response(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET() {
  const config = await owner()
  if (!config) return response({ status: 'unavailable' }, 404)
  const db = createServiceClient()
  const { data, error } = await db.from('garmin_personal_sync')
    .select('enabled,scopes,time_zone,capabilities,last_success_at,last_error,backfill_date,backfill_end,push_enabled')
    .eq('user_id', config.userId).maybeSingle()
  if (error) return response({ status: 'storage' }, 503)
  const collection = await (await createClient()).from('health_collection').select('enabled')
    .eq('user_id', config.userId).maybeSingle()
  if (collection.error) return response({ status: 'storage' }, 503)
  return response({ status: 'ready', connection: data, collectionPaused: collection.data?.enabled === false,
    pushAvailable: process.env.GARMIN_PERSONAL_PUSH_PILOT_VERIFIED === 'true' })
}

export async function POST(request: Request) {
  const config = await owner()
  if (!config) return response({ status: 'unavailable' }, 404)
  if (request.headers.get('origin') !== requestOrigin(request) ||
      request.headers.get('content-type')?.split(';')[0] !== 'application/json')
    return response({ status: 'forbidden' }, 403)
  const input = await readBoundedJson(request, 1024).catch(() => null)
  const parsed = action.safeParse(input)
  if (!parsed.success) return response({ status: 'invalid' }, 400)
  const { data } = parsed
  if (data.action === 'sync') return response(await syncGarmin(config, true))
  if (data.action === 'push_on' && process.env.GARMIN_PERSONAL_PUSH_PILOT_VERIFIED !== 'true')
    return response({ status: 'unavailable' }, 403)
  if (data.action === 'link') {
    const linked = await createServiceClient().rpc('garmin_personal_link', {
      p_user: config.userId, p_id: data.id, p_session: data.session
    })
    return linked.error ? response({ status: 'storage' }, 503)
      : linked.data ? response({ status: 'saved' }) : response({ status: 'invalid_match' }, 409)
  }
  try {
    const probe = data.action === 'enable' || data.action === 'probe'
      ? await probeGarmin(garminApi(config.key, fetch, AbortSignal.timeout(20_000)), new Date()) : null
    if (data.action === 'probe') return response({ status: 'verified', capabilities: probe?.capabilities })
    const selected: GarminScope[] | null = data.action === 'scopes' ? [...new Set(data.scopes)] : null
    const { error } = await createServiceClient().rpc('garmin_personal_configure', {
      p_user: config.userId, p_action: data.action, p_zone: probe?.zone ?? null,
      p_capabilities: probe?.capabilities ?? {}, p_scopes: selected
    })
    if (error?.message === 'HEALTH_COLLECTION_PAUSED') return response({ status: 'paused' }, 409)
    if (error) return response({ status: 'storage' }, 503)
    return response({ status: 'saved' })
  } catch (error) {
    return response({ status: error instanceof GarminApiError ? error.code : 'upstream' }, 502)
  }
}
