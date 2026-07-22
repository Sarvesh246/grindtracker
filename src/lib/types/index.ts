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
  note: string | null
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

export interface UserProfile {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  created_at: string
}

export interface Friendship {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted'
  created_at: string
}

export interface LeaderboardEntry {
  user_id: string
  username: string
  display_name: string
  avatar_url: string | null
  xp_total: number
  level: number
  current_streak: number
  total_workouts: number
  best_lift: number
}

export type DayCategory = 'push' | 'pull' | 'legs' | 'other'

export interface UserDayCategory {
  user_id: string
  day_key: string
  category: DayCategory
  created_at: string
}

export type FeedbackCategory = 'bug' | 'feature' | 'improvement' | 'other'

export interface Feedback {
  id: string
  user_id: string
  /** Identity snapshot taken at submit time — survives username changes. */
  username: string | null
  email: string | null
  category: FeedbackCategory
  message: string
  /** Object paths in the private `feedback-images` bucket, not URLs. */
  image_paths: string[]
  is_anonymous: boolean
  is_read: boolean
  is_starred: boolean
  created_at: string
}

export interface UserRotation {
  user_id: string
  mode: 'auto' | 'manual'
  sequence: string[]
  current_index: number
  updated_at: string
}
