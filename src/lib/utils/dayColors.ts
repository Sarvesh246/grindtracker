/**
 * Day-type / category colors shared by WorkoutCalendar and DaySelect.
 *
 * Named push/pull/legs stay fixed; anything else (custom day keys on the
 * calendar, or category `other` on DaySelect) draws from EXTRA_COLORS by
 * stable index among the unknown set passed by the caller.
 */

/** Fill colors — backgrounds, borders, dots (dark / neon on OLED). */
export const NAMED_DAY_COLORS: Record<string, string> = {
  push: '#c8f135', // lime green (matches app accent)
  pull: '#38bdf8', // sky blue
  legs: '#fb923c', // orange
}

/**
 * Light-mode fills — mid olive/sky/sienna instead of neon lime/sky/orange so
 * calendar cells and legend dots stay visible without washing out on paper.
 */
export const NAMED_DAY_COLORS_LIGHT: Record<string, string> = {
  push: '#6f8f1c',
  pull: '#0284c7',
  legs: '#c2410c',
}

/** Light-mode text/label colors — dark accessible variants of the fills. */
export const NAMED_DAY_TEXT_COLORS_LIGHT: Record<string, string> = {
  push: '#3f5210', // deep olive
  pull: '#075985', // dark blue
  legs: '#7c2d12', // dark sienna
}

/** Fallback pool for custom / "other" day types (dark). */
export const EXTRA_DAY_COLORS = [
  '#a78bfa',
  '#f472b6',
  '#34d399',
  '#fbbf24',
  '#f87171',
  '#e879f9',
]

/** Mid-tone fills for custom days in light mode. */
export const EXTRA_DAY_COLORS_LIGHT = [
  '#7c3aed',
  '#db2777',
  '#059669',
  '#b45309',
  '#dc2626',
  '#c026d3',
]

/** Dark accessible variants for EXTRA_DAY_COLORS (same order). */
export const EXTRA_DAY_TEXT_COLORS_LIGHT = [
  '#5b21b6',
  '#9d174d',
  '#065f46',
  '#92400e',
  '#991b1b',
  '#86198f',
]

/** Vibrant fill color used for backgrounds, borders, and dots. */
export function resolveDayColor(
  type: string,
  extraTypes: string[],
  isLight = false,
): string {
  if (isLight) {
    if (NAMED_DAY_COLORS_LIGHT[type]) return NAMED_DAY_COLORS_LIGHT[type]!
    const idx = extraTypes.indexOf(type)
    return EXTRA_DAY_COLORS_LIGHT[
      (idx >= 0 ? idx : 0) % EXTRA_DAY_COLORS_LIGHT.length
    ]!
  }
  if (NAMED_DAY_COLORS[type]) return NAMED_DAY_COLORS[type]!
  const idx = extraTypes.indexOf(type)
  return EXTRA_DAY_COLORS[(idx >= 0 ? idx : 0) % EXTRA_DAY_COLORS.length]!
}

/**
 * Readable text/icon color for a day type.
 * Dark mode: same as the fill. Light mode: darkened accessible variant.
 */
export function resolveDayTextColor(
  type: string,
  extraTypes: string[],
  isLight: boolean,
): string {
  if (!isLight) return resolveDayColor(type, extraTypes, false)
  if (NAMED_DAY_TEXT_COLORS_LIGHT[type]) return NAMED_DAY_TEXT_COLORS_LIGHT[type]!
  const idx = extraTypes.indexOf(type)
  return EXTRA_DAY_TEXT_COLORS_LIGHT[
    (idx >= 0 ? idx : 0) % EXTRA_DAY_TEXT_COLORS_LIGHT.length
  ]!
}

/** Hex + 2-digit alpha suffix helpers matching calendar cell tints. */
export function dayTintBg(fill: string, isLight: boolean): string {
  // Light: slightly stronger wash of the already-muted fill (still soft).
  return `${fill}${isLight ? '2e' : '28'}`
}

export function dayTintBorder(fill: string, isLight: boolean): string {
  return `${fill}${isLight ? '99' : '55'}`
}

function uniqueTypes(types: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of types) {
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function tintHex(fill: string, isLight: boolean, hover: boolean): string {
  if (hover) return `${fill}${isLight ? '33' : '55'}`
  return dayTintBg(fill, isLight)
}

/**
 * Cell wash for one or more day types. A single type stays a flat tint.
 * Two+ types use a diagonal split with a short blend at each seam — a full
 * smear would muddy blue+purple into gray at this size; a hard 50/50 cut
 * reads like a pie-chart bug. Completion order is preserved (first finished
 * = top-left).
 */
export function calendarCellBackground(
  fillHexes: string[],
  isLight: boolean,
  hover = false,
): string {
  const fills = fillHexes.filter(Boolean)
  if (fills.length === 0) {
    return hover
      ? (isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)')
      : 'transparent'
  }
  const tints = fills.map(h => tintHex(h, isLight, hover))
  if (tints.length === 1) return tints[0]!

  const n = tints.length
  const stops: string[] = []
  for (let i = 0; i < n; i++) {
    const start = (i / n) * 100
    const end = ((i + 1) / n) * 100
    const blend = Math.min(8, (end - start) * 0.35)
    stops.push(`${tints[i]} ${start}%`)
    stops.push(`${tints[i]} ${Math.max(start, end - blend)}%`)
  }
  return `linear-gradient(135deg, ${stops.join(', ')})`
}

export function calendarCellBorder(
  fillHexes: string[],
  isLight: boolean,
  hover = false,
): string {
  const fill = fillHexes[0]
  if (!fill) return hover ? 'var(--border)' : 'transparent'
  return hover ? `${fill}${isLight ? 'aa' : 'cc'}` : dayTintBorder(fill, isLight)
}

/** "pull and abs" / "push, pull, and abs" for aria + hint copy. */
export function joinDayTypes(types: string[]): string {
  const labels = uniqueTypes(types).map(t => t.replace(/-/g, ' '))
  if (labels.length === 0) return ''
  if (labels.length === 1) return labels[0]!
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}
