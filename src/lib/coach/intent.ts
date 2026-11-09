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
  | 'plan_install'
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
  /**
   * Model thinking. Minimal ('none') is fast and fine for chat and for
   * straightforward tool calls; advice that must stay self-consistent
   * (recommendations, comparisons, analysis) gets a little reasoning so it
   * doesn't open with one answer and end with the opposite.
   */
  thinking: 'none' | 'low'
  /**
   * 'none' = pure Q&A intents that can never be a change request, so the
   * action tools aren't offered at all. Everything else keeps every tool —
   * the router is regex, so a wrongly removed tool would silently drop an action.
   */
  toolPolicy: 'all' | 'none'
  /** Whether the GRIND rules (streak/rest/PR/XP maths) belong in the prompt. */
  mechanics: boolean
  /** Several separate questions in one message — each gets its own bullet. */
  multiAsk: boolean
}

/** "three quick things", or two+ question marks. */
const MULTI_ASK_RE = /\b(two|three|four|2|3|4)\b[^.?!]{0,15}\b(things|questions)\b/i
function isMultiAsk(text: string): boolean {
  return (text.match(/\?/g) ?? []).length >= 2 || MULTI_ASK_RE.test(text)
}

// Symptom words. Deliberately NOT "doctor"/"ER" (a long message that merely
// mentions "my doctor said lift more" is not a symptom report) and not "sore"
// (ordinary DOMS), which would route every "should I train today?" to safety.
const SAFETY_RE =
  /\b(pain|painful|hurt|hurts|injured|injury|dizzy|dizziness|nausea|nauseous|swelling|swollen|numb|numbness|tingling|push through|train through|emergency|bleeding|chest pain|passed out|faint|fainted|fainting|sprain|sprained|torn|tore)\b/i

/**
 * "my knees feel weird", "shoulder clicking" — mild, but still a body signal.
 * Exact word forms only: "back off", "numbers" and "popular" must not match.
 */
const BODY_SYMPTOM_RE =
  /\b(knee|knees|shoulder|shoulders|back|elbow|elbows|wrist|wrists|hip|hips|neck|ankle|ankles|joint|joints)\b[^.?!]{0,40}\b(weird|funny|strange|clicks?|clicking|pops?|popping|popped|tweaked|tweaking|twinges?|aches?|aching|feels? off)\b/i

/** First-person symptom report — the only way a LONG message counts as safety. */
const FIRST_PERSON_SYMPTOM_RE =
  /\b(my|i)\b[^.?!]{0,40}\b(hurts?|pain|painful|dizzy|numb|tingling|swollen|injured|sharp|sprained)\b/i

const WORKOUT_RE =
  /\b((give|build|make) me\b[\s\S]{0,48}\b(workout|session|routine)\b|workout for\b|leg day\b|push day\b|pull day\b|chest day\b|what should i do for (chest|legs|back|shoulders|arms|pull|push)\b|45[- ]?minute|dumbbells? only|gym is crowded)\b/i

const PROGRAM_RE =
  /\b(program|ppl|push\/pull\/legs|4[- ]day|5[- ]day|split|organize my week|how (should|do) i progress (this|the) program|weekly plan|periodiz)\b/i

const TECHNIQUE_RE =
  /\b(how (do|should) i (do|perform|set up|execute)|form|technique|cue|cues|common mistakes?|how to (squat|bench|deadlift|row|press))\b/i

