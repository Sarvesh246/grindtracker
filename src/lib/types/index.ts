export interface Exercise {
  id: string
  name: string
  day_type: string
  sets_target: number
  reps_target: string
  sort_order: number
  created_at: string
}

export interface Session {
  id: string
  user_id: string
  day_type: string
  started_at: string
  completed_at: string | null
  xp_earned: number
  created_at: string
}

export interface SessionLog {
  id: string
  session_id: string
  exercise_id: string
  set_number: number
  weight: number | null
  reps: number | null
  is_pr: boolean
  created_at: string
}

export interface UserStats {
  id: string
  user_id: string
  xp_total: number
  level: number
  current_streak: number
  longest_streak: number
  last_workout_date: string | null
  total_workouts: number
  created_at: string
  updated_at: string
}

export interface UserBadge {
  id: string
  user_id: string
  badge_id: string
  earned_at: string
}
