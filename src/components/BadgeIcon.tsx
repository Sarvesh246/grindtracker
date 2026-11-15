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
      // One trip around the sun — an orbit with the planet partway round.
      return <svg {...props}><ellipse cx="12" cy="12" rx="10" ry="7" transform="rotate(-20 12 12)" strokeWidth="1.5"/><circle cx="12" cy="12" r="2.3" fill={color} fillOpacity="0.35"/><path d="M15.7 12L16.6 12M14.62 14.62L15.25 15.25M12 15.7L12 16.6M9.38 14.62L8.75 15.25M8.3 12L7.4 12M9.38 9.38L8.75 8.75M12 8.3L12 7.4M14.62 9.38L15.25 8.75" strokeWidth="1.4"/><circle cx="17.66" cy="5.15" r="2" fill={color} stroke="none"/></svg>
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
      // Powerhouse — kettlebell stamped with a PR chevron (50 PRs). Kept off the
      // bar-chart motif so it doesn't read as another volume tier.
      return <svg {...props}><path d="M8.85 21A6.6 6.6 0 1 1 15.15 21z" fill={color} fillOpacity="0.15"/><path d="M8.6 9.6 7.9 6.4a3 3 0 0 1 2.9-3.9h2.4a3 3 0 0 1 2.9 3.9l-.7 3.2"/><polyline points="9.6 17.4 12 15 14.4 17.4"/></svg>
    case 'pr_100':
      // Trophy — the 100-PR milestone (Personal Best is the podium arrow).
      return <svg {...props}><path d="M6.5 3h11v6a5.5 5.5 0 0 1-11 0z" fill={color} fillOpacity="0.15"/><path d="M6.5 5H4a2.8 2.8 0 0 0 3 4.6"/><path d="M17.5 5H20a2.8 2.8 0 0 1-3 4.6"/><line x1="12" y1="14.5" x2="12" y2="18"/><rect x="8" y="18" width="8" height="3.5" rx="1"/></svg>
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
      // The break (dots), then the arc coming back round. Arrowhead tip sits on
      // the arc's end, wings follow its tangent.
      return <svg {...props}><path d="M6.84 19.37A9 9 0 1 0 3.84 8.2"/><polyline points="7.01 6.72 3.84 8.2 2.93 4.82"/><path d="M4.63 17.16h.01M3.39 14.63h.01" strokeWidth="2.4"/></svg>
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
    // ── 57-badge-expansion.sql ──────────────────────────────────────────────
    case 'perfect_week':
      // Calendar like Full Split / Weekend Warrior, but the whole week checked off.
      return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="3.9" y="10.9" width="16.2" height="10.2" rx="1.2" fill={color} fillOpacity="0.12" stroke="none"/><polyline points="8 15.8 10.9 18.6 16.2 13.4"/></svg>
    case 'saved_it':
      // Lifebuoy — the one-off rest day that kept the streak afloat.
      return <svg {...props}><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="4"/><path d="M5.3 5.3l3.9 3.9M18.7 5.3l-3.9 3.9M5.3 18.7l3.9-3.9M18.7 18.7l-3.9-3.9" strokeWidth="2.6"/><path d="M12 2.5a9.5 9.5 0 0 1 6.7 2.8L14.8 9.2A4 4 0 0 0 12 8z M12 21.5a9.5 9.5 0 0 1-6.7-2.8l3.9-3.9A4 4 0 0 0 12 16z" fill={color} fillOpacity="0.2" stroke="none"/></svg>
    case 'rest_day_pro':
      // Bed + drifting z's: rest as a skill, not a lapse.
      return <svg {...props}><path d="M3 19V8"/><path d="M3 15h18v4"/><path d="M21 15v-1.5a3 3 0 0 0-3-3h-7.5V15"/><circle cx="6.6" cy="12.3" r="1.7" fill={color} fillOpacity="0.2"/><path d="M14 3.5h3.2L14 7h3.2" strokeWidth="1.5"/><path d="M19 1.8h2l-2 2.2h2" strokeWidth="1.3"/></svg>
    case 'early_bird_regular':
      // Morning ritual: sunrise over a steaming mug (Early Bird is the bare sunrise).
      return <svg {...props}><path d="M4.5 11h11v5.5a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4z" fill={color} fillOpacity="0.12"/><path d="M15.5 12.5h1.3a2.5 2.5 0 0 1 0 5h-1.3"/><path d="M7 8a3 3 0 0 1 6 0"/><line x1="10" y1="2" x2="10" y2="3.3" strokeWidth="1.5"/><line x1="5.4" y1="4" x2="6.3" y2="4.9" strokeWidth="1.5"/><line x1="14.6" y1="4" x2="13.7" y2="4.9" strokeWidth="1.5"/></svg>
    case 'night_owl_regular':
      // The owl itself — Night Owl is just the moon.
      return <svg {...props}><path d="M5 3.5l2.6 3h8.8L19 3.5V14a7 7 0 0 1-14 0z"/><circle cx="9" cy="11" r="2.4"/><circle cx="15" cy="11" r="2.4"/><circle cx="9" cy="11" r="0.9" fill={color} stroke="none"/><circle cx="15" cy="11" r="0.9" fill={color} stroke="none"/><path d="M11 14.2l1 1.6 1-1.6" strokeWidth="1.5"/><path d="M9 20.8v-1.6M15 20.8v-1.6" strokeWidth="1.5"/></svg>
    case 'warmup_ritual':
      // Thermometer climbing with heat shimmer — warming up, not a streak flame.
      return <svg {...props}><path d="M9.5 14.2V4.8a2.5 2.5 0 0 1 5 0v9.4a4.5 4.5 0 1 1-5 0z"/><circle cx="12" cy="17.6" r="2" fill={color} fillOpacity="0.35"/><line x1="12" y1="15.6" x2="12" y2="8.5" strokeWidth="2"/><path d="M18 5c1 1 1 2 0 3s-1 2 0 3" strokeWidth="1.4"/><path d="M5.5 7c.8.8.8 1.6 0 2.4s-.8 1.6 0 2.4" strokeWidth="1.3"/></svg>
    case 'triple_threat':
      // Three corners = push, pull, legs, each fully loaded.
      return <svg {...props}><polygon points="12 3.5 20.5 19 3.5 19 12 3.5" fill={color} fillOpacity="0.1"/><circle cx="12" cy="3.5" r="2" fill={color} fillOpacity="0.4"/><circle cx="20.5" cy="19" r="2" fill={color} fillOpacity="0.4"/><circle cx="3.5" cy="19" r="2" fill={color} fillOpacity="0.4"/></svg>
    case 'variety_pack':
      // Four different shapes in one grid — range, not repetition.
      return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.2" cy="8.2" r="2.3"/><rect x="13.5" y="5.9" width="4.6" height="4.6" rx="0.8" fill={color} fillOpacity="0.25"/><polygon points="8.2 13.5 10.7 18 5.7 18 8.2 13.5" fill={color} fillOpacity="0.25"/><path d="M15.8 13.4v5M13.3 15.9h5"/></svg>
    case 'max_effort':
      // Impact burst — RPE 10, nothing left in the tank.
      return <svg {...props}><polygon points="12 2 13.68 7.93 19.07 4.93 16.07 10.32 22 12 16.07 13.68 19.07 19.07 13.68 16.07 12 22 10.32 16.07 4.93 19.07 7.93 13.68 2 12 7.93 10.32 4.93 4.93 10.32 7.93" fill={color} fillOpacity="0.15"/><circle cx="12" cy="12" r="1.6" fill={color} stroke="none"/></svg>
    case 'hat_trick':
      // Top hat with three PRs popping out of it.
      return <svg {...props}><path d="M7.5 17.5V9.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v8"/><path d="M3.5 17.5c0 1.6 3.8 2.8 8.5 2.8s8.5-1.2 8.5-2.8"/><path d="M3.5 17.5h17"/><rect x="7.5" y="13.5" width="9" height="2.3" fill={color} fillOpacity="0.3" stroke="none"/><path d="M6.6 5.6l1-2M12 4.6V2M17.4 5.6l-1-2" strokeWidth="1.6"/></svg>
    case 'podium_push':
      // Medal with an up-chevron: a month of PRs across the board.
      return <svg {...props}><path d="M8 2l2.8 7.2M16 2l-2.8 7.2"/><circle cx="12" cy="15.5" r="6" fill={color} fillOpacity="0.15"/><polyline points="9.5 16.8 12 14.3 14.5 16.8"/><line x1="12" y1="14.3" x2="12" y2="18.6" strokeWidth="1.6"/></svg>
    case 'daily_weigh_in':
      // Bathroom scale (Tracked is the dial gauge) with a two-week tick row.
      return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="4"/><rect x="8" y="5.8" width="8" height="4.4" rx="1" fill={color} fillOpacity="0.2"/><line x1="12" y1="8.8" x2="13.6" y2="7.2" strokeWidth="1.4"/><path d="M6.5 15h.01M9 15h.01M11.5 15h.01M14 15h.01M16.5 15h.01M6.5 17.8h.01M9 17.8h.01M11.5 17.8h.01M14 17.8h.01M16.5 17.8h.01" strokeWidth="2.2"/></svg>
    case 'goal_getter':
      // Flag planted on the summit — past the target, not just aimed at it.
      return <svg {...props}><path d="M2 20.5l6.5-10.5 3.8 5.6 2.9-3.9 6.8 8.8z" fill={color} fillOpacity="0.12"/><line x1="8.5" y1="10" x2="8.5" y2="2.5"/><path d="M8.5 3h5.5l-1.4 1.7L14 6.4H8.5" fill={color} fillOpacity="0.35"/></svg>
    case 'before_after':
      // Two progress frames side by side, the right one filled out.
      return <svg {...props}><rect x="2" y="4" width="9" height="16" rx="1.6"/><rect x="13" y="4" width="9" height="16" rx="1.6" fill={color} fillOpacity="0.12"/><circle cx="6.5" cy="9" r="1.8"/><path d="M4.4 17v-.6a2.1 2.1 0 0 1 4.2 0v.6"/><circle cx="17.5" cy="9" r="1.8"/><path d="M14.6 17v-.8a2.9 2.9 0 0 1 5.8 0v.8"/></svg>
    case 'squad_goals':
      // A crew of three (Not Alone is two).
      return <svg {...props}><circle cx="12" cy="7.5" r="2.8" fill={color} fillOpacity="0.2"/><path d="M7 20v-1.2a5 5 0 0 1 10 0V20"/><circle cx="5" cy="9.5" r="2.1"/><path d="M1.8 18.5v-.6a3.4 3.4 0 0 1 4.2-3.3" strokeWidth="1.5"/><circle cx="19" cy="9.5" r="2.1"/><path d="M22.2 18.5v-.6a3.4 3.4 0 0 0-4.2-3.3" strokeWidth="1.5"/></svg>
    case 'podium':
      // Three-step podium, 2 · 1 · 3.
      return <svg {...props}><path d="M2 21v-6.5h6.5V9h7v8.5H22V21z" fill={color} fillOpacity="0.12"/><line x1="8.5" y1="14.5" x2="8.5" y2="21"/><line x1="15.5" y1="17.5" x2="15.5" y2="21"/><line x1="12" y1="12" x2="12" y2="16.5" strokeWidth="1.6"/><path d="M12 2.6l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" strokeWidth="1.3"/></svg>
    case 'top_of_board':
      // Leaderboard list, your row on top with the crown.
      return <svg {...props}><rect x="2.5" y="3" width="19" height="6" rx="1.6" fill={color} fillOpacity="0.25"/><path d="M5 7.4l.6-2.6 1.3 1.3 1.3-1.3.6 2.6z" strokeWidth="1.3"/><line x1="11" y1="6" x2="19" y2="6"/><circle cx="6.2" cy="13" r="1.2"/><line x1="11" y1="13" x2="18" y2="13"/><circle cx="6.2" cy="19" r="1.2"/><line x1="11" y1="19" x2="16" y2="19"/></svg>
    case 'off_the_grid':
      // Signal arcs with a slash — logged with no bars.
      return <svg {...props}><path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5.2 12.3a10.5 10.5 0 0 1 13.6 0"/><path d="M8.6 15.8a5.5 5.5 0 0 1 6.8 0"/><circle cx="12" cy="19.5" r="1.2" fill={color} stroke="none"/><line x1="3" y1="3" x2="21" y2="21"/></svg>
    case 'coached':
      // Clipboard plan with a check — the Coach's week, installed.
      return <svg {...props}><rect x="4.5" y="4" width="15" height="18" rx="2"/><rect x="8.5" y="2" width="7" height="4" rx="1" fill={color} fillOpacity="0.3"/><line x1="8" y1="10.5" x2="16" y2="10.5" strokeWidth="1.5"/><line x1="8" y1="14" x2="13" y2="14" strokeWidth="1.5"/><polyline points="12.5 18 14.3 19.8 17.5 16.5"/></svg>
    case 'holiday_grind':
      // Gift box — showing up on a day off.
      return <svg {...props}><rect x="3" y="8.5" width="18" height="4.5" rx="1" fill={color} fillOpacity="0.2"/><path d="M5 13v8h14v-8"/><line x1="12" y1="8.5" x2="12" y2="21"/><path d="M12 8.5C10 8.5 7.5 7.8 7.5 5.9 7.5 4.4 9 3.6 10.2 4.4 11.3 5.2 12 7 12 8.5z"/><path d="M12 8.5c2 0 4.5-.7 4.5-2.6 0-1.5-1.5-2.3-2.7-1.5-1.1.8-1.8 2.6-1.8 4.1z"/></svg>
    case 'own_your_data':
      // Archive box with a download arrow.
      return <svg {...props}><rect x="2" y="3.5" width="20" height="5" rx="1.2" fill={color} fillOpacity="0.2"/><path d="M4 8.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19V8.5"/><line x1="12" y1="11" x2="12" y2="17"/><polyline points="9.4 14.6 12 17.2 14.6 14.6"/></svg>
    case 'speak_up':
      // Speech bubble, mid-sentence.
      return <svg {...props}><path d="M21 11.5c0 4.4-4 8-9 8a9.8 9.8 0 0 1-3.6-.7L3.5 20.5l1.4-4.1A7.6 7.6 0 0 1 3 11.5c0-4.4 4-8 9-8s9 3.6 9 8z" fill={color} fillOpacity="0.1"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" strokeWidth="2.6"/></svg>
    case 'completionist':
      return <svg {...props}><circle cx="12" cy="9" r="6"/><polygon points="12 6.2 13.2 8.4 15.6 8.8 13.9 10.5 14.3 12.9 12 11.7 9.7 12.9 10.1 10.5 8.4 8.8 10.8 8.4 12 6.2" fill={color} fillOpacity="0.3"/><path d="M8 14.5L6 22l6-3 6 3-2-7.5"/></svg>
    default:
      return <svg {...props} style={s}><circle cx="12" cy="12" r="10"/></svg>
  }
}
