import { LBS_PER_KG } from '@/lib/utils/units'
import { watchError, watchJson } from './http'
import { hashWatchToken, readBearerToken } from './token'
import { buildTodayPayload, type TodayContext } from './today'
import { toBodyPayload, toDailyPayload, todayBody, type BodyContext, type TodayBody } from './body'
import {
  MAX_BODY_BYTES,
  formatIssues,
  timestampIssues,
  todayQuerySchema,
  watchDailySchema,
  watchRepLabSchema,
  watchSessionSchema,
  type WatchSessionInput,
} from './schema'

/**
 * The /api/watch/v1 handlers, written against a tiny `deps` interface instead
 * of a Supabase client so tests can drive them against a real Postgres (or a
 * fake) without PostgREST. `routes.ts` wires the production deps.
 */

export type RpcResult = { data: unknown; error: { message: string; code?: string } | null }

export interface WatchDeps {
  /** Calls a Postgres function as the service role. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>
  /** Runs after a session is completed by this request (rotation advance).
   *  Failures are logged by the caller's implementation, never surfaced. */
  afterCompletion: (info: {
    userId: string
    sessionId: string
    workoutId: string
    completedAt: string
  }) => Promise<void>
  now: () => Date
  log: (message: string, error: unknown) => void
}

/** Per device, per rolling-ish minute (fixed window in watch_authenticate). */
export const RATE_LIMIT_PER_MINUTE = 60

type AuthOk = { ok: true; userId: string; deviceId: string; deviceName: string }
type AuthResult = AuthOk | { ok: false; response: Response }

const AUTH_HEADERS = { 'WWW-Authenticate': 'Bearer realm="grind-watch"' }

export async function authenticateWatch(request: Request, deps: WatchDeps): Promise<AuthResult> {
  const bearer = readBearerToken(request.headers.get('authorization'))
  if (!bearer.ok) {
    return {
      ok: false,
      response:
        bearer.reason === 'missing'
          ? watchError(401, 'missing_token', 'Send the device token as "Authorization: Bearer <token>".', { headers: AUTH_HEADERS })
          : watchError(401, 'invalid_token', 'The device token is not valid.', { headers: AUTH_HEADERS }),
    }
  }

  const { data, error } = await deps.rpc('watch_authenticate', {
    p_token_hash: hashWatchToken(bearer.token),
    p_limit_per_minute: RATE_LIMIT_PER_MINUTE,
  })
  if (error || !data) {
    deps.log('watch_authenticate failed', error)
    return { ok: false, response: watchError(503, 'service_unavailable', 'GRIND is temporarily unavailable. Retry later.', { headers: { 'Retry-After': '30' } }) }
  }

  const auth = data as { status: string; user_id?: string; device_id?: string; device?: string; retry_after?: number }
  switch (auth.status) {
    case 'ok':
      return { ok: true, userId: auth.user_id!, deviceId: auth.device_id!, deviceName: auth.device ?? '' }
    case 'revoked':
      return { ok: false, response: watchError(401, 'token_revoked', 'This device was revoked in GRIND Settings. Pair it again.', { headers: AUTH_HEADERS }) }
    case 'rate_limited': {
      const retry = String(Math.max(1, auth.retry_after ?? 60))
      return { ok: false, response: watchError(429, 'rate_limited', `Too many requests. Retry in ${retry}s.`, { headers: { 'Retry-After': retry } }) }
    }
    default:
      return { ok: false, response: watchError(401, 'invalid_token', 'The device token is not valid.', { headers: AUTH_HEADERS }) }
  }
}

async function guard(deps: WatchDeps, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (err) {
    deps.log('watch handler crashed', err)
    return watchError(500, 'internal_error', 'Something went wrong on the server.')
  }
}

// ─── GET /ping ─────────────────────────────────────────────────────────────

export function watchPing(request: Request, deps: WatchDeps): Promise<Response> {
  return guard(deps, async () => {
    const auth = await authenticateWatch(request, deps)
    if (!auth.ok) return auth.response
    return watchJson({ ok: true, api_version: 1, server_time: deps.now().toISOString(), device: auth.deviceName })
  })
}

// ─── GET /today ────────────────────────────────────────────────────────────

