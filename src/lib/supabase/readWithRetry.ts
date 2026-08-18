import { reportError } from '@/lib/utils/reportError'

/**
 * One retry for a Supabase read whose empty result is indistinguishable from
 * "this account has no data yet".
 *
 * The home dashboard fires a dozen reads in parallel on every render. A single
 * transient failure among them (pooler saturation, a dropped connection, a
 * PostgREST 5xx) surfaces as `{ data: null }` — and because every read here is
 * destructured as `{ data }` with the error dropped, that blip used to render
 * an established user the brand-new-account dashboard: welcome hero, level and
 * streak at zero. Reloading "fixed" it because the next read succeeded.
 *
 * So: retry once, and when it still fails, log it rather than letting an empty
 * result pass as truth. Callers that can tell a failed read from a genuinely
 * empty one (see `failed`) should also refuse to render the empty state.
 */
export async function readWithRetry<R extends { error: unknown }>(
  operation: string,
  run: () => PromiseLike<R>,
  opts: {
    /** Total attempts including the first. Default 2. */
    attempts?: number
    /** Backoff before attempt n, multiplied by n. Default 120ms. */
    delayMs?: number
    /**
     * Treat a result as a failure worth retrying. Defaults to "there was an
     * error"; pass a custom predicate when a *shape* of success is also
     * impossible (e.g. a row that is guaranteed to exist coming back null).
     */
    failed?: (result: R) => boolean
  } = {},
): Promise<R> {
  const attempts = Math.max(1, opts.attempts ?? 2)
  const delayMs = opts.delayMs ?? 120
  const failed = opts.failed ?? ((result: R) => result.error != null)

  let result = await run()
  for (let attempt = 1; attempt < attempts && failed(result); attempt++) {
    await new Promise(resolve => setTimeout(resolve, delayMs * attempt))
    result = await run()
  }

  if (failed(result)) {
    reportError(toError(result.error), {
      operation: `read:${operation}`,
      extra: { attempts },
    })
  }

  return result
}

/**
 * PostgREST errors are plain objects, not `Error`s — `reportError` would log
 * them as "Unknown error" and drop the one field that identifies the failure.
 */
function toError(error: unknown): Error {
  if (error instanceof Error) return error
  if (error && typeof error === 'object') {
    const { message, code } = error as { message?: unknown; code?: unknown }
    const text = typeof message === 'string' ? message : JSON.stringify(error)
    const wrapped = new Error(typeof code === 'string' ? `${code}: ${text}` : text)
    wrapped.name = 'PostgrestError'
    return wrapped
  }
  return new Error('read returned no data')
}
