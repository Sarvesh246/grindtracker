/**
 * Day-icon resolution — one catalog, shared by Home CTA and Log DaySelect.
 *
 * Icons themselves live in `DayIcon` (fixed 24×24 stroke language). This module
 * only picks a *kind* from the day key (+ optional leaderboard category) so
 * custom days like "abs" / "upper_a" get a sensible glyph without inventing
 * freeform SVGs at runtime (which would drift in size/weight).
 *
 * Resolution order:
 *   1. Exact built-in keys (push / pull / legs)
 *   2. Keyword rules on the normalized day name (abs, upper, cardio, …)
 *   3. Leaderboard category fallback (push / pull / legs)
 *   4. Default dumbbell
 */

export const DAY_ICON_KINDS = [
  'push',
  'pull',
  'legs',
  'abs',
  'upper',
  'arms',
  'shoulders',
  'cardio',
  'full',
  'default',
] as const

export type DayIconKind = (typeof DAY_ICON_KINDS)[number]

/** Labels + name examples for the developer gallery (`/admin/icons`). */
export const DAY_ICON_META: Record<DayIconKind, { glyph: string; matches: string[] }> = {
  push: { glyph: 'Flat bench', matches: ['push', 'chest', 'press'] },
  pull: { glyph: 'Pull-up station', matches: ['pull', 'back', 'row', 'lat'] },
  legs: { glyph: 'Squat rack', matches: ['legs', 'lower', 'glute', 'squat'] },
  abs: { glyph: "Captain's chair", matches: ['abs', 'core', 'midsection', 'oblique'] },
  upper: { glyph: 'Twin dumbbells', matches: ['upper'] },
  arms: { glyph: 'EZ curl bar', matches: ['arms', 'bicep', 'tricep'] },
  shoulders: { glyph: 'Vertical dumbbells', matches: ['shoulders', 'delt'] },
  cardio: { glyph: 'Exercise bike', matches: ['cardio', 'hiit', 'run', 'bike'] },
  full: { glyph: 'Kettlebell', matches: ['full', 'full-body', 'full_a'] },
  default: { glyph: 'Straight dumbbell', matches: ['(fallback)'] },
}

/** Design-language constants — keep glyphs inside this box. */
export const DAY_ICON_VIEWBOX = 24
export const DAY_ICON_STROKE = 1.8

type DayCategoryLike = 'push' | 'pull' | 'legs' | 'other' | string | null | undefined

/** Normalize "Upper_A", "full-body", "ABS" → "upper a" / "full body" / "abs". */
export function normalizeDayKey(dayKey: string): string {
  return dayKey
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

/**
 * Keyword → icon kind. More specific patterns first. Each rule is a whole-word
 * / clear substring match against the normalized name (not the raw key).
 */
const KEYWORD_RULES: { re: RegExp; kind: DayIconKind }[] = [
  { re: /\b(abs?|core|midsection|oblique)\b/, kind: 'abs' },
  { re: /\b(cardio|hiit|conditioning|run|running|bike|cycle|endurance)\b/, kind: 'cardio' },
  // "full_a" / "full-body" / bare "full" (template full-body split keys).
  { re: /\b(full(\s*body)?|fullbody|whole\s*body|total\s*body)\b/, kind: 'full' },
  { re: /\b(shoulders?|delts?)\b/, kind: 'shoulders' },
  { re: /\b(arms?|biceps?|triceps?|guns?)\b/, kind: 'arms' },
  { re: /\b(upper)\b/, kind: 'upper' },
  // lower-body days share the legs glyph — same design language, no second squat icon
  { re: /\b(lower|leg|legs|glute|quad|ham|squat)\b/, kind: 'legs' },
  { re: /\b(push|chest|press)\b/, kind: 'push' },
  { re: /\b(pull|back|row|lat)\b/, kind: 'pull' },
]

/**
 * Pick the catalog icon for a workout day.
 * @param dayKey   `sessions.day_type` / exercise day key (e.g. "abs", "upper_a")
 * @param category Optional `user_day_categories.category` for custom days
 */
export function resolveDayIconKind(
  dayKey: string,
  category?: DayCategoryLike,
): DayIconKind {
  const raw = dayKey.trim().toLowerCase()
  if (raw === 'push' || raw === 'pull' || raw === 'legs') return raw

  const name = normalizeDayKey(dayKey)
  if (!name) return 'default'

  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(name)) return rule.kind
  }

  if (category === 'push' || category === 'pull' || category === 'legs') {
    return category
  }

  return 'default'
}