export function watchToday(request: Request, deps: WatchDeps): Promise<Response> {
  return guard(deps, async () => {
    const auth = await authenticateWatch(request, deps)
    if (!auth.ok) return auth.response

    const params = Object.fromEntries(new URL(request.url).searchParams)
    const query = todayQuerySchema.safeParse(params)
    if (!query.success) {
      return watchError(422, 'validation_failed', 'Invalid query parameters.', { details: formatIssues(query.error) })
    }

    const { data, error } = await deps.rpc('watch_today_context', {
      p_user: auth.userId,
      p_local_date: query.data.date ?? null,
      p_offset_seconds: query.data.utc_offset_seconds ?? null,
    })
    if (error || !data) {
      deps.log('watch_today_context failed', error)
      return watchError(503, 'service_unavailable', 'GRIND is temporarily unavailable. Retry later.', { headers: { 'Retry-After': '30' } })
    }
    const ctx = data as TodayContext
    const payload = buildTodayPayload(ctx, query.data.unit ?? 'lbs', query.data.day)

    // Charge for the watch's Home. Optional: without it /today is unchanged.
    let body: TodayBody | null = null
    try {
      const bodyCtx = await deps.rpc('watch_body_context', { p_user: auth.userId, p_local_date: ctx.local_date })
      if (bodyCtx.error || !bodyCtx.data) deps.log('watch_body_context failed', bodyCtx.error)
      else body = todayBody(bodyCtx.data as BodyContext, ctx.local_date)
    } catch (err) {
      deps.log('watch_body_context crashed', err)
    }

    return watchJson({ ...payload, body })
  })
}

// ─── POST /daily ───────────────────────────────────────────────────────────

export function watchDaily(request: Request, deps: WatchDeps): Promise<Response> {
  return guard(deps, async () => {
    const auth = await authenticateWatch(request, deps)
    if (!auth.ok) return auth.response

    const read = await readJsonBody(request)
    if (!read.ok) return read.response

    const parsed = watchDailySchema.safeParse(read.body)
    if (!parsed.success) {
      const details = formatIssues(parsed.error)
      return watchError(422, 'validation_failed', `${details[0].path}: ${details[0].message}`, { details })
    }

    const { data, error } = await deps.rpc('watch_upsert_daily', {
      p_user: auth.userId,
      p_day: toDailyPayload(parsed.data),
    })
    if (error) {
      if (error.message.includes('WATCH_BAD_DATE')) {
        return watchError(422, 'validation_failed', 'date: must be within the last 30 days.')
      }
      deps.log('watch_upsert_daily failed', error)
      return watchError(503, 'service_unavailable', 'GRIND is temporarily unavailable. Retry later.', { headers: { 'Retry-After': '60' } })
    }
    return watchJson(data)
  })
}

// ─── POST /rep-lab ─────────────────────────────────────────────────────────

/** One set recorded for tuning the wrist rep counter. Never fatal to the
 *  watch: a set the server can't place is answered 422 so the watch drops it. */
export function watchRepLab(request: Request, deps: WatchDeps): Promise<Response> {
  return guard(deps, async () => {
    const auth = await authenticateWatch(request, deps)
    if (!auth.ok) return auth.response

    const read = await readJsonBody(request)
    if (!read.ok) return read.response

    const parsed = watchRepLabSchema.safeParse(read.body)
    if (!parsed.success) {
      const details = formatIssues(parsed.error)
      return watchError(422, 'validation_failed', `${details[0].path}: ${details[0].message}`, { details })
    }

    const { data, error } = await deps.rpc('watch_store_rep_lab', { p_user: auth.userId, p_set: parsed.data })
    if (error) {
      if (error.message.includes('WATCH_SESSION_NOT_FOUND')) {
        return watchError(422, 'session_not_found', 'session_id is not one of your uploaded sessions.')
      }
      deps.log('watch_store_rep_lab failed', error)
      return watchError(503, 'service_unavailable', 'GRIND is temporarily unavailable. Retry later.', { headers: { 'Retry-After': '300' } })
    }
    return watchJson(data, 201)
  })
}

// ─── POST /sessions ────────────────────────────────────────────────────────

