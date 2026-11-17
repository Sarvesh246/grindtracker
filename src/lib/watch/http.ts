/**
 * Every /api/watch/v1 response goes through these, so the shape is the same
 * everywhere: success bodies are plain JSON, failures are
 * `{ "error": { "code", "message" } }` (+ `details` for validation).
 */

export type WatchErrorCode =
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
  | 'collection_paused'
  | 'setup_required'
  | 'service_unavailable'
  | 'internal_error'

const NO_STORE = { 'Cache-Control': 'no-store' }

export function watchJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } })
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
