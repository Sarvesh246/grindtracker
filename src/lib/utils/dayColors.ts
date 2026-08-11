/**
 * Day-type / category colors shared by WorkoutCalendar and DaySelect.
 *
 * Named push/pull/legs stay fixed; anything else (custom day keys on the
 * calendar, or category `other` on DaySelect) draws from EXTRA_COLORS by
 * stable index among the unknown set passed by the caller.
 */

/** Fill colors — backgrounds, borders, dots. Same in both themes. */
export const NAMED_DAY_COLORS: Record<string, string> = {
  push: '#c8f135', // lime green (matches app accent)
  pull: '#38bdf8', // sky blue
  legs: '#fb923c', // orange
}

/** Light-mode text/label colors — dark accessible variants of the fills. */
export const NAMED_DAY_TEXT_COLORS_LIGHT: Record<string, string> = {
  push: '#5a7a1a', // dark olive  (fill: lime)
  pull: '#075985', // dark blue   (fill: sky)
  legs: '#9a3412', // dark sienna (fill: orange)
}

/** Fallback pool for custom / "other" day types. */
export const EXTRA_DAY_COLORS = ['#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#e879f9']

/** Dark accessible variants for EXTRA_DAY_COLORS (same order). */
export const EXTRA_DAY_TEXT_COLORS_LIGHT = ['#5b21b6', '#9d174d', '#065f46', '#92400e', '#991b1b', '#86198f']

/** Vibrant fill color used for backgrounds, borders, and dots. */
export function resolveDayColor(type: string, extraTypes: string[]): string {
  if (NAMED_DAY_COLORS[type]) return NAMED_DAY_COLORS[type]
  const idx = extraTypes.indexOf(type)
  return EXTRA_DAY_COLORS[(idx >= 0 ? idx : 0) % EXTRA_DAY_COLORS.length]
}

/**
 * Readable text/icon color for a day type.
 * Dark mode: same as the fill. Light mode: darkened accessible variant.
 */
export function resolveDayTextColor(type: string, extraTypes: string[], isLight: boolean): string {
  if (!isLight) return resolveDayColor(type, extraTypes)
  if (NAMED_DAY_TEXT_COLORS_LIGHT[type]) return NAMED_DAY_TEXT_COLORS_LIGHT[type]
  const idx = extraTypes.indexOf(type)
  return EXTRA_DAY_TEXT_COLORS_LIGHT[(idx >= 0 ? idx : 0) % EXTRA_DAY_TEXT_COLORS_LIGHT.length]
}

/** Hex + 2-digit alpha suffix helpers matching calendar cell tints. */
export function dayTintBg(fill: string, isLight: boolean): string {
  return `${fill}${isLight ? '33' : '28'}`
}

export function dayTintBorder(fill: string, isLight: boolean): string {
  return `${fill}${isLight ? '88' : '55'}`
}
