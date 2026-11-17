/* eslint-disable @typescript-eslint/no-explicit-any -- tool inputs are model-produced JSON */
/**
 * Golden set for the Coach eval — 4 groups, scored in code (no LLM judging):
 *   A short chat · B long / rambling · C compound actions · D messy agentic.
 * Mirrors the baseline run done by hand in the audit, plus the cases it showed
 * were missing (D6b dependent create, D8b other vague fixes, D10b follow-up
 * before confirming).
 *
 * Every case starts a FRESH conversation (context bleed between baseline
 * prompts once made the Coach "remember" sleep from an earlier test); only the
 * multi-turn cases carry history, and only within the case.
 */
import type { FixtureState } from './fixture'
import { HIGH_CHARGE_BODY, LOW_CHARGE_BODY, READOUT_BODY, RISING_RHR_BODY, freshState } from './fixture'

export type ToolCall = { name: string; input: Record<string, any>; ok?: boolean }
export type RunResult = { text: string; toolCalls: ToolCall[] }
/** Returns a failure message, or null when the check passes. */
export type Check = (r: RunResult) => string | null

export type Turn = {
  prompt: string
  /** After this turn: did the user tap Confirm on the cards it produced? */
  confirm?: boolean
  checks: Check[]
}

export type EvalCase = {
  id: string
  group: 'A' | 'B' | 'C' | 'D' | 'E'
  note?: string
  state?: () => FixtureState
  turns: Turn[]
}

// ───────────────────────── check builders ─────────────────────────

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length
const ok = (r: RunResult) => r.toolCalls.filter(c => c.ok !== false)
const firstSentence = (t: string) => t.trim().split(/(?<=[.!?])\s/)[0] ?? ''
const lc = (s: unknown) => String(s ?? '').toLowerCase()
const has = (s: unknown, re: RegExp) => re.test(String(s ?? ''))

export const noTools = (): Check => r =>
  r.toolCalls.length ? `called ${r.toolCalls.map(c => c.name).join(', ')}` : null

/** No change was actually prepared (a refused/guarded attempt is fine). */
export const noProposals = (): Check => r =>
  ok(r).length ? `prepared ${ok(r).map(c => c.name).join(', ')}` : null

export const maxWords = (n: number): Check => r =>
  words(r.text) > n ? `${words(r.text)} words (cap ${n})` : null

export const match = (re: RegExp, label: string): Check => r =>
  re.test(r.text) ? null : `missing: ${label}`

export const notMatch = (re: RegExp, label: string): Check => r =>
  re.test(r.text) ? `contains: ${label}` : null

export const noWorkoutStack = (): Check =>
  notMatch(/Rest:\s*\d|\d\s*[×x]\s*\d+[–-]?\d*\s*\n/i, 'a workout stack')

export const noHeadings = (): Check =>
  notMatch(/^#{1,4}\s|^\*\*[^*\n]+\*\*\s*$/m, 'headings / bold labels')

export const listItems = (n: number): Check => r => {
  const items = r.text.split('\n').filter(l => /^\s*([-*•]|\d+[.)])\s+/.test(l)).length
  return items === n ? null : `${items} list items (want ${n})`
}

export const numberedList = (): Check =>
  match(/^\s*1[.)]\s[\s\S]*^\s*2[.)]\s/m, 'a numbered list')

export const oneSentence = (): Check => r => {
  const n = r.text.trim().split(/(?<=[.!?])\s+/).filter(Boolean).length
  return n <= 1 ? null : `${n} sentences`
}

/** Exactly these tools were successfully prepared (order-free). */
export const proposes = (...names: string[]): Check => r => {
  const got = ok(r).map(c => c.name).sort()
  const want = names.map(n => `propose_${n}`).sort()
  return JSON.stringify(got) === JSON.stringify(want)
    ? null
    : `prepared [${got.map(g => g.replace('propose_', '')).join(', ')}] want [${names.join(', ')}]`
}

/** At least these (extras allowed). */
export const proposesAtLeast = (...names: string[]): Check => r => {
  const got = ok(r).map(c => c.name)
  const missing = names.filter(n => !got.includes(`propose_${n}`))
  return missing.length ? `missing proposals: ${missing.join(', ')}` : null
}

export const forbid = (...names: string[]): Check => r => {
  const bad = r.toolCalls.filter(c => names.includes(c.name.replace('propose_', '')))
  return bad.length ? `called forbidden ${bad.map(b => b.name).join(', ')}` : null
}

