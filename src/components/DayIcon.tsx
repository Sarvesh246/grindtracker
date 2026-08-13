import {
  DAY_ICON_STROKE,
  DAY_ICON_VIEWBOX,
  resolveDayIconKind,
  type DayIconKind,
} from '@/lib/utils/dayIcons'

/**
 * Shared workout-day glyph for Home CTA, Log DaySelect, and blank-slate heroes.
 *
 * Visual theme — gym equipment line icons (not stick figures / medical glyphs):
 * - Always viewBox `0 0 24 24`; width === height === `size`
 * - Stroke-only (`currentColor` / `color`), strokeWidth 1.8, round caps/joins
 * - Geometry stays in ~3–21 so every glyph shares the same optical weight
 * - Plates = small rounded rects; uprights = vertical posts; bars = horizontals
 * - No rotates/scales that clip or make one icon look bigger than another
 * - Distinct silhouettes at 28px (avoid near-duplicates like two mid-racks)
 * - Pick kinds via `resolveDayIconKind` — never invent a one-off SVG at call sites
 */

type Props = {
  /** Day key (`push`, `abs`, `upper_a`, …) — preferred over raw `kind`. */
  dayKey?: string
  /** Leaderboard category for custom days when the name is ambiguous. */
  category?: string | null
  /** Explicit catalog id when the caller already resolved. */
  kind?: DayIconKind
  size?: number
  color?: string
  className?: string
  title?: string
}

export default function DayIcon({
  dayKey,
  category,
  kind: kindProp,
  size = 28,
  color = 'currentColor',
  className,
  title,
}: Props) {
  const kind = kindProp ?? (dayKey ? resolveDayIconKind(dayKey, category) : 'default')
  const props = {
    width: size,
    height: size,
    viewBox: `0 0 ${DAY_ICON_VIEWBOX} ${DAY_ICON_VIEWBOX}`,
    fill: 'none' as const,
    stroke: color,
    strokeWidth: DAY_ICON_STROKE,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    role: title ? ('img' as const) : undefined,
    'aria-hidden': title ? undefined : true,
    'aria-label': title,
  }

  switch (kind) {
    case 'push':
      // Flat bench + loaded bar.
      return (
        <svg {...props}>
          <line x1="5" y1="17" x2="5" y2="21" />
          <line x1="19" y1="17" x2="19" y2="21" />
          <rect x="3" y="14" width="18" height="3" rx="1.5" />
          <line x1="7" y1="9" x2="17" y2="9" />
          <rect x="4" y="6.5" width="3" height="5" rx="1" />
          <rect x="17" y="6.5" width="3" height="5" rx="1" />
        </svg>
      )
    case 'pull':
      // Pull-up station with hanging grips.
      return (
        <svg {...props}>
          <line x1="4" y1="4" x2="4" y2="20" />
          <line x1="20" y1="4" x2="20" y2="20" />
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="9" y1="7" x2="9" y2="13" />
          <line x1="15" y1="7" x2="15" y2="13" />
          <line x1="7" y1="13" x2="11" y2="13" />
          <line x1="13" y1="13" x2="17" y2="13" />
        </svg>
      )
    case 'legs':
      // Squat rack with bar in the J-hooks.
      return (
        <svg {...props}>
          <line x1="5" y1="3" x2="5" y2="21" />
          <line x1="19" y1="3" x2="19" y2="21" />
          <polyline points="5 10 8 10 8 13" />
          <polyline points="19 10 16 10 16 13" />
          <line x1="8" y1="10" x2="16" y2="10" />
          <rect x="2" y="7" width="3" height="6" rx="1" />
          <rect x="19" y="7" width="3" height="6" rx="1" />
        </svg>
      )
    case 'abs':
      // Captain's chair / hanging knee-raise — core station, not a wheel/belt.
      return (
        <svg {...props}>
          <line x1="6" y1="3" x2="6" y2="20" />
          <line x1="18" y1="3" x2="18" y2="20" />
          <line x1="6" y1="4" x2="18" y2="4" />
          <rect x="5" y="8.5" width="4" height="2.2" rx="1" />
          <rect x="15" y="8.5" width="4" height="2.2" rx="1" />
          <line x1="10" y1="6.5" x2="10" y2="11" />
          <line x1="14" y1="6.5" x2="14" y2="11" />
          <path d="M10 11c0 2.2 1 4 2 5.2 1-1.2 2-3 2-5.2" />
        </svg>
      )
    case 'upper':
      // Twin dumbbells — upper free-weight day (vs one default DB / vertical OHP).
      return (
        <svg {...props}>
          <line x1="7" y1="8" x2="17" y2="8" />
          <rect x="3.5" y="5.5" width="3.5" height="5" rx="1" />
          <rect x="17" y="5.5" width="3.5" height="5" rx="1" />
          <line x1="7" y1="16" x2="17" y2="16" />
          <rect x="3.5" y="13.5" width="3.5" height="5" rx="1" />
          <rect x="17" y="13.5" width="3.5" height="5" rx="1" />
        </svg>
      )
    case 'arms':
      // Angular EZ curl bar — clearly bent vs the straight default dumbbell.
      return (
        <svg {...props}>
          <path d="M5 14h2.5l2.5-4h4l2.5 4H19" />
          <rect x="2" y="11" width="3.5" height="6" rx="1" />
          <rect x="18.5" y="11" width="3.5" height="6" rx="1" />
        </svg>
      )
    case 'shoulders':
      // Pair of dumbbells held vertical — overhead press, not another rack.
      return (
        <svg {...props}>
          <line x1="8" y1="7" x2="8" y2="17" />
          <rect x="5.5" y="3.5" width="5" height="3.5" rx="1" />
          <rect x="5.5" y="17" width="5" height="3.5" rx="1" />
          <line x1="16" y1="7" x2="16" y2="17" />
          <rect x="13.5" y="3.5" width="5" height="3.5" rx="1" />
          <rect x="13.5" y="17" width="5" height="3.5" rx="1" />
        </svg>
      )
    case 'cardio':
      // Stationary bike — reads as cardio equipment, not headphones.
      return (
        <svg {...props}>
          <circle cx="7.5" cy="16" r="4" />
          <circle cx="17" cy="16" r="4" />
          <path d="M7.5 16 L11.5 8.5 H16.5" />
          <line x1="11.5" y1="8.5" x2="11.5" y2="13" />
          <line x1="10" y1="13" x2="13" y2="13" />
          <line x1="16.5" y1="8.5" x2="17" y2="12" />
          <line x1="15" y1="6.5" x2="18.5" y2="6.5" />
          <line x1="18.5" y1="6.5" x2="18.5" y2="8" />
        </svg>
      )
    case 'full':
      // Kettlebell — clear full-body tool in the same stroke language.
      return (
        <svg {...props}>
          <path d="M9 9.5V7.5c0-1.8 1.3-3 3-3s3 1.2 3 3v2" />
          <line x1="9" y1="9.5" x2="15" y2="9.5" />
          <circle cx="12" cy="15.5" r="5" />
        </svg>
      )
    case 'default':
    default:
      // Straight dumbbell — blank-slate / unknown custom days.
      return (
        <svg {...props}>
          <line x1="6" y1="12" x2="18" y2="12" />
          <rect x="2" y="9" width="4" height="6" rx="1.5" />
          <rect x="18" y="9" width="4" height="6" rx="1.5" />
        </svg>
      )
  }
}