const TROUBLE_RE =
  /\b(why (am|is|are|does|do|can'|don'|didn'|won'?t|can’t|don’t|didn’t|won’t)|not feeling|feel(s|ing)? (weaker|awkward|off)|stuck|plateau|can'?t (feel|hit|complete))\b/i

/** A question about THEIR data ("what's my streak?") is never a pure definition. */
const OWN_DATA_RE = /\b(my|mine)\b|\b(am|did|do|have|was) i\b/i

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

/** A pasted training week: replace/install phrasing, or a long message naming most weekdays. */
const PLAN_INSTALL_VERBS_RE =
  /\b(replace|swap|overwrite|switch|set up|install|apply|use)\b[\s\S]{0,60}\b(workout|training|gym)\b[\s\S]{0,24}\b(days?|plan|week|split|schedule|routine)\b/i
const WEEKDAY_RE =
  /\b(mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b/gi
function looksLikeWeeklyPlan(text: string): boolean {
  if (PLAN_INSTALL_VERBS_RE.test(text) && text.length > 200) return true
  if (text.length < 500) return false
  const days = new Set(
    (text.match(WEEKDAY_RE) ?? []).map(d => d.slice(0, 3).toLowerCase()),
  )
  return days.size >= 4
}

/** Imperative mutation asks — not “should I / can I” advice. */
const ACTIONABLE_RE =
  /\b(change|correct|fix|update|edit|set|make)\b.{0,40}\b(weight|lbs?|kg|bench|squat|deadlift|press)\b|\b(was|should (have )?been|meant|actually)\b.{0,30}\b(lb|kg|weight)\b|\bstart (my |today'?s )?workout\b|\b(begin|open)\b.{0,20}\b(today|workout|session)\b|\btrain (now|today)\b|\bstart\s+(?!with\b|from\b|by\b)(my |today'?s )?(workout|session|push|pull|legs|[a-z][\w\- ]{0,24})\b|\bcreate\b.{0,40}\bday\b|\bsave (this|that) (as |to )?(a )?day\b|\badd (this|that) (day|workout) to (my )?(program|catalog|rotation)\b|\b(log|record|save)\b.{0,24}\b(body[- ]?weight|weigh[- ]?in)\b|\b(log|record)\b.{0,16}\b(my )?weight\b|\bi weigh\b|\b(delete|remove|clear)\b.{0,30}\b(body[- ]?weight|weigh[- ]?in)\b|\b(finish|complete|end)\b.{0,20}\b(workout|session)\b|\b(i'?m |im )?done (training|working out|with (this|today'?s) (workout|session))\b|\b(undo|unfinish|reopen)\b.{0,24}\b(finish|workout|session)\b|\bi (wasn'?t|am not) done\b|\b(un)?skip\b.{0,40}\b(sets?|exercises?|bench|squats?|deadlifts?|press(?:es)?|this|the rest)\b|\brest today\b|\btaking today off\b|\bmark(ing)? today as rest\b|\bundo rest today\b|\balways rest\b|\brest every\b|\b(add|remove|enable|disable)\b.{0,24}\brest (day|on)\b|\bset .{0,20}rest day\b|\b(change|update|edit|set|bump)\b.{0,40}\b(sets|reps|target)\b|\bbump\b.{0,24}\b(up|down|bench|squat|deadlift|press)\b|\b(hide|disable|enable|reactivate)\b.{0,24}\b(exercise|from (the )?log)\b|\b(reorder|rearrange)\b.{0,24}\b(days|rotation|order)\b|\b(change|update)\b.{0,24}\b(workout order|rotation|day order)\b|\bactually (did|got|hit)\b.{0,24}\b(reps?|rpe)\b|\bit was actually\b|\bset was wrong\b|\bactually \d+ not \d+\b|\b(wrong (reps?|rpe|note)|fix (the |that |this )?set|edit (that |this |the )?set)\b|\bset \d+\b.{0,24}\b(was|should (have )?been)\b|\b(turn (off|on)|disable|enable|mute)\b.{0,30}\bnotif|\bstreak reminder\b.{0,24}\b(hour|time|off|on|to)\b/i

const ADVISORY_PREFIX_RE =
  /^(should i|can i|could i|would you|do you think|is it (ok|okay|fine)|what if)\b/i

/**
 * Token ceilings by intent. These are a SAFETY NET, not the brevity control:
 * length is shaped by the intent reminder ("2–3 sentences", "under ~90 words")
 * and a reply that hits the ceiling is trimmed to a whole sentence, so the cap
 * sits well above what a good answer needs. Intents that think get headroom on
 * top (THINKING_HEADROOM) because reasoning tokens count against the same limit.
 */
const TOKEN_BUDGET: Record<CoachIntent, number> = {
  safety: 600,
  definition: 450,
  short_contextual: 500,
  recommendation: 650,
  comparison: 800,
  technique: 900,
  troubleshooting: 1000,
  analysis: 1300,
  actionable: 1400,
  // The tool call itself carries a whole week of exercises (~3–5k tokens).
  plan_install: 8000,
  workout: 1400,
  program: 1500,
  general: 1000,
}

const THINKING: Record<CoachIntent, 'none' | 'low'> = {
  safety: 'none',
  definition: 'none',
  short_contextual: 'none',
  recommendation: 'low',
  comparison: 'low',
  technique: 'none',
  troubleshooting: 'low',
  analysis: 'low',
  actionable: 'none',
  plan_install: 'none',
  workout: 'none',
  program: 'low',
  general: 'none',
}

const THINKING_HEADROOM = 1500

/** Pure Q&A intents: no change request can hide in them, so no tools. */
const NO_TOOL_INTENTS: ReadonlySet<CoachIntent> = new Set([
  'definition',
  'technique',
  'comparison',
])

/** Intents whose answers lean on the streak/rest/PR/XP rules. */
const MECHANICS_INTENTS: ReadonlySet<CoachIntent> = new Set([
  'recommendation',
  'short_contextual',
  'troubleshooting',
  'analysis',
  'general',
])

const CHANGE_RULES =
  'Call the matching propose_* tool for EACH change they asked for, all in this one reply (independent calls together). Use only values the user stated or that USER_DATA states unambiguously — never reuse numbers from tool descriptions or examples. If a needed value is missing or the request is vague ("fix my numbers"), ask ONE short question instead of calling a tool. If no tool covers the request, say so plainly and point to where in the app to do it — never substitute a different tool. Describe exactly what the card shows. Never claim it is applied before Confirm.'

const REMINDER: Record<CoachIntent, string> = {
  safety:
    'Intent: safety. First sentence = the safety action (stop or modify; do not push through). Then one practical next step and when to get it checked. No diagnosis. Under ~90 words.',
  definition:
    'Intent: definition. Answer in 2–3 sentences of plain prose — no headings, bullets, bold labels, extra examples or personal data unless they ask. Under ~60 words.',
  short_contextual:
    'Intent: short follow-up. Give a decision or one-line answer plus at most one reason, using prior turns and USER_DATA. Do NOT output a workout, plan or list unless they asked for one. Under ~70 words.',
  recommendation:
    'Intent: recommendation. First sentence = the decision ("Use 95 lb today", "Train legs"). Then one reason from their data and, only if useful, one fallback. Commit — no closing hedge that reverses it. No workout unless asked. Under ~90 words.',
  comparison:
    'Intent: comparison. Lead with the takeaway and make your final recommendation agree with it. Compare like for like (a barbell total is not a per-hand dumbbell number). A compact table only if it helps scanning.',
  technique:
    'Intent: technique. Use numbered steps (setup → execution → cues → common mistake). Skip personal history unless asked.',
  troubleshooting:
    'Intent: troubleshooting. Hedge causes (likely/suggests). Prioritize likely explanations, how to test, what to try — do not assert unproven causation. Conversational; headings only for 3+ causes.',
  analysis:
    'Intent: progress/coaching analysis. Lead with the takeaway, then 2–3 relevant facts, a hedged interpretation and one action. PR counts are volume records, not proof of strength. Prioritize — do not dump every metric.',
  actionable: `Intent: change request. ${CHANGE_RULES}`,
  plan_install:
    'Intent: install a whole training week. Call propose_apply_weekly_plan ONCE with every training day (weekday, exercises, sets, reps, rest_seconds), the rest weekdays, and keepDays ONLY for days the user explicitly said to leave alone (exact names from USER_DATA) — flex or abs days are not exempt unless they named them, so otherwise leave keepDays empty. Do not re-list the plan in prose — the Confirm card shows it. Reply with one or two lines at most. Never claim it is applied before Confirm.',
  workout:
    'Intent: workout request. Lead with an executable workout using bold exercise stacks (sets×reps, Target, Rest). No essay intro. If they ask to save it as a day, resolve flex vs which program day from context or ask; unspecified → flex. Call propose_create_day only — do not also propose_start_workout unless they ask to train now. Never mention auto-start.',
  program:
    'Intent: program design. Give a structured plan with explicit assumptions. More detail than a simple Q is OK here.',
  general: `Intent: general. Choose depth and format from THIS ask only — minimum structure, personalize only if Required or Useful. If part of it is a change request: ${CHANGE_RULES}`,
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
    case 'plan_install':
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
    return profile('short_contextual', text)
  }
  // Bare "why?" after a prior turn is almost always a follow-up.
  if (/^why\??$/i.test(text) && prior) {
    return profile('short_contextual', text)
  }

  if (looksLikeWeeklyPlan(text)) return profile('plan_install', text)
  // A long message that only brushes a safety word is not a symptom report.
  const symptom = SAFETY_RE.test(text) || BODY_SYMPTOM_RE.test(text)
  if (symptom && (text.length <= 400 || FIRST_PERSON_SYMPTOM_RE.test(text))) {
    return profile('safety', text)
  }
  if (ACTIONABLE_RE.test(text) && !ADVISORY_PREFIX_RE.test(text)) {
    return profile('actionable', text)
  }
  if (WORKOUT_RE.test(text)) return profile('workout', text)
  if (PROGRAM_RE.test(text)) return profile('program', text)
  // "…the form feels fine. Why won't it move?" is troubleshooting, not technique,
  // even though it mentions form.
  if (/\bwhy\b/i.test(text) && TROUBLE_RE.test(text) && !DEFINITION_RE.test(text)) {
    return profile('troubleshooting', text)
  }
  if (TECHNIQUE_RE.test(text)) return profile('technique', text)
  if (COMPARISON_RE.test(text)) return profile('comparison', text)
  // Ranked coaching asks before generic "why" troubleshooting.
  if (ANALYSIS_RE.test(text)) return profile('analysis', text)
  // Definition before trouble so "What is a plateau?" stays educational.
  if (DEFINITION_RE.test(text) && !TROUBLE_RE.test(text) && !OWN_DATA_RE.test(text)) {
    return profile('definition', text)
  }
  if (TROUBLE_RE.test(text)) return profile('troubleshooting', text)
  if (RECOMMENDATION_RE.test(text)) return profile('recommendation', text)
  if (DEFINITION_RE.test(text) && !OWN_DATA_RE.test(text)) return profile('definition', text)

  // Very short residual prompts → contextual
  if (text.split(/\s+/).length <= 3 && text.length <= 40) {
    return profile('short_contextual', text)
  }

  return profile('general', text)
}

function profile(intent: CoachIntent, text = ''): CoachIntentProfile {
  const thinking = THINKING[intent]
  return {
    multiAsk: isMultiAsk(text),
    intent,
    maxOutputTokens:
      TOKEN_BUDGET[intent] + (thinking === 'low' ? THINKING_HEADROOM : 0),
    reminder: REMINDER[intent],
    personalization: personalizationFor(intent),
    thinking,
    toolPolicy: NO_TOOL_INTENTS.has(intent) ? 'none' : 'all',
    mechanics: MECHANICS_INTENTS.has(intent),
  }
}

/** Shared closing line appended after the intent reminder. */
export const COACH_TURN_CLOSING =
  'Answer in this one turn — ask a question only when a required value is missing. Weights in the unit USER_DATA uses; verify numbers; no internal jargon.'

/**
 * Build the post-USER_DATA reminder for this turn.
 */
export function buildCoachTurnReminder(profile: CoachIntentProfile): string {
  const multi = profile.multiAsk
    ? ' They asked several things: answer each in its own bullet, in the order asked.'
    : ''
  return `${profile.reminder}${multi} Personalization for this ask: ${profile.personalization}. ${COACH_TURN_CLOSING}`
}
