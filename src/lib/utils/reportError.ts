/**
 * Lightweight structured client error reporting.
 * Scrubs emails/tokens and always logs to console; when a reporting endpoint
 * is configured (NEXT_PUBLIC_ERROR_ENDPOINT) posts a minimal JSON payload.
 */

const SENSITIVE = /(?:authorization|token|password|cookie|email)/i

export function reportError(
  error: unknown,
  context: {
    route?: string
    operation?: string
    digest?: string
    extra?: Record<string, unknown>
  } = {},
): void {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error'

  const payload: Record<string, unknown> = {
    message: message.slice(0, 500),
    name: error instanceof Error ? error.name : 'Error',
    route: context.route ?? (typeof window !== 'undefined' ? window.location.pathname : undefined),
    operation: context.operation,
    digest: context.digest,
    ts: new Date().toISOString(),
  }

  if (context.extra) {
    const scrubbed: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(context.extra)) {
      if (SENSITIVE.test(k)) scrubbed[k] = '[redacted]'
      else if (typeof v === 'string') scrubbed[k] = v.slice(0, 200)
      else scrubbed[k] = v
    }
    payload.extra = scrubbed
  }

  console.error('[grind]', payload.operation ?? 'error', payload)

  const endpoint =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_ERROR_ENDPOINT
      : undefined
  if (endpoint && typeof fetch === 'function') {
    try {
      void fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      })
    } catch {
      // reporting must never throw
    }
  }
}
