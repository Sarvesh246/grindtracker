import {
  DAY_ICON_STROKE,
  DAY_ICON_VIEWBOX,
  resolveDayIconKind,
  type DayIconKind,
} from '@/lib/utils/dayIcons'

/**
 * Shared workout-day glyph for Home CTA, Log DaySelect, and blank-slate heroes.
 *
 * Design language (do not break — weird sizes come from drifting these):
 * - Always viewBox `0 0 24 24`; width === height === `size`
 * - Stroke-only (`currentColor` / `color`), strokeWidth 1.8, round caps/joins
 * - Keep geometry inside ~2px padding of the box (no transforms that scale out)
 * - Prefer simple line art matching Push/Pull/Legs; never emoji or filled blobs
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
      // Bench press — plate-loaded bar over a bench.
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
      // Pull-up bar with hanging handles.
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
      // Squat rack / bar in the pins.
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
      // Torso with ab lines — distinct from pull-up / dumbbell.
      return (
        <svg {...props}>
          <rect x="7" y="4" width="10" height="16" rx="3" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="12.5" x2="15" y2="12.5" />
          <line x1="9" y1="16" x2="15" y2="16" />
        </svg>
      )
    case 'upper':
      // Shoulders + hanging arms (upper-body day).
      return (
        <svg {...props}>
          <circle cx="12" cy="5.5" r="2.2" />
          <line x1="12" y1="7.7" x2="12" y2="14" />
          <line x1="12" y1="9.5" x2="5.5" y2="13" />
          <line x1="12" y1="9.5" x2="18.5" y2="13" />
          <line x1="5.5" y1="13" x2="5.5" y2="18" />
          <line x1="18.5" y1="13" x2="18.5" y2="18" />
        </svg>
      )
    case 'arms':
      // Compact curl / gun day — short bar with plates, angled.
      return (
        <svg {...props}>
          <g transform="rotate(-28 12 12)">
            <line x1="5" y1="12" x2="19" y2="12" />
            <rect x="2.5" y="9.5" width="3.5" height="5" rx="1" />
            <rect x="18" y="9.5" width="3.5" height="5" rx="1" />
          </g>
        </svg>
      )
    case 'shoulders':
      // Overhead press bar above the head line.
      return (
        <svg {...props}>
          <line x1="6" y1="16" x2="18" y2="16" />
          <line x1="12" y1="16" x2="12" y2="10" />
          <line x1="5" y1="7" x2="19" y2="7" />
          <rect x="2.5" y="5" width="3.5" height="4" rx="1" />
          <rect x="18" y="5" width="3.5" height="4" rx="1" />
        </svg>
      )
    case 'cardio':
      // Pulse / heart-rate blip.
      return (
        <svg {...props}>
          <polyline points="3 12 7 12 9.5 6 12.5 18 15 12 21 12" />
        </svg>
      )
    case 'full':
      // Full-body stick figure in the same stroke language.
      return (
        <svg {...props}>
          <circle cx="12" cy="5" r="2.2" />
          <line x1="12" y1="7.2" x2="12" y2="14" />
          <line x1="12" y1="9.5" x2="6.5" y2="12.5" />
          <line x1="12" y1="9.5" x2="17.5" y2="12.5" />
          <line x1="12" y1="14" x2="8" y2="20" />
          <line x1="12" y1="14" x2="16" y2="20" />
        </svg>
      )
    case 'default':
    default:
      // Horizontal dumbbell — blank-slate / unknown custom days.
      return (
        <svg {...props}>
          <line x1="6" y1="12" x2="18" y2="12" />
          <rect x="2" y="9" width="4" height="6" rx="1.5" />
          <rect x="18" y="9" width="4" height="6" rx="1.5" />
        </svg>
      )
  }
}
