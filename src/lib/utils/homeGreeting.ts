/**
 * Home dashboard greeting. Short lines in the same pocket as
 * "Let's get after it, {firstName}." Situation beats time of day so the
 * line matches the moment (open session, rest, already trained, etc.).
 *
 * Hour buckets are the viewer's local clock — pass `date.getHours()`, never
 * UTC. Phrase choice is deterministic for a given local date + bucket so the
 * heading doesn't flicker across remounts.
 */

export interface HomeGreetingInput {
  /** Local hour, 0–23. */
  hour: number
  firstName: string
  trainedToday: boolean
  inProgress: boolean
  isRestDay: boolean
  /** Suggested next day key (`legs`, `push`, …). */
  nextDay: string
  /** Local YYYY-MM-DD — seeds rotation within a pool. */
  dateKey: string
}

const IN_PROGRESS = ["Unfinished business", "Let's finish this"] as const
const REST = ['Official rest day', 'Chill. You earned it'] as const
const TRAINED = ['Session in the books'] as const
const TRAINED_LATE = ["You're good. Sleep."] as const
const GRAVEYARD = ["3am club, let's go"] as const
const LATE_OPEN = ["Gym doesn't sleep", "Late, but we're here", "Night's not closed"] as const
const EVENING_OPEN = ['Evening session?'] as const
const LEGS = ["Fresh legs, let's go"] as const
const EARLY = ["World's still asleep"] as const
const MORNING = ['Rise and grind', 'Rise and shine', "Let's get after it"] as const
const AFTERNOON = [
  'Still plenty of day',
  "Let's get after it",
  'Plot twist: you lift',
  'The bar misses you',
  "Workout's waiting",
] as const

export type HomeHourBucket =
  | 'graveyard' // 00–04
  | 'early'     // 05–07
  | 'morning'   // 08–11
  | 'afternoon' // 12–16
  | 'evening'   // 17–20
  | 'late'      // 21–23

export function homeHourBucket(hour: number): HomeHourBucket {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  if (h < 5) return 'graveyard'
  if (h < 8) return 'early'
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  if (h < 21) return 'evening'
  return 'late'
}

function hashSeed(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0
  }
  return h
}

function pick<T extends string>(pool: readonly T[], seed: string): T {
  const i = Math.abs(hashSeed(seed)) % pool.length
  return pool[i] ?? pool[0]
}

function isLegsDay(nextDay: string): boolean {
  return nextDay.trim().toLowerCase() === 'legs'
}

/**
 * Attach `{firstName}` without turning "Evening session?" into
 * "Evening session?, Sam." or "You're good. Sleep." into a double period.
 */
export function formatHomeGreeting(phrase: string, firstName: string): string {
  const name = firstName.trim() || 'there'
  if (phrase.endsWith('?')) {
    return `${phrase.slice(0, -1)}, ${name}?`
  }
  if (phrase.endsWith('.')) {
    return `${phrase.slice(0, -1)}, ${name}.`
  }
  return `${phrase}, ${name}.`
}

export function pickHomeGreetingPhrase(input: HomeGreetingInput): string {
  const bucket = homeHourBucket(input.hour)
  const seed = `${input.dateKey}:${bucket}`

  // Situation first. Trained beats rest so a flex-day lift isn't greeted as
  // "Official rest day". Open session beats both — they left sets hanging.
  if (input.inProgress) return pick(IN_PROGRESS, `${input.dateKey}:progress`)
  if (input.trainedToday) {
    return bucket === 'late' || bucket === 'graveyard'
      ? pick(TRAINED_LATE, `${input.dateKey}:trained-late`)
      : pick(TRAINED, `${input.dateKey}:trained`)
  }
  if (input.isRestDay) return pick(REST, `${input.dateKey}:rest`)

  if (bucket === 'graveyard') return pick(GRAVEYARD, seed)
  if (bucket === 'late') return pick(LATE_OPEN, seed)
  if (bucket === 'evening') return pick(EVENING_OPEN, seed)
  if (isLegsDay(input.nextDay)) return pick(LEGS, seed)
  if (bucket === 'early') return pick(EARLY, seed)
  if (bucket === 'morning') return pick(MORNING, seed)
  return pick(AFTERNOON, seed)
}

export function homeGreeting(input: HomeGreetingInput): string {
  return formatHomeGreeting(pickHomeGreetingPhrase(input), input.firstName)
}
