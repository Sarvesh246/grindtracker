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

/** Loose form used only to compare a spoken/typed name to a stored key:
 *  slugged, with filler words ("day", "workout") and a plural "s" removed so
 *  "Push Day", "push", "Pushes" and "push-day" all compare equal. */
function looseDayName(raw: string): string {
  const slug = slugDayKey(raw)
    .split('-')
    .filter(w => w && w !== 'day' && w !== 'workout' && w !== 'session')
    .join('-')
  // Drop a plural "s" ("legs" → "leg"); both sides get the same treatment.
  return slug.length > 3 && slug.endsWith('s') && !slug.endsWith('ss') ? slug.slice(0, -1) : slug
}

/**
 * Map whatever name the user (or the Coach) used to the day's real key, or null
 * when it matches nothing / more than one day. Wording must not matter: exact
 * key, label casing, spaces vs hyphens, "Push Day" vs "push", plurals.
 */
export function resolveDayKey(raw: string, dayKeys: string[]): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (dayKeys.includes(trimmed)) return trimmed
  const lower = trimmed.toLowerCase()
  const ci = dayKeys.filter(k => k.toLowerCase() === lower)
  if (ci.length === 1) return ci[0]
  const slug = slugDayKey(trimmed)
  const bySlug = dayKeys.filter(k => slugDayKey(k) === slug)
  if (bySlug.length === 1) return bySlug[0]
  const loose = looseDayName(trimmed)
  if (!loose) return null
  const byLoose = dayKeys.filter(k => looseDayName(k) === loose)
  return byLoose.length === 1 ? byLoose[0] : null
}

/** `/log?day=…` with the key percent-encoded (see the note above). */
export function logDayHref(dayKey: string): string {
  return `/log?day=${encodeURIComponent(dayKey)}`
}

/**
 * Day keys that are switched on: a day is disabled when it has exercises but
 * none of them is active (Manage → "Disable day" flips every exercise off).
 * Everything that builds the rotation / "up next" suggestion goes through this
 * so a disabled day drops out of Log, Home and the Coach without being deleted
 * — its history, colors and exercises stay put and re-enabling restores it.
 * Rows without an `active` field count as active.
 */
export function enabledDayKeys(
  rows: ReadonlyArray<{ day_type: string; active?: boolean | null }>,
): string[] {
  const enabled = new Set<string>()
  for (const r of rows) {
    if (r.active !== false) enabled.add(String(r.day_type))
  }
  return [...enabled]
}

/** A day with exercises where every one is inactive. */
export function isDayDisabled(
  rows: ReadonlyArray<{ day_type: string; active?: boolean | null }>,
  dayKey: string,
): boolean {
  let any = false
  for (const r of rows) {
    if (r.day_type !== dayKey) continue
    any = true
    if (r.active !== false) return false
  }
  return any
}
