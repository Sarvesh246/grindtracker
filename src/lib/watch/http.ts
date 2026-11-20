/**
 * Every /api/watch/v1 response goes through these, so the shape is the same
 * everywhere: success bodies are plain JSON, failures are
 * `{ "error": { "code", "message" } }` (+ `details` for validation).
 */

type WatchErrorCode =
  | 'missing_token'
  | 'invalid_token'
  | 'token_revoked'
  | 'rate_limited'
  | 'invalid_json'
  | 'payload_too_large'
  | 'validation_failed'
  | 'unknown_workout'
  | 'workout_required'
  | 'no_working_sets'
  | 'session_id_conflict'
  | 'open_session_conflict'
  | 'day_already_logged'
  | 'session_not_found'
  | 'collection_paused'
  | 'setup_required'
  | 'service_unavailable'
  | 'internal_error'

const NO_STORE = { 'Cache-Control': 'no-store' }

export function watchJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } })
}

/**
 * The request body as text, read no further than `maxBytes`. Content-Length is
 * checked first, but a chunked body has none, so the stream is counted as it
 * arrives and cut off the moment it passes the cap. `ok: false` = too large.
 */
export async function readBodyText(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  if (Number(request.headers.get('content-length') ?? '0') > maxBytes) return { ok: false }
  const reader = request.body?.getReader()
  if (!reader) return { ok: true, text: '' }
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel()
      return { ok: false }
    }
    chunks.push(value)
  }
  return { ok: true, text: Buffer.concat(chunks).toString('utf8') }
}

export function watchError(
  status: number,
  code: WatchErrorCode,
  message: string,
  extra: { details?: { path: string; message: string }[]; headers?: Record<string, string> } = {},
): Response {
  const error: Record<string, unknown> = { code, message }
  if (extra.details) error.details = extra.details
  return watchJson({ error }, status, extra.headers)
}
