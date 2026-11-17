import { authenticateWatch, type WatchDeps } from '@/lib/watch/handlers'
import { watchError, watchJson } from '@/lib/watch/http'
import { validateHealthBatch } from './ingestion'

const MAX_BYTES = 128 * 1024
export async function watchHealthBatch(request: Request, deps: WatchDeps) {
  try {
    const auth = await authenticateWatch(request, deps)
    if (!auth.ok) return auth.response
    if (request.method === 'GET') {
      const result = await deps.rpc('watch_health_context', {
        p_user: auth.userId,
        p_device: auth.deviceId
      })
      return result.error
        ? watchError(503, 'service_unavailable', 'Health ingestion is unavailable.')
        : watchJson(result.data)
    }
    if (Number(request.headers.get('content-length')) > MAX_BYTES)
      return watchError(413, 'payload_too_large', 'Split health records into smaller batches.')
    // Bound streamed bodies even when Content-Length is absent or dishonest.
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
        return watchError(413, 'payload_too_large', 'Split health records into smaller batches.')
      }
      chunks.push(value)
    }
    let input: unknown
    try {
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return watchError(400, 'invalid_json', 'Send a valid JSON body.')
    }
    const parsed = validateHealthBatch(input, deps.now(), true)
    if (!parsed.success) return watchError(422, 'validation_failed', parsed.error.issues[0].message)
    const result = await deps.rpc('watch_ingest_health_batch', {
      p_user: auth.userId,
      p_device: auth.deviceId,
      p_batch: parsed.data
    })
    if (result.error) {
      // Do not log raw payloads or provider credentials.
      return watchError(
        503,
        'service_unavailable',
        'Health batch was not acknowledged. Retry after checking collection status.'
      )
    }
    return watchJson(result.data)
  } catch {
    return watchError(503, 'service_unavailable', 'Health ingestion is temporarily unavailable.')
  }
}
