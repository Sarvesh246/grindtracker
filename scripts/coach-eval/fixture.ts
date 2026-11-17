/**
 * A synthetic account for the Coach eval — same shape as buildCoachContext()
 * output (src/lib/coach/buildContext.ts), small enough to read, realistic
 * enough that data-dependent answers (streak, last bench, rest days) have real
 * facts to check against. Nothing here is a real user's data.
 *
 * "Today" is Monday 2026-11-09. Weekly rest day: Tuesday. Last session: Nov 4.
 */

export type FixtureExercise = {
  name: string
  day_type: string
  sets_target: number
  reps_target: string
  weight_target_lbs: number | null
  active: boolean
}

export type FixtureState = {
  /** Open (unfinished) workout day, if any. */
  openSession: string | null
  /** Working sets logged in the open session. */
  workingSets: number
  unit: 'lbs' | 'kg'
  catalog: FixtureExercise[]
  /** USER_DATA.body (watch data), same shape as bodyContext.ts builds; absent = no watch. */
  body?: Record<string, unknown>
}

const last7 = (charges: number[], rhr: number[]) =>
  charges.map((charge, i) => ({ date: `2026-11-0${3 + i}`, charge, resting_hr: rhr[i] }))

/** Charge 34 (Easy): low Body Battery, a day of recovery still owed. Resting HR only +4. */
export const LOW_CHARGE_BODY = {
  source: 'Garmin watch',
  charge_today: {
    score: 34,
    band: 'Easy',
    inputs: [
      { label: 'Body Battery', value: '31' },
      { label: 'Recovery left', value: '28 h' },
      { label: 'Resting HR', value: '+4 bpm' },
      { label: 'Training load', value: '+18%' },
    ],
    advice: 'Easy. 28 h of recovery still left. Keep your weights and drop the last set of each lift.',
  },
  last_7_days: last7([71, 74, 69, 66, 58, 49, 34], [52, 52, 53, 52, 54, 55, 56]),
  resting_hr: { baseline_30d: 52, latest: 56, days_in_a_row_5plus_over: 0 },
  load: { percent: 18, band: 'building', headline: 'Building well' },
  watch_sessions: [
    { date: '2026-11-08', day: 'pull', avg_hr: 121, max_hr: 166, minutes_z3_plus: 24, hardest: 'Hardest set: lat pulldown set 3 at 166 bpm.' },
  ],
}

/** Charge 88 (Primed): full battery, recovered, resting HR under usual. */
export const HIGH_CHARGE_BODY = {
  source: 'Garmin watch',
  charge_today: {
    score: 88,
    band: 'Primed',
    inputs: [
      { label: 'Body Battery', value: '92' },
      { label: 'Recovery left', value: '0 h' },
      { label: 'Resting HR', value: '-2 bpm' },
      { label: 'Training load', value: '+4%' },
    ],
    advice: "Primed. Body Battery 92 and you're fully recovered. A good day to push your top sets.",
  },
  last_7_days: last7([70, 76, 81, 79, 84, 86, 88], [52, 51, 51, 50, 50, 50, 50]),
  resting_hr: { baseline_30d: 52, latest: 50, days_in_a_row_5plus_over: 0 },
  load: { percent: 4, band: 'building', headline: 'Building well' },
  cardio_cost: [
    { exercise: 'Barbell Bench Press', at: '95 lb × 8', delta_bpm: 9, line: 'Same weight, 9 bpm easier than September.' },
  ],
}

/** Resting HR 7–8 bpm over usual for four days running. */
export const RISING_RHR_BODY = {
  source: 'Garmin watch',
  charge_today: {
    score: 41,
    band: 'Easy',
    inputs: [
      { label: 'Body Battery', value: '48' },
      { label: 'Recovery left', value: '12 h' },
      { label: 'Resting HR', value: '+8 bpm' },
    ],
    advice: 'Easy. Resting heart rate is 8 bpm over your usual. Keep your weights and drop the last set of each lift.',
  },
  last_7_days: last7([72, 70, 68, 52, 47, 44, 41], [52, 53, 52, 59, 59, 60, 60]),
  resting_hr: { baseline_30d: 52, latest: 60, days_in_a_row_5plus_over: 4 },
}

