import type { DayCategory } from '@/lib/types'

export type TemplateExercise = {
  name: string
  sets: number
  reps: string
  active?: boolean
}

export type WorkoutTemplate = {
  id: string
  label: string
  description: string
  /** Rotation order (may repeat). */
  sequence: string[]
  days: Record<string, { category: DayCategory; exercises: TemplateExercise[] }>
}

/** Blank-slate templates — editable afterward like any hand-built day. */
export const WORKOUT_TEMPLATES: WorkoutTemplate[] = [
  {
    id: 'ppl',
    label: 'USE PUSH / PULL / LEGS',
    description: 'A proven 3-day split, pre-loaded with exercises, sets & reps. Edit anything after.',
    sequence: ['push', 'pull', 'legs'],
    days: {
      push: {
        category: 'push',
        exercises: [
          { name: 'Barbell Bench Press', sets: 4, reps: '6-8' },
          { name: 'Incline Dumbbell Press', sets: 3, reps: '8-10' },
          { name: 'Overhead Press', sets: 3, reps: '8-10' },
          { name: 'Cable Lateral Raises', sets: 3, reps: '12-15' },
          { name: 'Tricep Rope Pushdown', sets: 3, reps: '12' },
        ],
      },
      pull: {
        category: 'pull',
        exercises: [
          { name: 'Chest-Supported Dumbbell Row', sets: 4, reps: '8-10' },
          { name: 'Pull-Ups', sets: 4, reps: '6-10', active: false },
          { name: 'Barbell or Cable Row', sets: 3, reps: '8-10' },
          { name: 'Lat Pulldown', sets: 3, reps: '10-12' },
          { name: 'Face Pulls', sets: 3, reps: '15' },
          { name: 'Dumbbell Curl', sets: 3, reps: '10-12' },
        ],
      },
      legs: {
        category: 'legs',
        exercises: [
          { name: 'Barbell Squat', sets: 4, reps: '6-8' },
          { name: 'Dumbbell RDL', sets: 3, reps: '8-10' },
          { name: 'Leg Press', sets: 3, reps: '10-12' },
          { name: 'Walking Lunges', sets: 3, reps: '10 each' },
          { name: 'Leg Curl', sets: 3, reps: '12' },
          { name: 'Calf Raises', sets: 4, reps: '15-20' },
        ],
      },
    },
  },
  {
    id: 'upper-lower',
    label: 'USE UPPER / LOWER',
    description: '4-day upper/lower split with a sensible rotation. Edit anything after.',
    sequence: ['upper_a', 'lower_a', 'upper_b', 'lower_b'],
    days: {
      upper_a: {
        category: 'push',
        exercises: [
          { name: 'Barbell Bench Press', sets: 4, reps: '5-8' },
          { name: 'Overhead Press', sets: 3, reps: '6-10' },
          { name: 'Chest-Supported Row', sets: 4, reps: '8-10' },
          { name: 'Lat Pulldown', sets: 3, reps: '10-12' },
          { name: 'Lateral Raises', sets: 3, reps: '12-15' },
          { name: 'Tricep Pushdown', sets: 3, reps: '10-12' },
        ],
      },
      lower_a: {
        category: 'legs',
        exercises: [
          { name: 'Barbell Squat', sets: 4, reps: '5-8' },
          { name: 'Romanian Deadlift', sets: 3, reps: '6-10' },
          { name: 'Leg Press', sets: 3, reps: '10-12' },
          { name: 'Leg Curl', sets: 3, reps: '10-12' },
          { name: 'Calf Raises', sets: 4, reps: '12-15' },
        ],
      },
      upper_b: {
        category: 'pull',
        exercises: [
          { name: 'Incline Dumbbell Press', sets: 4, reps: '8-10' },
          { name: 'Pull-Ups or Lat Pulldown', sets: 4, reps: '6-10' },
          { name: 'Seated Cable Row', sets: 3, reps: '8-12' },
          { name: 'Dumbbell Shoulder Press', sets: 3, reps: '8-12' },
          { name: 'Face Pulls', sets: 3, reps: '12-15' },
          { name: 'Dumbbell Curl', sets: 3, reps: '10-12' },
        ],
      },
      lower_b: {
        category: 'legs',
        exercises: [
          { name: 'Deadlift or Trap Bar Deadlift', sets: 3, reps: '3-5' },
          { name: 'Front Squat or Goblet Squat', sets: 3, reps: '8-10' },
          { name: 'Walking Lunges', sets: 3, reps: '10 each' },
          { name: 'Leg Extension', sets: 3, reps: '12-15' },
          { name: 'Calf Raises', sets: 4, reps: '12-15' },
        ],
      },
    },
  },
  {
    id: 'full-body',
    label: 'USE FULL BODY',
    description: '3 full-body days with overlapping compounds — good when you train ~3×/week.',
    sequence: ['full_a', 'full_b', 'full_c'],
    days: {
      full_a: {
        category: 'other',
        exercises: [
          { name: 'Barbell Squat', sets: 3, reps: '5-8' },
          { name: 'Barbell Bench Press', sets: 3, reps: '5-8' },
          { name: 'Barbell Row', sets: 3, reps: '6-10' },
          { name: 'Romanian Deadlift', sets: 3, reps: '8-10' },
          { name: 'Plank', sets: 3, reps: '30-60s' },
        ],
      },
      full_b: {
        category: 'other',
        exercises: [
          { name: 'Deadlift', sets: 3, reps: '3-5' },
          { name: 'Overhead Press', sets: 3, reps: '5-8' },
          { name: 'Pull-Ups or Lat Pulldown', sets: 3, reps: '6-10' },
          { name: 'Lunges', sets: 3, reps: '8 each' },
          { name: 'Face Pulls', sets: 3, reps: '12-15' },
        ],
      },
      full_c: {
        category: 'other',
        exercises: [
          { name: 'Front Squat or Goblet Squat', sets: 3, reps: '6-10' },
          { name: 'Incline Dumbbell Press', sets: 3, reps: '8-10' },
          { name: 'Chest-Supported Row', sets: 3, reps: '8-10' },
          { name: 'Hip Thrust or RDL', sets: 3, reps: '8-12' },
          { name: 'Farmer Carry or Curl', sets: 3, reps: '10-12' },
        ],
      },
    },
  },
]

export function getWorkoutTemplate(id: string): WorkoutTemplate | undefined {
  return WORKOUT_TEMPLATES.find(t => t.id === id)
}