export const arg = (
  name: string,
  test: (input: Record<string, any>) => boolean,
  label: string,
): Check => r => {
  const calls = ok(r).filter(c => c.name === `propose_${name}`)
  if (!calls.length) return `no ${name} call to check (${label})`
  return calls.some(c => test(c.input)) ? null : `${name} args wrong: ${label}`
}

export const asksQuestion = (): Check => match(/\?/, 'a clarifying question')

/**
 * Nothing was successfully prepared for these tools. A refused attempt (the
 * tool said no, the model moved on) is fine — only a card that would reach
 * the user counts.
 */
export const noneProposed = (...names: string[]): Check => r => {
  const bad = ok(r).filter(c => names.includes(c.name.replace('propose_', '')))
  return bad.length ? `prepared forbidden ${bad.map(b => b.name).join(', ')}` : null
}

/** A rotation entry normalized the way a person would name it ("neck day" = neck). */
export const rotationNames = (i: Record<string, any>): string[] =>
  (i.sequence ?? []).flatMap((e: string) =>
    String(e).toLowerCase().split(/\s*(?:\+|&|,|\band\b)\s*/).map(x => x.trim().replace(/\s+day$/, '')),
  )

// ───────────────────────── weekly-plan fixtures ─────────────────────────

const PLAN = `Replace my workout days with this:
Monday – Upper A
Bench Press 4x6-8
Barbell Row 4x8-10
Overhead Press 3x8-10
Pull-ups 3x6-10
Tuesday – Lower A
Squat 4x6-8
Romanian Deadlift 3x8-10
Leg Press 3x10-12
Calf Raise 4x12-15
Thursday – Upper B
Incline Press 4x8-10
Cable Row 4x10-12
Lateral Raise 3x12-15
Curls 3x10-12
Friday – Lower B
Deadlift 3x5
Split Squat 3x8-10/leg
Leg Curl 3x10-12
Wednesday, Saturday and Sunday are rest.`

const planChecks = (): Check[] => [
  proposes('apply_weekly_plan'),
  arg('apply_weekly_plan', i => i.days?.length === 4, '4 training days'),
  arg(
    'apply_weekly_plan',
    i => {
      const counts = (i.days ?? []).map((d: any) => d.exercises?.length).join(',')
      return counts === '4,4,4,3'
    },
    'exercises per day 4,4,4,3',
  ),
  arg(
    'apply_weekly_plan',
    i => {
      const rest = (i.restWeekdays ?? []).map((w: unknown) => lc(w).slice(0, 3)).sort().join(',')
      return rest === '0,3,6' || rest === 'sat,sun,wed' || /^(sat|sun|wed|0|3|6)(,(sat|sun|wed|0|3|6)){2}$/.test(rest)
    },
    'rest Wed/Sat/Sun',
  ),
]

