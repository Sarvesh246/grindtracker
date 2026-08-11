import { FLAME_OUTER, FlamePaths } from '@/components/FlameIcon'

/**
 * Hand-drawn line icon per badge id (same visual language across the profile
 * badge grid, the completion modal's "badges earned" list, and the full-screen
 * unlock celebration) — one shared component instead of three copies drifting
 * apart. Falls back to a plain circle for any id without a dedicated icon.
 */
export default function BadgeIcon({ badgeId, size = 28, earned }: { badgeId: string; size?: number; earned: boolean }) {
  const color = earned ? 'var(--accent-text)' : 'var(--text-disabled)'
  const s = { width: size, height: size }
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' as const, stroke: color, strokeWidth: '1.8', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  switch (badgeId) {
    case 'first_workout':
      return <svg {...props}><line x1="6" y1="12" x2="18" y2="12"/><rect x="3" y="9.5" width="3" height="5" rx="1"/><rect x="18" y="9.5" width="3" height="5" rx="1"/><circle cx="12" cy="5" r="2"/><path d="M12 7v3"/></svg>
    case 'first_pr':
      return <svg {...props}><polyline points="8 6 12 2 16 6"/><path d="M12 2v10"/><path d="M5 17l1.5-5h11L19 17"/><path d="M3 22h18"/></svg>
    case 'streak_3':
      return <svg {...props}><FlamePaths /></svg>
    case 'streak_7':
      return <svg {...props}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    case 'streak_14':
      return (
        <svg {...props}>
          <g transform="translate(-1.2 0.4) scale(0.72)">
            <path d={FLAME_OUTER} />
          </g>
          <g transform="translate(6.8 3.2) scale(0.58)">
            <path d={FLAME_OUTER} />
          </g>
        </svg>
      )
    case 'streak_30':
      return <svg {...props}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    case 'streak_60':
      return <svg {...props}><circle cx="12" cy="12" r="9.5"/><polygon points="13 7 8 13 11.5 13 11 17 16 11 12.5 11 13 7" fill={color} fillOpacity="0.15"/></svg>
    case 'workouts_10':
      return <svg {...props}><polyline points="20 6 9 17 4 12"/></svg>
    case 'workouts_50':
      return <svg {...props}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
    case 'workouts_100':
      return <svg {...props}><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/></svg>
    case 'workouts_200':
      return <svg {...props}><path d="M12 2l8 3.5v5c0 5-3.4 8.7-8 10.5-4.6-1.8-8-5.5-8-10.5v-5L12 2z"/><polyline points="8.5 12 11 14.5 15.5 9.5"/></svg>
    case 'workouts_365':
      return <svg {...props}><path d="M4 4a8 8 0 1 0 7-4"/><polyline points="8 1 11 0 10 3"/></svg>
    case 'all_three_days':
      return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="15" x2="8.01" y2="15" strokeWidth="2.5"/><line x1="12" y1="15" x2="12.01" y2="15" strokeWidth="2.5"/><line x1="16" y1="15" x2="16.01" y2="15" strokeWidth="2.5"/></svg>
    case 'weekend_warrior':
      return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="13.5" y="13" width="4" height="4" rx="0.5" fill={color} fillOpacity="0.35" stroke="none"/><rect x="6.5" y="13" width="4" height="4" rx="0.5" fill={color} fillOpacity="0.35" stroke="none"/></svg>
    case 'pr_5':
      return <svg {...props}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
    case 'pr_25':
      // Rising — ascending area chart + clear up-arrow (25 PRs).
      return (
        <svg {...props}>
          <path
            d="M2.5 19.2 L7 14 L10.5 15.8 L15.5 9.2 L20.5 5.2 V19.2 Z"
            fill={color}
            fillOpacity="0.15"
            stroke="none"
          />
          <polyline points="2.5 19.2 7 14 10.5 15.8 15.5 9.2 20.5 5.2" />
          <line x1="2" y1="19.5" x2="22" y2="19.5" strokeWidth="1.5" />
          <polyline points="16.8 5.4 20.5 5.2 20.5 8.9" />
        </svg>
      )
    case 'pr_50':
      // Powerhouse — ascending power columns + crest spark (50 PRs).
      return (
        <svg {...props}>
          <line x1="2.2" y1="20" x2="21.8" y2="20" strokeWidth="1.5" />
          <rect x="3" y="13.6" width="3.7" height="6.4" rx="1" fill={color} fillOpacity="0.1" strokeWidth="1.5" />
          <rect x="7.9" y="10.2" width="3.7" height="9.8" rx="1" fill={color} fillOpacity="0.16" strokeWidth="1.5" />
          <rect x="12.8" y="6.6" width="3.7" height="13.4" rx="1" fill={color} fillOpacity="0.22" strokeWidth="1.5" />
          <rect x="17.7" y="3.2" width="3.7" height="16.8" rx="1" fill={color} fillOpacity="0.3" strokeWidth="1.5" />
          <path d="M19.55 1.35 L19.55 3.05 M18.4 2.2 L20.7 2.2" strokeWidth="1.55" />
        </svg>
      )
    case 'pr_100':
      return <svg {...props}><path d="M6 21V10a6 6 0 0 1 12 0v11"/><path d="M6 21h12"/><circle cx="12" cy="8" r="2.2"/></svg>
    case 'level_5':
      return <svg {...props}><polygon points="12 2 20 12 12 22 4 12 12 2"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
    case 'level_10':
      return <svg {...props}><polygon points="12 2 20 12 12 22 4 12 12 2"/><polygon points="12 6 17 12 12 18 7 12 12 6" fill={color} fillOpacity="0.15"/></svg>
    case 'level_15':
      return <svg {...props}><polygon points="12 1 21 7 21 17 12 23 3 17 3 7 12 1"/><polygon points="12 6 17 9.5 17 14.5 12 18 7 14.5 7 9.5 12 6" fill={color} fillOpacity="0.2"/></svg>
    case 'level_20':
      return <svg {...props}><polygon points="12 2 15.5 8.5 22 9.5 17 14.5 18.2 21 12 17.8 5.8 21 7 14.5 2 9.5 8.5 8.5 12 2"/><circle cx="12" cy="12" r="2.5" fill={color} fillOpacity="0.3"/></svg>
    case 'volume_100k':
      return <svg {...props}><line x1="2" y1="21" x2="22" y2="21"/><rect x="5" y="15" width="4" height="6"/><rect x="10.5" y="10" width="4" height="11"/><rect x="16" y="5" width="4" height="16" fill={color} fillOpacity="0.15"/></svg>
    case 'volume_500k':
      return <svg {...props}><line x1="2" y1="21" x2="22" y2="21"/><rect x="4" y="14" width="3.5" height="7"/><rect x="9" y="9" width="3.5" height="12"/><rect x="14" y="5" width="3.5" height="16" fill={color} fillOpacity="0.15"/><rect x="19" y="2" width="3" height="19" fill={color} fillOpacity="0.3"/></svg>
    case 'volume_1m':
      return <svg {...props}><path d="M3 21l4-7 4 4 5-9 5 5"/><circle cx="21" cy="14" r="1.4" fill={color}/><circle cx="7" cy="14" r="1.4" fill={color}/><circle cx="11" cy="18" r="1.4" fill={color}/><circle cx="16" cy="9" r="1.4" fill={color}/></svg>
    case 'plates_225':
      return <svg {...props}><line x1="8.4" y1="12" x2="15.6" y2="12"/><rect x="1.6" y="5.8" width="2.5" height="12.4" rx="1.1" strokeWidth="1.4" fill={color} fillOpacity="0.08"/><rect x="4.7" y="5.8" width="2.5" height="12.4" rx="1.1" strokeWidth="1.4" fill={color} fillOpacity="0.22"/><rect x="16.8" y="5.8" width="2.5" height="12.4" rx="1.1" strokeWidth="1.4" fill={color} fillOpacity="0.22"/><rect x="19.9" y="5.8" width="2.5" height="12.4" rx="1.1" strokeWidth="1.4" fill={color} fillOpacity="0.08"/><line x1="0.4" y1="12" x2="1.6" y2="12"/><line x1="22.4" y1="12" x2="23.6" y2="12"/></svg>
    case 'plates_315':
      return <svg {...props}><line x1="9.6" y1="12" x2="14.4" y2="12"/><rect x="0.8" y="5.8" width="2.15" height="12.4" rx="0.95" strokeWidth="1.35" fill={color} fillOpacity="0.06"/><rect x="3.4" y="5.8" width="2.15" height="12.4" rx="0.95" strokeWidth="1.35" fill={color} fillOpacity="0.14"/><rect x="6" y="5.8" width="2.15" height="12.4" rx="0.95" strokeWidth="1.35" fill={color} fillOpacity="0.24"/><rect x="15.85" y="5.8" width="2.15" height="12.4" rx="0.95" strokeWidth="1.35" fill={color} fillOpacity="0.24"/><rect x="18.45" y="5.8" width="2.15" height="12.4" rx="0.95" strokeWidth="1.35" fill={color} fillOpacity="0.14"/><rect x="21.05" y="5.8" width="2.15" height="12.4" rx="0.95" strokeWidth="1.35" fill={color} fillOpacity="0.06"/><line x1="0.2" y1="12" x2="0.8" y2="12"/><line x1="23.2" y1="12" x2="23.8" y2="12"/></svg>
    case 'plates_405':
      return <svg {...props}><line x1="10.4" y1="12" x2="13.6" y2="12"/><rect x="0.4" y="6" width="1.85" height="12" rx="0.8" strokeWidth="1.25" fill={color} fillOpacity="0.05"/><rect x="2.6" y="6" width="1.85" height="12" rx="0.8" strokeWidth="1.25" fill={color} fillOpacity="0.1"/><rect x="4.8" y="6" width="1.85" height="12" rx="0.8" strokeWidth="1.25" fill={color} fillOpacity="0.16"/><rect x="7" y="6" width="1.85" height="12" rx="0.8" strokeWidth="1.25" fill={color} fillOpacity="0.26"/><rect x="15.15" y="6" width="1.85" height="12" rx="0.8" strokeWidth="1.25" fill={color} fillOpacity="0.26"/><rect x="17.35" y="6" width="1.85" height="12" rx="0.8" strokeWidth="1.25" fill={color} fillOpacity="0.16"/><rect x="19.55" y="6" width="1.85" height="12" rx="0.8" strokeWidth="1.25" fill={color} fillOpacity="0.1"/><rect x="21.75" y="6" width="1.85" height="12" rx="0.8" strokeWidth="1.25" fill={color} fillOpacity="0.05"/></svg>
    case 'early_bird':
      return <svg {...props}><circle cx="12" cy="14" r="4.5"/><line x1="2" y1="19" x2="22" y2="19"/><line x1="12" y1="4" x2="12" y2="6.5"/><line x1="5.5" y1="7.5" x2="7.2" y2="9.2"/><line x1="18.5" y1="7.5" x2="16.8" y2="9.2"/></svg>
    case 'night_owl':
      return <svg {...props}><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/><line x1="18" y1="3" x2="18" y2="6" strokeWidth="1.4"/><line x1="16.5" y1="4.5" x2="19.5" y2="4.5" strokeWidth="1.4"/></svg>
    case 'comeback':
      return <svg {...props}><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 3 3 6 6.5 6"/></svg>
    case 'flawless':
      return <svg {...props}><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15z" strokeWidth="1.3"/></svg>
    case 'rest_day_set':
      return <svg {...props}><path d="M18.5 15.8A7.4 7.4 0 1 1 9.8 5a5.9 5.9 0 0 0 8.7 10.8z"/><line x1="16.2" y1="7.2" x2="16.2" y2="13.2" strokeWidth="2"/><line x1="19.4" y1="7.2" x2="19.4" y2="13.2" strokeWidth="2"/></svg>
    case 'not_alone':
      return <svg {...props}><circle cx="8.5" cy="8" r="3"/><path d="M2.5 20v-1.5A4.5 4.5 0 0 1 8.5 14a4.5 4.5 0 0 1 5 4.5V20"/><circle cx="16.5" cy="8.5" r="2.5"/><path d="M14.7 14.2A4 4 0 0 1 21 17.7V19" strokeWidth="1.5"/></svg>
    case 'rep_machine':
      return <svg {...props}><polyline points="4 6 10 12 4 18"/><polyline points="13 6 19 12 13 18"/></svg>
    case 'weight_tracked':
      return <svg {...props}><path d="M4 18a8 8 0 0 1 16 0"/><line x1="4" y1="18" x2="20" y2="18"/><line x1="12" y1="18" x2="15.5" y2="11.5"/><circle cx="12" cy="18" r="1.2" fill={color}/></svg>
    case 'completionist':
      return <svg {...props}><circle cx="12" cy="9" r="6"/><polygon points="12 6.2 13.2 8.4 15.6 8.8 13.9 10.5 14.3 12.9 12 11.7 9.7 12.9 10.1 10.5 8.4 8.8 10.8 8.4 12 6.2" fill={color} fillOpacity="0.3"/><path d="M8 14.5L6 22l6-3 6 3-2-7.5"/></svg>
    default:
      return <svg {...props} style={s}><circle cx="12" cy="12" r="10"/></svg>
  }
}
