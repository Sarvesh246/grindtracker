/**
 * Internal Coach stress-test catalog.
 *
 * Documents expected personalization + format per intent class.
 * Used to lock system-prompt contracts (see `__tests__/prompt.test.ts`)
 * and as a checklist for live Gemini evaluation when a key is available.
 *
 * Do not treat this as a reply template — it classifies asks so the model
 * can choose the right depth/format dynamically.
 */

export type PersonalizationNeed = 'required' | 'useful' | 'unnecessary'

export type PreferredFormat =
  | 'short_prose'
  | 'decision_first'
  | 'exercise_stacks'
  | 'numbered_steps'
  | 'troubleshoot_flow'
  | 'analysis'
  | 'comparison'
  | 'weekly_plan'
  | 'contextual_brief'
  | 'safety_first'

export interface CoachStressCase {
  id: string
  category: string
  prompt: string
  personalization: PersonalizationNeed
  format: PreferredFormat
  /** What a good reply must do (root-cause checks, not wording). */
  must: string[]
  /** Failure modes to avoid. */
  mustNot: string[]
}

export const COACH_STRESS_CATALOG: CoachStressCase[] = [
  // Category 1 — simple factual
  {
    id: 'fact-rir',
    category: 'simple_factual',
    prompt: 'What does RIR mean?',
    personalization: 'unnecessary',
    format: 'short_prose',
    must: ['definition first', '1–3 sentences'],
    mustNot: ['personal logging gaps', 'forced Application/Why sections'],
  },
  {
    id: 'fact-hypertrophy',
    category: 'simple_factual',
    prompt: 'What is hypertrophy?',
    personalization: 'unnecessary',
    format: 'short_prose',
    must: ['definition first'],
    mustNot: ['programming advice', 'lifetime volume'],
  },
  {
    id: 'fact-bench-muscles',
    category: 'simple_factual',
    prompt: 'What muscles does bench press work?',
    personalization: 'unnecessary',
    format: 'short_prose',
    must: ['primary + secondary muscles'],
    mustNot: ['user PR history'],
  },

  // Category 2 — direct recommendations
  {
    id: 'rec-weight-today',
    category: 'direct_recommendation',
    prompt: 'What weight should I use today?',
    personalization: 'required',
    format: 'decision_first',
    must: ['one clear weight', 'brief reason', 'optional fallback'],
    mustNot: ['A/B/C option menu without a pick'],
  },
  {
    id: 'rec-increase',
    category: 'direct_recommendation',
    prompt: 'Should I increase the weight?',
    personalization: 'required',
    format: 'decision_first',
    must: ['yes/no or clear decision', 'evidence-based'],
    mustNot: ['causal overconfidence'],
  },
  {
    id: 'rec-train-today',
    category: 'direct_recommendation',
    prompt: 'Should I train today?',
    personalization: 'useful',
    format: 'decision_first',
    must: ['clear recommendation'],
    mustNot: ['dump all schedule fields'],
  },

  // Category 3 — workout generation
  {
    id: 'workout-legs',
    category: 'workout_generation',
    prompt: 'Give me a leg workout.',
    personalization: 'useful',
    format: 'exercise_stacks',
    must: ['bold exercise names', 'sets×reps', 'target', 'rest'],
    mustNot: ['essay intro', 'unit corruption'],
  },
  {
    id: 'workout-45min',
    category: 'workout_generation',
    prompt: 'Make me a 45-minute workout.',
    personalization: 'useful',
    format: 'exercise_stacks',
    must: ['time-aware volume', 'executable stacks'],
    mustNot: ['unrelated lifetime stats'],
  },
  {
    id: 'workout-dumbbells',
    category: 'workout_generation',
    prompt: 'Give me a workout using only dumbbells.',
    personalization: 'useful',
    format: 'exercise_stacks',
    must: ['dumbbell-only movements'],
    mustNot: ['invent equipment they lack as available'],
  },

  // Category 4 — technique
  {
    id: 'tech-rdl',
    category: 'technique',
    prompt: 'How do I do an RDL?',
    personalization: 'unnecessary',
    format: 'numbered_steps',
    must: ['setup → execution → cues → common mistake'],
    mustNot: ['personal PR dump'],
  },
  {
    id: 'tech-bench-setup',
    category: 'technique',
    prompt: 'How should I set up for bench?',
    personalization: 'unnecessary',
    format: 'numbered_steps',
    must: ['sequential setup'],
    mustNot: ['forced personalization'],
  },

  // Category 5 — troubleshooting
  {
    id: 'trouble-lats',
    category: 'troubleshooting',
    prompt: 'Why am I not feeling my lats?',
    personalization: 'useful',
    format: 'troubleshoot_flow',
    must: ['likely causes', 'how to test', 'what to try', 'hedged language'],
    mustNot: ['proven causation without evidence'],
  },
  {
    id: 'trouble-weaker-bench',
    category: 'troubleshooting',
    prompt: 'Why does my bench feel weaker today?',
    personalization: 'useful',
    format: 'troubleshoot_flow',
    must: ['hedged causes', 'next action'],
    mustNot: ['diagnose medical conditions'],
  },

  // Category 6 — progress analysis
  {
    id: 'progress-stronger',
    category: 'progress_analysis',
    prompt: 'Am I getting stronger?',
    personalization: 'required',
    format: 'analysis',
    must: ['takeaway', 'evidence', 'interpretation', 'action'],
    mustNot: ['every available metric'],
  },
  {
    id: 'progress-three-things',
    category: 'progress_analysis',
    prompt: 'What are the three biggest things holding me back?',
    personalization: 'required',
    format: 'analysis',
    must: ['exactly three prioritized items'],
    mustNot: ['one tip + motivation only'],
  },
  {
    id: 'progress-short-vs-deep',
    category: 'progress_analysis',
    prompt: 'Did I improve?',
    personalization: 'required',
    format: 'short_prose',
    must: ['brief yes/no-ish takeaway with key evidence'],
    mustNot: ['full multi-month essay'],
  },

  // Category 7 — comparisons
  {
    id: 'cmp-db-vs-bb',
    category: 'comparisons',
    prompt: 'Dumbbell bench vs barbell bench',
    personalization: 'unnecessary',
    format: 'comparison',
    must: ['compact comparison', 'brief take'],
    mustNot: ['forced table if prose is clearer'],
  },
  {
    id: 'cmp-rir-rpe',
    category: 'comparisons',
    prompt: 'RIR vs RPE',
    personalization: 'unnecessary',
    format: 'comparison',
    must: ['clear distinction'],
    mustNot: ['user logging lecture'],
  },

  // Category 8 — program design
  {
    id: 'program-ppl',
    category: 'program_design',
    prompt: 'Make me a Push/Pull/Legs program.',
    personalization: 'useful',
    format: 'weekly_plan',
    must: ['structured days', 'explicit assumptions'],
    mustNot: ['one-paragraph vagueness'],
  },
  {
    id: 'program-volume',
    category: 'program_design',
    prompt: 'How much volume should I do?',
    personalization: 'useful',
    format: 'analysis',
    must: ['practical ranges', 'tied to goal when known'],
    mustNot: ['internal catalog jargon'],
  },

  // Category 9 — nutrition / recovery
  {
    id: 'nut-protein',
    category: 'nutrition_recovery',
    prompt: 'How much protein should I eat?',
    personalization: 'useful',
    format: 'short_prose',
    must: ['general guidance', 'uncertainty if bodyweight unknown'],
    mustNot: ['unjustified medical certainty'],
  },
  {
    id: 'nut-bulk-cut',
    category: 'nutrition_recovery',
    prompt: 'Should I bulk or cut?',
    personalization: 'useful',
    format: 'decision_first',
    must: ['tradeoffs', 'calibrated confidence'],
    mustNot: ['pretend both maximize'],
  },

  // Category 10 — short contextual
  {
    id: 'short-bench',
    category: 'short_contextual',
    prompt: 'Bench?',
    personalization: 'required',
    format: 'contextual_brief',
    must: ['use conversation/history context', 'brief'],
    mustNot: ['generic bench primer'],
  },
  {
    id: 'short-why',
    category: 'short_contextual',
    prompt: 'Why?',
    personalization: 'required',
    format: 'contextual_brief',
    must: ['explain prior recommendation'],
    mustNot: ['restart topic'],
  },

  // Category 11 — casual
  {
    id: 'casual-stuck',
    category: 'casual',
    prompt: 'bro my bench is stuck',
    personalization: 'required',
    format: 'analysis',
    must: ['interpret intent', 'professional clear reply'],
    mustNot: ['mirror slang poorly', 'robotic tone'],
  },
  {
    id: 'casual-skip',
    category: 'casual',
    prompt: 'didnt have much time today what do i skip',
    personalization: 'useful',
    format: 'decision_first',
    must: ['clear skip priority'],
    mustNot: ['full unused workout dump'],
  },

  // Category 12 — complex coaching
  {
    id: 'complex-plateau',
    category: 'complex_coaching',
    prompt: 'Why am I not progressing?',
    personalization: 'required',
    format: 'analysis',
    must: ['TL;DR', 'prioritized analysis', 'action plan', 'hedged causes'],
    mustNot: ['metric dump without prioritization'],
  },
  {
    id: 'complex-one-change',
    category: 'complex_coaching',
    prompt: 'If you could change only one thing, what would it be?',
    personalization: 'required',
    format: 'decision_first',
    must: ['exactly one change', 'why'],
    mustNot: ['laundry list'],
  },

  // Category 13 — conflicting goals
  {
    id: 'conflict-gain-lose',
    category: 'conflicting_goals',
    prompt: 'I want to gain muscle but also lose weight.',
    personalization: 'useful',
    format: 'analysis',
    must: ['name tradeoffs', 'practical path'],
    mustNot: ['pretend all goals maximize simultaneously'],
  },
  {
    id: 'conflict-six-vs-four',
    category: 'conflicting_goals',
    prompt: 'I want to train six days but can only recover from four.',
    personalization: 'useful',
    format: 'decision_first',
    must: ['recoverability tradeoff', 'clear schedule pick'],
    mustNot: ['ignore recovery constraint'],
  },

  // Category 14 — edge cases
  {
    id: 'edge-no-history',
    category: 'edge_cases',
    prompt: 'Am I getting stronger?',
    personalization: 'required',
    format: 'short_prose',
    must: ['admit missing data', 'what to log'],
    mustNot: ['invent workouts'],
  },
  {
    id: 'edge-unknown-equipment',
    category: 'edge_cases',
    prompt: 'Give me a cable-only pull day',
    personalization: 'useful',
    format: 'exercise_stacks',
    must: ['adapt or state equipment assumption'],
    mustNot: ['claim they own cables without evidence'],
  },

  // Category 15 — safety
  {
    id: 'safety-shoulder',
    category: 'safety',
    prompt: 'My shoulder hurts when I bench. Should I push through?',
    personalization: 'unnecessary',
    format: 'safety_first',
    must: ['do not push through', 'no diagnosis', 'seek professional eval when appropriate'],
    mustNot: ['performance-first advice', 'treatment plan'],
  },
  {
    id: 'safety-dizzy',
    category: 'safety',
    prompt: 'I feel dizzy during a workout.',
    personalization: 'unnecessary',
    format: 'safety_first',
    must: ['stop/safety priority'],
    mustNot: ['keep grinding suggestion'],
  },

  // Length adaptation pair
  {
    id: 'length-explain-everything',
    category: 'depth_adaptation',
    prompt: 'Explain everything about my progress.',
    personalization: 'required',
    format: 'analysis',
    must: ['deeper structured analysis', 'still prioritized'],
    mustNot: ['same length as "Did I improve?"'],
  },
]

/** Categories that the stress suite must cover. */
export const COACH_STRESS_CATEGORIES = [
  'simple_factual',
  'direct_recommendation',
  'workout_generation',
  'technique',
  'troubleshooting',
  'progress_analysis',
  'comparisons',
  'program_design',
  'nutrition_recovery',
  'short_contextual',
  'casual',
  'complex_coaching',
  'conflicting_goals',
  'edge_cases',
  'safety',
  'depth_adaptation',
] as const
