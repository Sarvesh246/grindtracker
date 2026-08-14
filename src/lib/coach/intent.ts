/**
 * Cheap, deterministic Coach intent inference.
 *
 * Used to adapt maxOutputTokens + a one-line post-USER_DATA reminder so
 * different asks physically get different depth budgets — without telling
 * the model a full per-question format recipe.
 *
 * Pure heuristics only (no LLM round-trip). Prefer recall of safety/workout
 * over false "definition" when signals conflict.
 */

export type CoachIntent =
  | 'safety'
  | 'actionable'
  | 'workout'
  | 'program'
  | 'technique'
  | 'troubleshooting'
  | 'analysis'
  | 'recommendation'
  | 'comparison'
  | 'definition'
  | 'short_contextual'
  | 'general'

export interface CoachIntentProfile {
  intent: CoachIntent
  /** Hard generation budget — forces shorter replies for simple asks. */
  maxOutputTokens: number
  /**
   * One-line reminder after USER_DATA. Calibrates depth/personalization for
   * THIS ask without prescribing section templates.
   */
  reminder: string
  /** Whether personal USER_DATA is expected to matter for this ask. */
  personalization: 'required' | 'useful' | 'unnecessary' | 'context'
}

const SAFETY_RE =
  /\b(pain|hurt|hurts|injured|injury|dizzy|dizziness|nause|swelling|numb|tingl|sharp pain|push through|train through|doctor|ER|emergency|bleeding|chest pain|passed out|faint)\b/i

const WORKOUT_RE =
  /\b((give|build|make) me\b[\s\S]{0,48}\b(workout|session|routine)\b|workout for\b|leg day\b|push day\b|pull day\b|chest day\b|what should i do for (chest|legs|back|shoulders|arms|pull|push)\b|45[- ]?minute|dumbbells? only|gym is crowded)\b/i

const PROGRAM_RE =
  /\b(program|ppl|push\/pull\/legs|4[- ]day|5[- ]day|split|organize my week|how (should|do) i progress (this|the) program|weekly plan|periodiz)\b/i

const TECHNIQUE_RE =
  /\b(how (do|should) i (do|perform|set up|execute)|form|technique|cue|cues|common mistakes?|rdl|how to (squat|bench|deadlift|row|press))\b/i

