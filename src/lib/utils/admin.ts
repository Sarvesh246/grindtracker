/**
 * Developer-only surfaces (the feedback inbox) are gated on this address.
 *
 * This is a CONVENIENCE check for routing and conditional UI only — it decides
 * whether someone sees a 404 or a link, nothing more. The real gate is the
 * `is_grind_admin()` SQL function backing the RLS policies in
 * `docs/sql/09-feedback.sql`: even if a client forced its way to /admin/feedback,
 * Postgres would return zero rows and reject every mutation.
 */
export const ADMIN_EMAIL = 'sarveshvjagtap@gmail.com'

export function isAdminEmail(email?: string | null): boolean {
  return !!email && email.trim().toLowerCase() === ADMIN_EMAIL
}