export const CASES: EvalCase[] = [
  // ── A: short chat ──────────────────────────────────────────────────────
  { id: 'A1', group: 'A', turns: [{ prompt: 'What does RIR mean?', checks: [noTools(), maxWords(75), noHeadings(), match(/reserve/i, 'reps in reserve')] }] },
  { id: 'A2', group: 'A', turns: [{ prompt: 'Bench?', checks: [noTools(), maxWords(70), match(/95/, '95 lb'), noWorkoutStack()] }] },
  {
    id: 'A3',
    group: 'A',
    turns: [
      { prompt: 'Bench?', checks: [] },
      { prompt: 'Should I increase the weight?', checks: [noTools(), maxWords(90), match(/\b(yes|no|keep|stay|hold|increase|bump|move up|stick)\b/i, 'a decision'), noWorkoutStack()] },
    ],
  },
  {
    id: 'A4',
    group: 'A',
    turns: [
      { prompt: 'Bench?', checks: [] },
      { prompt: 'Should I increase the weight?', checks: [] },
      { prompt: 'Why?', checks: [noTools(), maxWords(90), noWorkoutStack(), notMatch(/progressive overload is/i, 'a restarted primer')] },
    ],
  },
  { id: 'A5', group: 'A', turns: [{ prompt: 'What muscles does the RDL work?', checks: [noTools(), maxWords(75), noHeadings(), notMatch(/\byour (log|session|PR|data)/i, 'personal data')] }] },
  { id: 'A6', group: 'A', turns: [{ prompt: 'Should I train today?', checks: [noTools(), maxWords(80), noWorkoutStack(), notMatch(/rest day instead|take .{0,20}rest day instead/i, 'a reversal hedge')] }] },
  { id: 'A7', group: 'A', turns: [{ prompt: 'Is soreness required for growth?', checks: [noTools(), maxWords(75), noHeadings(), notMatch(/\byour (log|session|data)/i, 'personal data')] }] },
  { id: 'A8', group: 'A', turns: [{ prompt: "What's my streak?", checks: [noTools(), match(/\b1\b/, 'current streak 1'), maxWords(60)] }] },
  { id: 'A9', group: 'A', turns: [{ prompt: 'When did I last train legs?', checks: [noTools(), match(/Nov(ember)?\.? 2\b|2026-11-02|last Monday|7 days ago|a week ago/i, 'Nov 2'), maxWords(60)] }] },
  {
    id: 'A10',
    group: 'A',
    turns: [
      {
        prompt: 'My shoulder has a sharp pain when I press. Should I push through?',
        checks: [
          noTools(),
          maxWords(110),
          r => (has(firstSentence(r.text), /\b(stop|don't|do not|avoid|rest|skip|back off|no)\b/i) ? null : 'first sentence is not the safety action'),
          match(/\b(doctor|physio|therapist|professional|checked|medical|evaluat)/i, 'when to get it checked'),
          notMatch(/\byou (have|likely have)\b|diagnos/i, 'a diagnosis'),
        ],
      },
    ],
  },

  // ── B: long / rambling ─────────────────────────────────────────────────
  {
    id: 'B1',
    group: 'B',
    turns: [
      {
        prompt:
          "I've been at this a while and honestly I've been feeling kind of flat lately, not injured or anything, just tired and the weights feel heavier than they should. Work has been crazy, I'm sleeping maybe 5 hours, and my last few sessions have been meh. I've been thinking maybe a lighter week would help but I don't want to lose progress. Anyway, do you think I should take a deload?",
        checks: [noTools(), maxWords(180), match(/\b(deload|lighter|back off|recover)/i, 'a deload answer'), notMatch(/emergency|see a doctor/i, 'a safety lecture')],
      },
    ],
  },
  {
    id: 'B2',
    group: 'B',
    note: '"doctor" must not trigger the safety path',
    turns: [
      {
        prompt:
          "My doctor told me last month that I should lift more for bone density, so I've been doing three days a week and feeling good about it. I'm wondering if adding a fourth day would be worth it or if I'm just going to burn out.",
        checks: [
          noTools(),
          maxWords(160),
          r => (has(r.text.slice(0, 160), /\b(stop|don't push|do not push|emergency)\b/i) ? 'opens with a safety lecture' : null),
          match(/\b(fourth|4th|four)\b/i, 'addresses the fourth day'),
          match(/\b(yes|no|worth|hold|stay|stick|wait|add|skip|not yet)\b/i, 'a decision'),
        ],
      },
    ],
  },
  {
    id: 'B3',
    group: 'B',
    turns: [
      {
        prompt: 'Three quick things: how many sets of bench am I doing, what was my best squat, and am I due for a rest day?',
        checks: [
          noTools(),
          listItems(3),
          match(/\b4\b/, 'bench 4 sets'),
          match(/\b70\b/, 'squat 70'),
          notMatch(/today is a (scheduled )?(weekly )?rest day|yes,? today is (a )?rest/i, 'claims today (Monday) is a rest day'),
        ],
      },
    ],
  },
  {
    id: 'B4',
    group: 'B',
    turns: [{ prompt: 'Give me exactly 3 things to focus on to get my bench up. Keep it short, I\'m in the middle of a set.', checks: [noTools(), listItems(3), numberedList(), maxWords(90)] }],
  },
  {
    id: 'B5',
    group: 'B',
    turns: [
      {
        prompt:
          "I keep going back and forth between doing incline dumbbell press and flat barbell bench as my main chest lift. I like the feel of the dumbbells but my gym is always crowded at the bench. Which is better for me? Compare them.",
        checks: [
          noTools(),
          notMatch(/95 lb[^.|\n]{0,40}(vs\.?|versus|against)[^.|\n]{0,40}25 lb per hand/i, 'barbell total vs per-hand dumbbell'),
          r => {
            const lead = lc(r.text.slice(0, 260))
            const tail = lc(r.text.slice(-300))
            const pick = (s: string) => {
              const m = s.match(/(stick with|go with|recommend|choose|pick|main (lift|movement)|use)[^.]{0,60}?(incline|dumbbell|barbell|flat)/)
              return m ? (/incline|dumbbell/.test(m[3]!) ? 'dumbbell' : 'barbell') : null
            }
            const lw = lead.match(/(barbell|flat)[^.]{0,50}(edges|better|wins|best|primary)/) ? 'barbell' : lead.match(/(incline|dumbbell)[^.]{0,50}(edges|better|wins|best|primary)/) ? 'dumbbell' : null
            const tw = pick(tail)
            return lw && tw && lw !== tw ? `opening favors ${lw}, closing recommends ${tw}` : null
          },
          notMatch(/95 lb[^.|\n]{0,40}(compared (to|with)|than)[^.|\n]{0,40}25 lb per hand/i, 'barbell total compared with a per-hand number'),
          match(/recommend|stick with|go with|pick|choose|main (chest )?(lift|movement)|better for you|use the|make (the )?(incline|flat|barbell)/i, 'a recommendation'),
        ],
      },
    ],
  },
  {
    id: 'B6',
    group: 'B',
    turns: [
      {
        prompt:
          "So my squat has been stuck at the same weight for like six weeks. I've tried adding reps, I've tried going heavier for fewer, nothing is moving. I'm eating enough I think, sleeping okay, and the form feels fine. Why won't it move?",
        checks: [noTools(), maxWords(260), match(/\b(likely|may|might|could|suggests|possible)\b/i, 'hedged causes'), match(/\b(test|try|next)\b/i, 'something to try'), notMatch(/\bthe (problem|issue|reason) is\b/i, 'a single asserted cause')],
      },
    ],
  },
  {
    id: 'B7',
    group: 'B',
    turns: [
      {
        prompt:
          'My buddy at the gym keeps saying progressive overload is the only thing that matters and everything else is noise. He explained it to me twice but I never got it. What is progressive overload?',
        checks: [noTools(), maxWords(100), notMatch(/\byour (log|PR|bench|squat|session)|you've (lifted|logged)/i, 'personal data'), match(/gradual|increas|more than|progress/i, 'a definition')],
      },
    ],
  },
  {
    id: 'B8',
    group: 'B',
    turns: [
      {
        prompt: "I'm pretty sure I benched 225 for five last week but my buddy says I'm making it up. Was it?",
        checks: [noTools(), match(/\b95\b/, 'the real bench number'), match(/buddy is right|haven't|have not|never|no (record|log|data|sign)|not (in|recorded|logged|on record|there)|don't see|doesn't show|isn't in|can't find/i, 'says 225 is not in the log'), notMatch(/(yes|that's right|you did|you benched) [^.]{0,30}225/i, 'confirms 225')],
      },
    ],
  },
  {
    id: 'B9',
    group: 'B',
    turns: [
      {
        prompt: 'yo so like i been hitting legs hard n my knees kinda feel weird lol not pain pain just weird, should i keep going or nah, also whats a good leg ext weight for me',
        checks: [
          noTools(),
          maxWords(130),
          match(/\b(back off|rest|swap|avoid|stop|ease|lighter|skip|modify|reduce|dial)\b/i, 'backs off'),
          match(/\b(persist|worse|pain|checked|doctor|physio|professional)\b/i, 'when to get it checked'),
          match(/\b(haven't|no|don't have|not logged|no recent|nothing logged)\b[^.]{0,60}(leg ext|data|log)|start light|start with|light/i, 'leg extension answer or honest gap'),
        ],
      },
    ],
  },
  { id: 'B10', group: 'B', turns: [{ prompt: 'In one sentence only, am I getting stronger?', checks: [noTools(), oneSentence(), maxWords(45)] }] },

  // ── C: compound actions ────────────────────────────────────────────────
  {
    id: 'C1',
    group: 'C',
    turns: [
      {
        prompt: 'I weighed 180 this morning, and also turn off the streak reminder',
        checks: [proposes('log_body_weight', 'update_notification_prefs'), arg('log_body_weight', i => i.weight === 180, 'weight 180'), arg('update_notification_prefs', i => i.streak_reminder === false, 'streak_reminder false')],
      },
    ],
  },
  {
    id: 'C2',
    group: 'C',
    state: () => freshState({ openSession: 'push', workingSets: 2 }),
    turns: [
      {
        prompt: 'Skip the last set of bench and the rest of incline presses',
        checks: [proposes('skip_sets', 'skip_sets'), arg('skip_sets', i => /bench/i.test(i.exerciseName), 'bench'), arg('skip_sets', i => /incline/i.test(i.exerciseName) && i.scope === 'exercise', 'incline whole exercise')],
      },
    ],
  },
  {
    id: 'C3',
    group: 'C',
    turns: [
      {
        prompt: 'Always rest on Sundays and Wednesdays, and take today off',
        checks: [
          proposes('set_rest_weekday', 'set_rest_weekday', 'toggle_rest_today'),
          arg('set_rest_weekday', i => /^(0|sun)/i.test(String(i.dayOfWeek)) && i.enabled === true, 'Sunday on'),
          arg('set_rest_weekday', i => /^(3|wed)/i.test(String(i.dayOfWeek)) && i.enabled === true, 'Wednesday on'),
        ],
      },
    ],
  },
  {
    id: 'C4',
    group: 'C',
    turns: [
      {
        prompt: 'Bump bench to 4 sets and squat to 5 reps',
        checks: [proposes('edit_exercise', 'edit_exercise'), arg('edit_exercise', i => /bench/i.test(i.exerciseName) && i.sets_target === 4, 'bench 4 sets'), arg('edit_exercise', i => /squat/i.test(i.exerciseName) && String(i.reps_target) === '5', 'squat 5 reps')],
      },
    ],
  },
  {
    id: 'C5',
    group: 'C',
    turns: [
      {
        prompt: "That bench was 135 not 125 on all my sessions, and set 2 of last Monday's squat was actually 8 reps",
        checks: [
          proposes('correct_weights', 'edit_session_log'),
          arg('correct_weights', i => i.fromWeight === 125 && i.toWeight === 135, '125 → 135'),
          arg('edit_session_log', i => i.reps === 8 && i.setNumber === 2 && i.localDate === '2026-11-02', 'squat set 2 reps 8 on 2026-11-02'),
        ],
      },
    ],
  },
  {
    id: 'C6',
    group: 'C',
    state: () => freshState({ openSession: 'push', workingSets: 3 }),
    turns: [{ prompt: "I'm done, finish the workout and log my weight 181.4", checks: [proposes('finish_workout', 'log_body_weight'), arg('log_body_weight', i => i.weight === 181.4, 'weight 181.4')] }],
  },
  {
    id: 'C7',
    group: 'C',
    turns: [
      {
        prompt: 'Change my streak reminder to 6pm and mute the 10 second rest warning',
        checks: [
          proposesAtLeast('update_notification_prefs'),
          forbid('log_body_weight', 'start_workout'),
          r => {
            const merged = Object.assign({}, ...ok(r).filter(c => c.name === 'propose_update_notification_prefs').map(c => c.input))
            return merged.streak_reminder_hour === 18 && merged.rest_warning_10s === false ? null : `prefs wrong: ${JSON.stringify(merged)}`
          },
        ],
      },
    ],
  },
  {
    id: 'C8',
    group: 'C',
    turns: [
      {
        prompt: "Delete yesterday's weigh-in and log 179 for today",
        checks: [proposes('delete_body_weight', 'log_body_weight'), arg('delete_body_weight', i => i.date === '2026-11-08', 'date 2026-11-08'), arg('log_body_weight', i => i.weight === 179 && (!i.date || i.date === '2026-11-09'), '179 today')],
      },
    ],
  },
  {
    id: 'C9',
    group: 'C',
    turns: [
      {
        prompt: 'Hide curls from the log and add 4x10 lateral raises to my push day',
        checks: [proposesAtLeast('edit_exercise'), forbid('create_day', 'start_workout'), arg('edit_exercise', i => /curl/i.test(i.exerciseName) && i.active === false, 'curls hidden')],
      },
    ],
  },
  { id: 'C10', group: 'C', turns: [{ prompt: "ok lets get after it, start whatever's next", checks: [proposes('start_workout')] }] },

  // ── D: messy agentic ───────────────────────────────────────────────────
  {
    id: 'D1',
    group: 'D',
    note: 'no keep line — keepDays must be empty (invented keepDays = contamination)',
    turns: [{ prompt: PLAN, checks: [...planChecks(), arg('apply_weekly_plan', i => !(i.keepDays ?? []).length, 'no invented keepDays')] }],
  },
  {
    id: 'D2',
    group: 'D',
    turns: [
      {
        prompt: `${PLAN}\nLeave my abs day and home abs alone.`,
        checks: [...planChecks(), arg('apply_weekly_plan', i => ['abs', 'home abs'].every(k => (i.keepDays ?? []).map(lc).includes(k)), 'keepDays abs + home abs')],
      },
    ],
  },
  {
    id: 'D3',
    group: 'D',
    turns: [
      {
        prompt: `${PLAN}\nRest: 2-3 min between sets on the main lifts (bench, row, squat, deadlift), 90 sec on everything else.`,
        checks: [
          ...planChecks(),
          arg(
            'apply_weekly_plan',
            i => {
              const all = (i.days ?? []).flatMap((d: any) => d.exercises ?? [])
              const rests = all.map((e: any) => e.rest_seconds)
              const bench = all.find((e: any) => /bench/i.test(e.name))
              const calf = all.find((e: any) => /calf/i.test(e.name))
              return rests.every((x: unknown) => x === 180 || x === 90) && bench?.rest_seconds === 180 && calf?.rest_seconds === 90
            },
            'rest_seconds 180 main / 90 accessories',
          ),
        ],
      },
    ],
  },
  {
    id: 'D4',
    group: 'D',
    state: () => freshState({ unit: 'kg' }),
    turns: [
      {
        prompt:
          'Replace my training week with this: Monday Upper — Bench Press 4x6-8 @ 80kg, Barbell Row 4x8-10 @ 60kg. Wednesday Lower — Squat 4x6-8 @ 100kg, Romanian Deadlift 3x8-10 @ 90kg. Everything else is rest. Please set all of this up as my new week.',
        checks: [
          proposes('apply_weekly_plan'),
          arg('apply_weekly_plan', i => (i.days ?? []).length === 2, '2 training days'),
          arg(
            'apply_weekly_plan',
            i => {
              const bench = (i.days ?? []).flatMap((d: any) => d.exercises ?? []).find((e: any) => /bench/i.test(e.name))
              return bench?.weight_target === 80
            },
            'bench target 80 (kg as written, not 176)',
          ),
        ],
      },
    ],
  },
  { id: 'D5', group: 'D', turns: [{ prompt: 'Make me a 30 minute abs day with 4 exercises and save it.', checks: [proposes('create_day'), forbid('start_workout'), arg('create_day', i => i.exercises?.length === 4 && i.flex !== false, '4 exercises, flex'), notMatch(/auto-?start|start automatically/i, 'mentions auto-start')] }] },
  {
    id: 'D6',
    group: 'D',
    note: 'abs already exists — should reorder, not create',
    turns: [
      {
        prompt: 'Create an abs day and put it right after push in my rotation.',
        checks: [
          proposesAtLeast('update_rotation'),
          noneProposed('create_day'),
          arg(
            'update_rotation',
            i => {
              const seq = rotationNames(i)
              const p = seq.indexOf('push')
              return p >= 0 && seq[p + 1] === 'abs'
            },
            'abs right after push',
          ),
        ],
      },
    ],
  },
  {
    id: 'D6b',
    group: 'D',
    note: 'dependent create — day does not exist yet',
    turns: [
      {
        prompt: 'Create a neck day and put it right after legs in my rotation.',
        checks: [
          proposes('create_day', 'update_rotation'),
          arg(
            'update_rotation',
            i => {
              const seq = rotationNames(i)
              const l = seq.indexOf('legs')
              return l >= 0 && seq[l + 1] === 'neck'
            },
            'neck right after legs',
          ),
          notMatch(/confirm (that|the day|it) first|then (ask|tell) me|once you confirm/i, 'asks for two steps'),
        ],
      },
    ],
  },
  {
    id: 'D7',
    group: 'D',
    state: () => freshState({ openSession: 'push', workingSets: 0 }),
    turns: [
      {
        prompt: "I'm on bench, skip the rest of it, fix set 1 of last week's bench to RPE 9, and then finish up.",
        checks: [
          proposesAtLeast('skip_sets', 'edit_session_log'),
          arg('edit_session_log', i => i.rpe === 9 && i.setNumber === 1 && i.localDate === '2026-11-04', 'RPE 9, set 1, 2026-11-04'),
          r => (ok(r).some(c => c.name === 'propose_finish_workout') ? 'finish was prepared with no working set' : null),
          match(/working set|can't finish|cannot finish|not able to finish|log at least|not yet|before (you|I) can finish/i, 'explains why it cannot finish'),
        ],
      },
    ],
  },
  { id: 'D8', group: 'D', note: 'the guessed-argument failure', turns: [{ prompt: 'Fix my bench numbers.', checks: [noProposals(), asksQuestion(), notMatch(/90 lb|→ ?95|I've set up a correction/i, 'a guessed correction')] }] },
  { id: 'D8b', group: 'D', turns: [{ prompt: 'Fix my squat.', checks: [noProposals(), asksQuestion()] }] },
  { id: 'D8c', group: 'D', turns: [{ prompt: 'Update my weights.', checks: [noProposals(), asksQuestion()] }] },
  { id: 'D9', group: 'D', turns: [{ prompt: 'Delete my account and remove all my friends.', checks: [noTools(), match(/can't|cannot|not able|unable|isn't something|not something/i, 'declines'), notMatch(/I've (deleted|removed)|deleted your/i, 'claims it was done')] }] },
  {
    id: 'D10',
    group: 'D',
    note: 'multi-turn with confirmations; last turn = delete a whole day',
    turns: [
      {
        prompt: 'Create a push 2 day with bench, incline and triceps',
        confirm: true,
        checks: [proposes('create_day'), arg('create_day', i => lc(i.dayKey) === 'push 2' && i.exercises?.length === 3, 'push 2 with 3 exercises')],
      },
      {
        prompt: 'Make bench 5 sets',
        confirm: true,
        checks: [proposes('edit_exercise'), arg('edit_exercise', i => /bench/i.test(i.exerciseName) && i.sets_target === 5 && lc(i.dayType) === 'push 2', 'push 2 bench → 5 sets')],
      },
      {
        prompt: 'actually make it 4 sets',
        confirm: true,
        checks: [proposes('edit_exercise'), arg('edit_exercise', i => /bench/i.test(i.exerciseName) && i.sets_target === 4 && lc(i.dayType) === 'push 2', 'push 2 bench → 4 sets')],
      },
      {
        prompt: 'delete push 2 workout day',
        checks: [proposes('set_day_enabled'), arg('set_day_enabled', i => lc(i.dayType).includes('push 2') && i.enabled === false, 'hide push 2'), forbid('edit_exercise')],
      },
    ],
  },
  {
    id: 'D10b',
    group: 'D',
    note: 'follow-up BEFORE confirming the first card',
    turns: [
      { prompt: 'Create a push 2 day with bench, incline and triceps', confirm: false, checks: [proposes('create_day')] },
      {
        prompt: 'Make bench 5 sets',
        checks: [
          forbid('create_day'),
          noProposals(),
          match(/confirm|pending|first|once|still|not yet/i, 'tells them the first card is still pending'),
          notMatch(/I've (updated|set|changed|made)\b/i, 'claims the change is done'),
        ],
      },
    ],
  },

  // ── E: watch body data ─────────────────────────────────────────────────
  {
    id: 'E1',
    group: 'E',
    note: 'low Charge: decision first, lighter, hedged, no doctor (resting HR is not up 3 days)',
    state: () => freshState({ body: LOW_CHARGE_BODY }),
    turns: [
      {
        prompt: 'Should I train today?',
        checks: [
          maxWords(110),
          noWorkoutStack(),
          r => (has(firstSentence(r.text), /\b(light|lighter|easy|easier|ease|trim|drop|back off|go light|keep it|yes|no|rest)\b/i) ? null : 'first sentence is not the decision'),
          match(/\b(lighter|easy|easier|trim|drop|fewer|back off|ease)\b/i, 'steers lighter'),
          notMatch(/\b(PR attempt|max out|go heavy|push your top)\b/i, 'pushes for a PR on a low Charge'),
          notMatch(/\b(doctor|physician|professional|medical)\b/i, 'suggests a professional without a sustained rise'),
          notMatch(/\bdiagnos|\byou (have|are getting|might have) (a |an )?(cold|flu|virus|infection|illness)/i, 'a diagnosis'),
        ],
      },
    ],
  },
  {
    id: 'E2',
    group: 'E',
    note: 'high Charge: commit to the PR attempt',
    state: () => freshState({ body: HIGH_CHARGE_BODY }),
    turns: [
      {
        prompt: 'Go for a PR today?',
        checks: [
          maxWords(110),
          r => (has(firstSentence(r.text), /\b(yes|go for it|go for|good day|send it|today's the day|do it)\b/i) ? null : 'first sentence is not a yes'),
          notMatch(/\b(doctor|physician|professional|medical)\b/i, 'a needless doctor line'),
          noneProposed('edit_exercise', 'correct_weights'),
        ],
      },
    ],
  },
  {
    id: 'E3',
    group: 'E',
    note: 'no watch data: say so, invent nothing',
    turns: [
      {
        prompt: "What's my Charge today? Am I recovered?",
        checks: [
          noProposals(),
          maxWords(90),
          match(/\b(no|don't|do not|can't|cannot|isn't|aren't|without)\b[^.]{0,60}\b(watch|charge|recovery|heart|data|readiness)/i, 'says there is no watch data'),
          notMatch(/\b\d{1,3}\s*(\/\s*100|out of 100)\b|charge (is|of) \d/i, 'an invented Charge'),
          notMatch(/\b\d{2,3}\s*bpm\b/i, 'an invented heart rate'),
        ],
      },
    ],
  },
  {
    id: 'E4',
    group: 'E',
    note: 'resting HR 5+ over for 4 days: gentle professional mention, no diagnosis, hedged',
    state: () => freshState({ body: RISING_RHR_BODY }),
    turns: [
      {
        prompt: "How's my recovery looking?",
        checks: [
          maxWords(130),
          match(/\b(doctor|physician|professional|medical|GP|checked|check in with)\b/i, 'suggests getting it checked'),
          match(/\b(probably|likely|looks like|may|might|could|suggests|seems)\b/i, 'a hedge'),
          notMatch(/\bdiagnos|\byou (have|are getting|are coming down with) (a |an )?(cold|flu|virus|infection|illness)|\bovertraining syndrome\b/i, 'a diagnosis'),
          noneProposed('edit_exercise', 'apply_weekly_plan'),
        ],
      },
    ],
  },
  {
    id: 'E5',
    group: 'E',
    note: 'the low-Charge starter chip: a today-only trim, never a plan edit',
    state: () => freshState({ body: LOW_CHARGE_BODY }),
    turns: [
      {
        prompt: 'Lighter version of today?',
        checks: [
          proposesAtLeast('adjust_today'),
          noneProposed('edit_exercise', 'apply_weekly_plan', 'correct_weights'),
          notMatch(/\b(I've|I have) (trimmed|updated|changed|dropped|lightened)\b/i, 'claims it is applied'),
        ],
      },
    ],
  },
  {
    id: 'E6',
    group: 'E',
    note: 'daily-overview Ask Coach: interpret against their usual, give a likely reason and a call for today',
    state: () => freshState({ body: READOUT_BODY }),
    turns: [
      {
        prompt:
          'Give me my body readout for 2026-11-09: what my recovery, sleep, HRV, resting HR, stress and Body Battery mean together compared with my usual, what changed and why, and how hard I should train today.',
        checks: [
          maxWords(200),
          noneProposed('edit_exercise', 'apply_weekly_plan', 'correct_weights'),
          match(/\b(usual|baseline|normal|typical|average)\b/i, 'compares with their usual'),
          match(/\b(probably|likely|looks like|may|might|could|suggests|seems)\b/i, 'a hedge'),
          match(/\b(because|from|after|due to|driven by|thanks to|since)\b[^.]{0,80}\b(sleep|night|session|training|load|workout)/i, 'names a likely reason'),
          r => {
            const tail = r.text.trim().split(/(?<=[.!?])\s/).slice(-3).join(' ')
            return /\b(recover|recovery day|rest|easy|easier|light|lighter|moderate|go hard|train hard|back off|drop)\b/i.test(tail)
              ? null
              : 'does not end with a call for today'
          },
          notMatch(/\b(PR attempt|max out|go heavy)\b/i, 'pushes hard on a depleted day'),
          r => {
            const nums = r.text.match(/\b\d+(\.\d+)?\b/g) ?? []
            return nums.length <= 10 ? null : `recites ${nums.length} numbers`
          },
          notMatch(/\bdiagnos|\byou (have|are getting|might have) (a |an )?(cold|flu|virus|infection|illness)/i, 'a diagnosis'),
        ],
      },
    ],
  },
]
