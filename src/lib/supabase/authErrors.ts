/**
 * Is this auth error "Supabase couldn't be reached" rather than "this session
 * is not valid"? The proxy must tell the two apart: a dead or slow connection
 * says nothing about who the user is, so it must never be treated as signed
 * out (that redirects an established user to /login on every flaky launch).
 */
export function isTransientAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: string; status?: number; message?: string }
  if (e.name === 'AuthRetryableFetchError') return true
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true
  if (typeof e.status === 'number' && (e.status === 0 || e.status >= 500)) return true
  return /timed? ?out|aborted|fetch failed|network/i.test(e.message ?? '')
}