const ex = (
  day_type: string,
  name: string,
  sets_target: number,
  reps_target: string,
  weight_target_lbs: number | null = null,
  active = true,
): FixtureExercise => ({ day_type, name, sets_target, reps_target, weight_target_lbs, active })

export function freshState(overrides: Partial<FixtureState> = {}): FixtureState {
  return {
    openSession: null,
    workingSets: 0,
    unit: 'lbs',
    catalog: [
      ex('push', 'Barbell Bench Press', 4, '6-8', 95),
      ex('push', 'Incline Dumbbell Press', 3, '8-10', 25),
      ex('push', 'Lateral Raise', 3, '12-15', 10),
      ex('push', 'Tricep Rope Pushdown', 3, '10-12', 30),
      ex('push', 'Curls', 3, '10-12', 20),
      ex('pull', 'Lat Pulldown', 3, '10-12', 80),
      ex('pull', 'Chest-Supported Dumbbell Row', 4, '8-10', 35),
      ex('pull', 'Pull-Ups', 3, '6-10'),
      ex('legs', 'Barbell Squat', 4, '6-8', 70),
      ex('legs', 'Romanian Deadlift', 3, '8-10', 65),
      ex('legs', 'Leg Press', 3, '10-12', 140),
      ex('abs', 'Hanging Knee Raises', 3, '10-15'),
      ex('abs', 'Weighted Cable Crunch', 3, '12-15', 45),
      ex('home abs', 'Plank Hold', 3, '45-60 sec'),
      ex('home abs', 'Dead Bug', 3, '10-12'),
    ],
    ...overrides,
  }
}

const dayKeys = (s: FixtureState) => [...new Set(s.catalog.map(e => e.day_type))].sort()

