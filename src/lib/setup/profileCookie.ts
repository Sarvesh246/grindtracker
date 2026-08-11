/**
 * `grind_profile_ok` marks "this user finished first-run setup" (not merely
 * "profile row exists"). Replay Setup clears it while nulling
 * `user_profiles.setup_completed_at`.
 *
 * Cookie value is version-prefixed (`s1:…`) so pre-wizard clients that cached
 * a bare user id (old "profile exists" meaning) re-hit the DB and get one
 * forced pass through /setup after migration 32.
 */
export const PROFILE_COOKIE = 'grind_profile_ok'
export const PROFILE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
const PROFILE_COOKIE_PREFIX = 's1:'

export function profileCookieValue(userId: string): string {
  return `${PROFILE_COOKIE_PREFIX}${userId}`
}

export function isProfileCookieForUser(
  cookieValue: string | undefined,
  userId: string,
): boolean {
  return cookieValue === profileCookieValue(userId)
}

export function profileCookieOptions(maxAge: number = PROFILE_COOKIE_MAX_AGE) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  }
}
