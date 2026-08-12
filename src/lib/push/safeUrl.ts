/**
 * Notification click targets must stay on this origin.
 * Absolute / protocol-relative URLs are rewritten to /home.
 */
export function safeAppPath(url: unknown, fallback = '/home'): string {
  if (typeof url !== 'string') return fallback
  const trimmed = url.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback
  if (trimmed.includes('\\') || trimmed.includes('://')) return fallback
  return trimmed
}
