/**
 * Resolve with `onTimeout` if `work` hasn't settled within `ms`.
 *
 * supabase-js retries a failed token refresh with growing back-off for up to
 * ~30s, and a per-request timeout cannot stop that loop (each attempt fails
 * fast, then it tries again). Only a deadline around the whole call bounds it.
 * The abandoned call keeps running until the function ends; nothing awaits it.
 */
export function withDeadline<T>(work: PromiseLike<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(onTimeout), ms)
  })
  return Promise.race([Promise.resolve(work), deadline]).finally(() => clearTimeout(timer))
}