/** The USER_DATA JSON (lbs; the runner localizes it for kg like the route does). */
export function buildFixtureContext(s: FixtureState): Record<string, unknown> {
  const catalogDays = dayKeys(s).map(day_type => ({
    day_type,
    exercises: s.catalog
      .filter(e => e.day_type === day_type)
      .map(e => ({
        name: e.name,
        sets_target: e.sets_target,
        reps_target: e.reps_target,
        weight_target_lbs: e.weight_target_lbs,
        active: e.active,
      })),
  }))
  const enabled = dayKeys(s).filter(d => s.catalog.some(e => e.day_type === d && e.active))
  const bench = { name: 'Barbell Bench Press' }
  return {
    as_of_local_date: '2026-11-09',
    as_of_weekday: 'Monday',
    time_zone: 'America/Chicago',
    unit_preference: s.unit,
    weight_storage: 'lbs',
    profile: { display_name: 'Test Lifter', username: 'testlifter', joined_at: '2026-05-01' },
    stats: {
      xp_total: 5400,
      level: 5,
      current_streak: 1,
      longest_streak: 15,
      last_workout_date: '2026-11-08',
      total_workouts: 41,
    },
    program: {
      days: enabled,
      flex_days: ['abs', 'home abs'].filter(d => enabled.includes(d)),
      day_categories: { push: 'push', pull: 'pull', legs: 'legs', abs: 'other', 'home abs': 'other' },
      rotation_mode: 'manual',
      sequence: ['push', 'pull', 'legs'].filter(d => enabled.includes(d)),
      current_index: 1,
      next_day: 'legs',
      next_day_exercises: s.catalog
        .filter(e => e.day_type === 'legs' && e.active)
        .map(e => ({ name: e.name, sets_target: e.sets_target, reps_target: e.reps_target, weight_target_lbs: e.weight_target_lbs })),
    },
    rest: { weekly_days_of_week: [2], weekly_day_names: ['Tue'], recent_one_off_dates: [] },
    catalog: { inactive_count: s.catalog.filter(e => !e.active).length, days: catalogDays },
    exercise_performance: [
      { name: bench.name, max_weight_lbs: 95, max_volume_lbs: 760, last_weight_lbs: 95, weight_target_lbs: 95 },
      { name: 'Incline Dumbbell Press', max_weight_lbs: 25, max_volume_lbs: 600, last_weight_lbs: 25, weight_target_lbs: 25 },
      { name: 'Barbell Squat', max_weight_lbs: 70, max_volume_lbs: 560, last_weight_lbs: 70, weight_target_lbs: 70 },
      { name: 'Lat Pulldown', max_weight_lbs: 85, max_volume_lbs: 1020, last_weight_lbs: 85, weight_target_lbs: 80 },
      { name: 'Lateral Raise', max_weight_lbs: 12.5, max_volume_lbs: 450, last_weight_lbs: 12.5, weight_target_lbs: 10 },
    ],
    lifetime: {
      total_volume_lbs: 182000,
      max_set_weight_lbs: 140,
      max_set_reps: 20,
      unique_exercises: 18,
      total_prs: 55,
      total_sets: 520,
      days_active: 44,
      body_weight_log_count: 30,
      has_accepted_friend: true,
    },
    badges: { earned_count: 9, earned: [{ id: 'first-workout', name: 'First Rep' }, { id: 'streak-7', name: 'Week Warrior' }] },
    schedule: {
      last_trained_by_day: { push: '2026-11-04', pull: '2026-11-08', legs: '2026-11-02', abs: '2026-10-28', 'home abs': null },
    },
    body_weight: {
      summary: { latest_lbs: 181, delta_7d_lbs: -0.6, delta_30d_lbs: -1.8, min_90d_lbs: 179.4, max_90d_lbs: 184.2 },
      recent: [
        { date: '2026-11-08', weight_lbs: 181 },
        { date: '2026-11-05', weight_lbs: 181.6 },
        { date: '2026-11-01', weight_lbs: 182.4 },
      ],
    },
    rpe: { logged_sets: 12, average: 8.1 },
    active_session: s.openSession
      ? {
          day_type: s.openSession,
          started_at: '2026-11-09T15:00:00Z',
          logged_working_sets: s.workingSets,
          exercises: s.catalog
            .filter(e => e.day_type === s.openSession && e.active)
            .map(e => ({ name: e.name, working_sets: 0, last_weight_lbs: null, last_reps: null })),
        }
      : null,
    photos: { group_count: 0, latest_date: null, latest_day_type: null, latest_note: null },
    notifications: {
      enabled: true,
      rest_complete: true,
      rest_warning_10s: true,
      workout_status: true,
      streak_reminder: true,
      streak_reminder_hour: 19,
      timezone: 'America/Chicago',
    },
    training_history: {
      first_workout_date: '2026-05-03',
      weeks_training: 27,
      significant_breaks: [{ start: '2026-07-01', end: '2026-07-20', days: 19 }],
    },
    recent_sessions: [
      {
        day_type: 'pull',
        local_date: '2026-11-08',
        sets: [
          { exercise: 'Lat Pulldown', weight_lbs: 85, reps: 10 },
          { exercise: 'Lat Pulldown', weight_lbs: 85, reps: 10 },
        ],
      },
      {
        day_type: 'push',
        local_date: '2026-11-04',
        sets: [
          { exercise: 'Barbell Bench Press', set: 1, weight_lbs: 95, reps: 6 },
          { exercise: 'Barbell Bench Press', set: 2, weight_lbs: 95, reps: 8 },
          { exercise: 'Barbell Bench Press', set: 3, weight_lbs: 95, reps: 8 },
          { exercise: 'Barbell Bench Press', set: 4, weight_lbs: 95, reps: 8 },
          { exercise: 'Incline Dumbbell Press', weight_lbs: 25, reps: 10 },
        ],
      },
      {
        day_type: 'legs',
        local_date: '2026-11-02',
        sets: [
          { exercise: 'Barbell Squat', weight_lbs: 70, reps: 8 },
          { exercise: 'Barbell Squat', weight_lbs: 70, reps: 7 },
        ],
      },
    ],
    recent_prs: [
      { exercise: 'Lateral Raise', weight_lbs: 12.5, reps: 12, local_date: '2026-11-08', completed_at: '2026-11-08T20:00:00Z' },
      { exercise: 'Lat Pulldown', weight_lbs: 85, reps: 10, local_date: '2026-11-08', completed_at: '2026-11-08T20:00:00Z' },
    ],
    ...(s.body ? { body: s.body } : {}),
  }
}
