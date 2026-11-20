import { createHash } from 'node:crypto'

/**
 * Watch API tokens: `gwt_` + 64 lowercase hex characters, minted by the
 * `create_watch_device` RPC (docs/sql/58-watch-api.sql). Only the SHA-256 of
 * the whole string is stored, so hashing here must match the SQL exactly:
 * `encode(sha256(convert_to(token, 'UTF8')), 'hex')`.
 */
const WATCH_TOKEN_PATTERN =/^gwt_[0-9a-f]{64}$/

export function hashWatchToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** The token from an `Authorization: Bearer …` header, or why there isn't one.
 *  A malformed token is rejected here, without a database round trip. */
export function readBearerToken(
  header: string | null,
): { ok: true; token: string } | { ok: false; reason: 'missing' | 'malformed' } {
  if (!header || !header.trim()) return { ok: false, reason: 'missing' }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  if (!match) return { ok: false, reason: 'malformed' }
  const token = match[1]
  return WATCH_TOKEN_PATTERN.test(token) ? { ok: true, token } : { ok: false, reason: 'malformed' }
}
