import { z } from 'zod'
import { authenticateWatch, type WatchDeps } from '@/lib/watch/handlers'
import { watchError, watchJson } from '@/lib/watch/http'
import { buildBatches, parseAppleSamples, parseGarminNight, type ImportedNight } from './importers'

/**
 * POST /api/watch/v1/health-import — the iPhone Shortcut (Apple Health sleep
 * samples) and the owner-run Garmin sync script (raw Connect responses). Uses a
 * normal device token, the same per-device rate limit and revocation as the
 * watch, and the same validated, revision-aware ingestion as every other source.
 */
const MAX_BYTES = 1024 * 1024

const bodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('apple_health'),
    token: z.string().max(100).optional(),
    timezone: z.string().max(80).optional(),
    samples: z
      .array(
        z.object({ start: z.string().max(40), end: z.string().max(40), value: z.string().max(40) })
      )
      .max(6000)
  }),
  z.object({
    kind: z.literal('garmin_api'),
    token: z.string().max(100).optional(),
    days: z.array(z.unknown()).max(120)
  })
])

async function readLimited(request: Request): Promise<unknown | Response> {
  const reader = request.body?.getReader()
  if (!reader) return watchError(400, 'invalid_json', 'A JSON body is required.')
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_BYTES) {
      await reader.cancel()
      return watchError(413, 'payload_too_large', 'Send fewer nights per request.')
    }
    chunks.push(value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return watchError(400, 'invalid_json', 'Send a valid JSON body.')
  }
}

export async function healthImportRequest(request: Request, deps: WatchDeps) {
  try {
    if (request.method !== 'POST') return watchError(400, 'invalid_json', 'Use POST.')
    // iOS Shortcuts often drops custom headers, so the token may also ride in the JSON body
    // (over TLS, like the header). The body is only read before auth when no header was sent.
    const hasHeader = !!request.headers.get('authorization')?.trim()
    let input: unknown
    let authRequest = request
    if (!hasHeader) {
      if (Number(request.headers.get('content-length')) > MAX_BYTES)
        return watchError(413, 'payload_too_large', 'Send fewer nights per request.')
      input = await readLimited(request)
      if (input instanceof Response) return input
      const bodyToken = (input as { token?: unknown } | null)?.token
      if (typeof bodyToken === 'string' && bodyToken.trim())
        authRequest = new Request(request.url, {
          headers: { authorization: `Bearer ${bodyToken.trim()}` }
        })
    }
    const auth = await authenticateWatch(authRequest, deps)
    if (!auth.ok) return auth.response
    if (hasHeader) {
      input = await readLimited(request)
      if (input instanceof Response) return input
    }
    const parsed = bodySchema.safeParse(input)
    if (!parsed.success)
      return watchError(
        422,
        'validation_failed',
        'The request body is not in the expected format.',
        {
          details: parsed.error.issues
            .slice(0, 5)
            .map((i) => ({ path: i.path.join('.'), message: i.message }))
        }
      )
    const now = deps.now()
    const body = parsed.data
    let nights: ImportedNight[]
    let skipped: { key: string; reason: string }[]
    if (body.kind === 'apple_health') {
      ;({ nights, skipped } = parseAppleSamples(body.samples, { timezone: body.timezone, now }))
    } else {
      nights = []
      skipped = []
      body.days.forEach((day, i) => {
        const r = parseGarminNight(day, 'garmin_unofficial', { now })
        if (r.ok) nights.push(r.night)
        else skipped.push({ key: `#${i + 1}`, reason: r.reason })
      })
    }
    const source = body.kind === 'apple_health' ? 'apple_health' : 'garmin_unofficial'
    const built = buildBatches(nights, source, now)
    skipped = [...skipped, ...built.skipped]
    for (const batch of built.batches) {
      const result = await deps.rpc('token_import_health_batch', {
        p_user: auth.userId,
        p_device: auth.deviceId,
        p_source: source,
        p_batch: batch
      })
      if (result.error) {
        if (/HEALTH_COLLECTION_PAUSED/.test(result.error.message))
          return watchError(
            409,
            'collection_paused',
            'Health collection is paused in GRIND Settings.'
          )
        // Never log the payload; the message is a stable code from the database.
        deps.log('health import failed', result.error.message.slice(0, 80))
        return watchError(503, 'service_unavailable', 'Sleep could not be saved. Retry shortly.')
      }
    }
    return watchJson({
      imported: built.accepted,
      skipped,
      nights: built.batches
        .flatMap((b) => b.sleeps)
        .map((n) => ({
          wake_date: n.wake_date,
          kind: n.kind,
          minutes: Math.round(n.duration_seconds / 60)
        }))
    })
  } catch {
    return watchError(503, 'service_unavailable', 'Health import is temporarily unavailable.')
  }
}
