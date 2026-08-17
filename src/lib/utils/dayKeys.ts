/**
 * Day-key helpers.
 *
 * A day key is the primary key for a workout day everywhere: `exercises.day_type`,
 * `user_day_categories.day_key`, the rotation `sequence`, and — crucially — the
 * `?day=` query parameter that `/log` reads to open a workout. That last one is
 * why the character set matters: a key built by naively hyphenating whitespace
 * (`"Arms & Abs"` → `"arms-&-abs"`) silently truncates at the `&` once it is
 * interpolated into a URL, so `/log?day=arms-&-abs` opens a workout for the
 * non-existent day `"arms-"` and renders "NO EXERCISES FOR THIS DAY". The same
 * goes for `#` (starts a fragment), `+` (decodes to a space), `?`, `/`, and `%`
 * (starts a percent-escape).
 *
 * Two defences, both needed:
 *  - `slugDayKey` keeps NEW keys inside `[a-z0-9-]`, so they are safe by
 *    construction and stable across the app.
 *  - `logDayHref` percent-encodes at the URL boundary, so keys that already
 *    exist (created before this, or by the Coach's `create_day`, which allows
 *    spaces and underscores) still navigate correctly.
 */

/**
 * Normalize a user-typed day name into a URL-safe key: lowercase, whitespace
 * and any other unsupported character collapsed to a single hyphen, no leading
 * or trailing hyphens. Returns '' when nothing usable is left.
 */
export function slugDayKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** `/log?day=…` with the key percent-encoded (see the note above). */
export function logDayHref(dayKey: string): string {
  return `/log?day=${encodeURIComponent(dayKey)}`
}
