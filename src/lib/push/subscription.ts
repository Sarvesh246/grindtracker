const PROVIDER = /^(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.notify\.windows\.com)$/
const ENDPOINT = /^https:\/\/([^/]+)\/[^\s\x00-\x1f\x7f#\\]+$/u

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 4096 || /\s/u.test(value)) return false
  const host = ENDPOINT.exec(value)?.[1]
  return !!host && PROVIDER.test(host)
}

export function parsePushSubscription(input: unknown) {
  if (!input || typeof input !== 'object') return null
  const { endpoint, keys, expirationTime } = input as {
    endpoint?: unknown
    keys?: { p256dh?: unknown; auth?: unknown }
    expirationTime?: unknown
  }
  const { p256dh, auth } = keys ?? {}
  if (!isPushEndpoint(endpoint) ||
      typeof p256dh !== 'string' || !/^[A-Za-z0-9_-]{87}=?$/.test(p256dh) || p256dh.trim() !== p256dh ||
      typeof auth !== 'string' || !/^[A-Za-z0-9_-]{22}(==)?$/.test(auth) || auth.trim() !== auth) return null
  if (expirationTime != null &&
      (typeof expirationTime !== 'number' || !Number.isFinite(new Date(expirationTime).getTime()))) return null

  return { endpoint, p256dh, auth, expires: typeof expirationTime === 'number' ? new Date(expirationTime).toISOString() : null }
}