/** Sync-RPC refusals → HTTP. Everything else is a 500. */
const SYNC_ERRORS: Array<[prefix: string, status: number, code: Parameters<typeof watchError>[1], message: string]> = [
  ['WATCH_SESSION_ID_CONFLICT', 409, 'session_id_conflict', 'This session id is already used. Generate a new UUID.'],
  ['WATCH_UNKNOWN_WORKOUT', 422, 'unknown_workout', 'workout_id does not match any of your GRIND days.'],
  ['WATCH_WORKOUT_REQUIRED', 422, 'workout_required', 'Send workout_id, or at least one set with a known exercise_id, when creating a session.'],
  ['WATCH_NO_WORKING_SETS', 422, 'no_working_sets', 'A finished session needs at least one non-warm-up set.'],
  ['WATCH_OPEN_SESSION_CONFLICT', 409, 'open_session_conflict', 'This day is already open in the GRIND app. Finish or discard it there, or send ended_at to upload this session as finished.'],
  ['WATCH_DAY_ALREADY_LOGGED', 409, 'day_already_logged', 'This day is already logged as finished on that date in GRIND.'],
]

/** Validated input → the JSON `watch_sync_session` reads. Weights become
 *  canonical lbs here (CLAUDE.md "Units"); what the device sent is kept too. */
export function toSyncPayload(input: WatchSessionInput) {
  return {
    id: input.id,
    workout_id: input.workout_id ?? null,
    started_at: new Date(input.started_at).toISOString(),
    ended_at: input.ended_at ? new Date(input.ended_at).toISOString() : null,
    utc_offset_seconds: input.utc_offset_seconds ?? null,
    avg_heart_rate: input.heart_rate?.avg ?? null,
    max_heart_rate: input.heart_rate?.max ?? null,
    calories: input.calories ?? null,
    sets: input.sets.map(set => ({
      id: set.id,
      exercise_id: set.exercise_id,
      set_number: set.set_number,
      reps: set.reps,
      // 4 decimals hides float noise (100 kg → 220.462, not 220.46200000000002).
      weight_lbs: set.unit === 'kg' ? Math.round(set.weight * LBS_PER_KG * 1e4) / 1e4 : set.weight,
      entered_weight: set.weight,
      entered_unit: set.unit,
      completed_at: new Date(set.completed_at).toISOString(),
      rest_seconds: set.rest_seconds ?? null,
      is_warmup: set.is_warmup ?? false,
    })),
  }
}

async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) {
    return { ok: false, response: watchError(413, 'payload_too_large', `Request body must be at most ${MAX_BODY_BYTES} bytes. Split the sets across requests.`) }
  }
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, response: watchError(413, 'payload_too_large', `Request body must be at most ${MAX_BODY_BYTES} bytes. Split the sets across requests.`) }
  }
  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false, response: watchError(400, 'invalid_json', 'Request body is not valid JSON.') }
  }
}

export function watchSessions(request: Request, deps: WatchDeps): Promise<Response> {
  return guard(deps, async () => {
    const auth = await authenticateWatch(request, deps)
    if (!auth.ok) return auth.response

    const read = await readJsonBody(request)
    if (!read.ok) return read.response

    const parsed = watchSessionSchema.safeParse(read.body)
    if (!parsed.success) {
      const details = formatIssues(parsed.error)
      return watchError(422, 'validation_failed', `${details[0].path}: ${details[0].message}`, { details })
    }
    const clock = timestampIssues(parsed.data, deps.now().getTime())
    if (clock.length > 0) {
      return watchError(422, 'validation_failed', `${clock[0].path}: ${clock[0].message}`, { details: clock })
    }

    const { data, error } = await deps.rpc('watch_sync_session', {
      p_user: auth.userId,
      p_session: toSyncPayload(parsed.data),
    })
    if (error) {
      const known = SYNC_ERRORS.find(([prefix]) => error.message.includes(prefix))
      if (known) return watchError(known[1], known[2], known[3])
      deps.log('watch_sync_session failed', error)
      return watchError(500, 'internal_error', 'The session could not be saved. Retry later.')
    }

    const result = data as {
      session: { id: string; workout_id: string; created: boolean; completed_now: boolean; completed_at: string | null }
    }

    // Heart rate is advice, not record: if storing it fails (say migration 59
    // isn't applied yet) the workout is still saved and the upload succeeds.
    const body = toBodyPayload(parsed.data)
    if (body) {
      const stored = await deps.rpc('watch_store_session_body', { p_user: auth.userId, p_body: body })
      if (stored.error) deps.log('watch_store_session_body failed', stored.error)
    }
    if (result.session.completed_now && result.session.completed_at) {
      await deps.afterCompletion({
        userId: auth.userId,
        sessionId: result.session.id,
        workoutId: result.session.workout_id,
        completedAt: result.session.completed_at,
      })
    }
    return watchJson(result, result.session.created ? 201 : 200)
  })
}