const TROUBLE_RE =
  /\b(why (am|is|are|does|do|can'|don'|didn'|can’t|don’t|didn’t)|not feeling|feel(s|ing)? (weaker|awkward|off)|stuck|plateau|can'?t (feel|hit|complete))\b/i

const ANALYSIS_RE =
  /\b(analy[sz]e|progress|getting stronger|what stands out|what changed|biggest weakness|holding me back|three biggest|last (month|3 months|week)|improving|explain everything|how has my training)\b/i

const RECOMMENDATION_RE =
  /\b(what weight|should i (increase|add|train|rest|skip|go heavier|deload|start)|which exercise|what should i (do|use|change)|increase\?|worth it\?|enough\?|go heavier|add another set)\b/i

const COMPARISON_RE =
  /\b(\bvs\.?\b|versus|compare|comparison|or better|which is better|difference between)\b/i

const DEFINITION_RE =
  /\b(what (is|are|does)|what'?s|define|definition|mean\?|means\?|explain (what|rir|rpe|hypertrophy|deload|progressive overload)|muscles? does .+ work|is soreness required|how long should i rest)\b/i

const SHORT_CONTEXT_RE =
  /^(bench|squat|deadlift|ohp|row|pull|push|legs?|today|progress|increase|why|next|worth it|same|more|enough|rest|deload|skip)\??$/i

/** Imperative mutation asks — not “should I / can I” advice. */
const ACTIONABLE_RE =
  /\b(change|correct|fix|update|edit|set|make)\b.{0,40}\b(weight|lbs?|kg|bench|squat|deadlift|press)\b|\b(was|should (have )?been|meant|actually)\b.{0,30}\b(lb|kg|weight)\b|\bstart (my |today'?s )?workout\b|\b(begin|open)\b.{0,20}\b(today|workout|session)\b|\btrain (now|today)\b|\bstart\s+(?!with\b|from\b|by\b)(my |today'?s )?(workout|session|push|pull|legs|[a-z][\w\- ]{0,24})\b|\bcreate\b.{0,40}\bday\b|\bsave (this|that) (as |to )?(a )?day\b|\badd (this|that) (day|workout) to (my )?(program|catalog|rotation)\b|\b(log|record|save)\b.{0,24}\b(body[- ]?weight|weigh[- ]?in)\b|\b(log|record)\b.{0,16}\b(my )?weight\b|\bi weigh\b|\b(delete|remove|clear)\b.{0,30}\b(body[- ]?weight|weigh[- ]?in)\b|\b(finish|complete|end)\b.{0,20}\b(workout|session)\b|\b(i'?m |im )?done (training|working out|with (this|today'?s) (workout|session))\b|\b(undo|unfinish|reopen)\b.{0,24}\b(finish|workout|session)\b|\bi (wasn'?t|am not) done\b|\b(un)?skip\b.{0,40}\b(sets?|exercises?|bench|squats?|deadlifts?|press(?:es)?|this|the rest)\b|\brest today\b|\btaking today off\b|\bmark(ing)? today as rest\b|\bundo rest today\b|\balways rest\b|\brest every\b|\b(add|remove|enable|disable)\b.{0,24}\brest (day|on)\b|\bset .{0,20}rest day\b|\b(change|update|edit|set|bump)\b.{0,40}\b(sets|reps|target)\b|\bbump\b.{0,24}\b(up|down|bench|squat|deadlift|press)\b|\b(hide|disable|enable|reactivate)\b.{0,24}\b(exercise|from (the )?log)\b|\b(reorder|rearrange)\b.{0,24}\b(days|rotation|order)\b|\b(change|update)\b.{0,24}\b(workout order|rotation|day order)\b|\bactually (did|got|hit)\b.{0,24}\b(reps?|rpe)\b|\bit was actually\b|\bset was wrong\b|\bactually \d+ not \d+\b|\b(wrong (reps?|rpe|note)|fix (the |that |this )?set|edit (that |this |the )?set)\b|\bset \d+\b.{0,24}\b(was|should (have )?been)\b|\b(turn (off|on)|disable|enable|mute)\b.{0,30}\bnotif|\bstreak reminder\b.{0,24}\b(hour|time|off|on|to)\b/i

const ADVISORY_PREFIX_RE =
  /^(should i|can i|could i|would you|do you think|is it (ok|okay|fine)|what if)\b/i

/** Soft token ceilings by intent — simple asks cannot sprawl. */
const TOKEN_BUDGET: Record<CoachIntent, number> = {
  safety: 450,
  definition: 280,
  short_contextual: 320,
  recommendation: 420,
  comparison: 520,
  technique: 700,
  troubleshooting: 750,
  analysis: 1000,
  actionable: 1100,
  workout: 1100,
  program: 1200,
  general: 700,
}

const REMINDER: Record<CoachIntent, string> = {
  safety:
    'Intent: safety. Lead with safety action. Do not diagnose or push through significant symptoms. Keep it direct.',
  definition:
    'Intent: definition/education. Answer in a few sentences. No personal history, no coaching prescription, no section template.',
  short_contextual:
    'Intent: short contextual follow-up. Use prior turns + relevant USER_DATA. Stay brief — do not restart with a primer.',
  recommendation:
    'Intent: recommendation. Lead with ONE clear decision, then a brief why and fallback if useful. No option menus when evidence supports a pick.',
  comparison:
    'Intent: comparison. Lead with the takeaway; use a compact side-by-side or table only if it helps scanability.',
  technique:
    'Intent: technique. Use sequential steps (setup → execution → cues → common mistake). Skip personal history unless asked.',
  troubleshooting:
    'Intent: troubleshooting. Hedge causes (likely/suggests). Prioritize likely explanations, how to test, what to try — do not assert unproven causation.',
  analysis:
    'Intent: progress/coaching analysis. Lead with takeaway, then relevant evidence, hedged interpretation, and action. Prioritize — do not dump every metric.',
  actionable:
    'Intent: actionable mutation. Call the matching propose_* tool so the user gets a Confirm/Cancel card. Never claim the change is applied until they confirm.',
  workout:
    'Intent: workout request. Lead with an executable workout using bold exercise stacks (sets×reps, Target, Rest). No essay intro. If they ask to save it as a day, call propose_create_day only — do not also propose_start_workout unless they explicitly ask to start it.',
  program:
    'Intent: program design. Give a structured plan with explicit assumptions. More detail than a simple Q is OK here.',
  general:
    'Intent: general. Choose depth and format from THIS ask only — minimum structure, personalize only if Required or Useful.',
}

function personalizationFor(intent: CoachIntent): CoachIntentProfile['personalization'] {
  switch (intent) {
    case 'definition':
    case 'technique':
    case 'safety':
      return 'unnecessary'
    case 'analysis':
    case 'recommendation':
    case 'short_contextual':
    case 'actionable':
      return 'required'
    case 'workout':
    case 'program':
    case 'troubleshooting':
    case 'comparison':
      return 'useful'
    default:
      return 'context'
  }
}

/**
 * Infer Coach intent from the latest user message (and optional prior user turn).
 */
export function inferCoachIntent(
  message: string,
  priorUserMessage?: string | null,
): CoachIntentProfile {
  const text = message.trim()
  const prior = priorUserMessage?.trim() || ''

  // Ultra-short follow-ups inherit conversational mode even before regex.
  if (text.length <= 24 && SHORT_CONTEXT_RE.test(text)) {
    return profile('short_contextual')
  }
  // Bare "why?" after a prior turn is almost always a follow-up.
  if (/^why\??$/i.test(text) && prior) {
    return profile('short_contextual')
  }

  if (SAFETY_RE.test(text)) return profile('safety')
  if (ACTIONABLE_RE.test(text) && !ADVISORY_PREFIX_RE.test(text)) {
    return profile('actionable')
  }
  if (WORKOUT_RE.test(text)) return profile('workout')
  if (PROGRAM_RE.test(text)) return profile('program')
  if (TECHNIQUE_RE.test(text)) return profile('technique')
  if (COMPARISON_RE.test(text)) return profile('comparison')
  // Ranked coaching asks before generic "why" troubleshooting.
  if (ANALYSIS_RE.test(text)) return profile('analysis')
  // Definition before trouble so "What is a plateau?" stays educational.
  if (DEFINITION_RE.test(text) && !TROUBLE_RE.test(text)) {
    return profile('definition')
  }
  if (TROUBLE_RE.test(text)) return profile('troubleshooting')
  if (RECOMMENDATION_RE.test(text)) return profile('recommendation')
  if (DEFINITION_RE.test(text)) return profile('definition')

  // Very short residual prompts → contextual
  if (text.split(/\s+/).length <= 3 && text.length <= 40) {
    return profile('short_contextual')
  }

  return profile('general')
}

function profile(intent: CoachIntent): CoachIntentProfile {
  return {
    intent,
    maxOutputTokens: TOKEN_BUDGET[intent],
    reminder: REMINDER[intent],
    personalization: personalizationFor(intent),
  }
}

/** Shared closing line appended after the intent reminder. */
export const COACH_TURN_CLOSING =
  'Answer fully in this one turn — do not ask them to message again. Verify units/numbers; no internal jargon.'

/**
 * Build the post-USER_DATA reminder for this turn.
 */
export function buildCoachTurnReminder(profile: CoachIntentProfile): string {
  return `${profile.reminder} Personalization for this ask: ${profile.personalization}. ${COACH_TURN_CLOSING}`
}
