/* eslint-disable @typescript-eslint/no-explicit-any -- model output and tool inputs are untyped JSON */
/**
 * Coach eval runner — drives the REAL prompt, router, tool schemas and model
 * settings (src/lib/coach/turn.ts is shared with the chat route) against the
 * golden set in cases.ts, with a synthetic account and stubbed tool execution.
 * Tool calls are scored deterministically; prose gets word/shape/regex checks.
 *
 *   npx tsx --env-file=.env.local scripts/coach-eval/run.ts [flags]
 *
 *   --runs N       repeats per case (default 3; a case passes at >= ceil(2/3 N))
 *   --group A|B|C|D  only that group      --id D8   only that case
 *   --pace MS      pause between model calls (default 4500; free tier is rate limited)
 *   --model ID     override GEMINI_MODEL
 *   --out FILE     write full per-run results as JSON
 *
 * Needs GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY). No database, no auth:
 * nothing here can touch real data.
 */
import { writeFileSync } from 'node:fs'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText, stepCountIs } from 'ai'
import { COACH_DEFAULT_MODEL } from '../../src/lib/coach/constants'
import { coachModelSettings } from '../../src/lib/coach/models'
import { planCoachTurn } from '../../src/lib/coach/turn'
import { localizeCoachContext } from '../../src/lib/coach/localizeUnits'
import { formatRecentActions, type RecentActionRow } from '../../src/lib/coach/recentActions'
import { buildCoachProposalTools } from '../../src/lib/coach/actions/tools'
import { groundingReasonFor } from '../../src/lib/coach/actions/grounding'
import { validateCreateDayInput } from '../../src/lib/coach/actions/createDay'
import { validateUpdateRotationInput } from '../../src/lib/coach/actions/updateRotation'
import { planSetDayEnabled } from '../../src/lib/coach/actions/setDayEnabled'
import { resolveDayKey } from '../../src/lib/utils/dayKeys'
import type { CoachTurn } from '../../src/lib/coach/history'
import { buildFixtureContext, freshState, type FixtureState } from './fixture'
import { CASES, type EvalCase, type RunResult, type ToolCall } from './cases'

// ───────────────────────── args ─────────────────────────

const argv = process.argv.slice(2)
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const RUNS = Number(flag('runs') ?? 3)
const PACE = Number(flag('pace') ?? 4500)
const ONLY_GROUP = flag('group')
const ONLY_ID = flag('id')
const OUT = flag('out')
const MODEL_ID = flag('model') || process.env.GEMINI_MODEL?.trim() || COACH_DEFAULT_MODEL
const MODEL_SETTINGS = coachModelSettings(MODEL_ID)
const NEED = Math.ceil((RUNS * 2) / 3)

const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
if (!apiKey) {
  console.error('Missing GEMINI_API_KEY — run with --env-file=.env.local')
  process.exit(1)
}
const google = createGoogleGenerativeAI({ apiKey })

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ───────────────────────── stub tools ─────────────────────────

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()
const dayKeysOf = (s: FixtureState) => [...new Set(s.catalog.filter(e => e.active).map(e => e.day_type))].sort()
const findExercise = (s: FixtureState, name: unknown, day?: unknown) => {
  const n = norm(name)
  const key = day ? resolveDayKey(String(day), [...new Set(s.catalog.map(e => e.day_type))]) : null
  return s.catalog.find(
    e => (!day || (key && e.day_type === key)) && (norm(e.name).includes(n) || n.includes(norm(e.name)) || norm(e.name).split(' ').some(w => w.length > 3 && n.includes(w))),
  )
}

function makeTools(state: FixtureState, userText: string, pending: string[], waiting: string[]) {
  const real = buildCoachProposalTools({
    supabase: {} as never,
    userId: 'eval',
    conversationId: null,
    unit: state.unit === 'kg' ? 'kg' : 'lb',
    localDate: '2026-11-09',
    timeZone: 'America/Chicago',
    proposals: [],
    userText,
    pendingDayKeys: pending,
  }) as Record<string, any>

  const stub = (name: string) => async (input: Record<string, any>) => {
    const refuse = (reason: string) => ({ ok: false as const, reason })
    const grounded = groundingReasonFor(name, input, userText)
    if (grounded) return refuse(grounded)

    switch (name) {
      case 'propose_finish_workout':
        if (!state.openSession) return refuse('There is no open workout to finish.')
        if (state.workingSets < 1) return refuse('The open workout has no working sets yet — log at least one before finishing.')
        break
      case 'propose_skip_sets': {
        if (!state.openSession) return refuse('No workout is open.')
        const ex = findExercise(state, input.exerciseName, state.openSession)
        if (!ex) return refuse(`No exercise matches "${input.exerciseName}" in the open workout.`)
        break
      }
      case 'propose_edit_exercise': {
        const ex = findExercise(state, input.exerciseName, input.dayType)
        if (!ex) return refuse(`No exercise matches "${input.exerciseName}" on "${input.dayType}".`)
        break
      }
      case 'propose_create_day': {
        const v = validateCreateDayInput({ dayKey: input.dayKey, category: input.category, flex: input.flex, exercises: (input.exercises ?? []).map((e: any) => ({ ...e, weight_target_lbs: e.weight_target ?? null })) })
        if (!v.ok) return refuse((v as { reason: string }).reason)
        if (state.catalog.some(e => norm(e.day_type) === v.dayKey)) return refuse(`You already have a day named "${v.dayKey}".`)
        // Mirrors previewCreateDay: a card for this day is already waiting.
        if (waiting.includes(v.dayKey)) {
          return refuse(`A card to create "${v.dayKey}" is already waiting. Tell the user to Confirm or Cancel it first; changes to the day can follow once it exists.`)
        }
        pending.push(v.dayKey)
        break
      }
      case 'propose_update_rotation': {
        const v = validateUpdateRotationInput({ mode: input.mode, sequence: input.sequence, dayKeys: [...dayKeysOf(state), ...pending] })
        if (!v.ok) return refuse((v as { reason: string }).reason)
        break
      }
      case 'propose_set_day_enabled': {
        const p = planSetDayEnabled(state.catalog.map(e => ({ day_type: e.day_type, active: e.active })), input.dayType, input.enabled)
        if (!p.ok) return refuse((p as { reason: string }).reason)
        break
      }
      default:
        break
    }
    return { ok: true as const, proposalId: `stub-${name}`, summary: '(stub card)', note: 'Waiting for user Confirm in the Coach UI. Do not claim the change is applied yet.' }
  }

  return Object.fromEntries(Object.entries(real).map(([name, t]) => [name, { ...t, execute: stub(name) }]))
}

// ───────────────────────── fixture mutation after a confirm ─────────────────────────

const TITLES: Record<string, string> = {
  propose_create_day: 'Create workout day',
  propose_edit_exercise: 'Edit exercise',
  propose_set_day_enabled: 'Hide workout day',
  propose_update_rotation: 'Update workout order',
  propose_log_body_weight: 'Log body weight',
}

function applyConfirmed(state: FixtureState, call: ToolCall): { resultText: string; lines: string[] } {
  const i = call.input
  switch (call.name) {
    case 'propose_create_day': {
      const key = norm(i.dayKey).replace(/\s+/g, ' ')
      for (const e of i.exercises ?? []) {
        state.catalog.push({ day_type: key, name: e.name, sets_target: e.sets_target, reps_target: e.reps_target, weight_target_lbs: null, active: true })
      }
      return { resultText: `Created “${key}” with ${(i.exercises ?? []).length} exercises as a flex day.`, lines: [`Day: ${key}`, `${(i.exercises ?? []).length} exercises`] }
    }
    case 'propose_edit_exercise': {
      const ex = findExercise(state, i.exerciseName, i.dayType)
      if (ex) {
        const before = ex.sets_target
        if (i.sets_target != null) ex.sets_target = i.sets_target
        if (i.reps_target != null) ex.reps_target = String(i.reps_target)
        if (i.active != null) ex.active = i.active
        return { resultText: `Updated ${ex.name}.`, lines: [`${ex.name} · ${ex.day_type}`, i.sets_target != null ? `Sets: ${before} → ${i.sets_target}` : 'Targets updated'] }
      }
      return { resultText: 'Updated exercise.', lines: [] }
    }
    case 'propose_set_day_enabled': {
      const key = resolveDayKey(String(i.dayType), [...new Set(state.catalog.map(e => e.day_type))])
      for (const e of state.catalog) if (e.day_type === key) e.active = !!i.enabled
      return { resultText: i.enabled ? `Showing ${key} again.` : `Hid ${key}.`, lines: [`Day: ${key}`] }
    }
    default:
      return { resultText: 'Done.', lines: [] }
  }
}

// ───────────────────────── one model turn ─────────────────────────

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const msg = String(err?.message ?? err)
      const retryable = /429|quota|rate|RESOURCE_EXHAUSTED|503|overloaded|UNAVAILABLE|fetch failed|ECONN/i.test(msg)
      if (!retryable || attempt >= 4) throw err
      const wait = 15_000 * (attempt + 1)
      console.log(`    … ${msg.slice(0, 80)} — waiting ${wait / 1000}s`)
      await sleep(wait)
    }
  }
}

type TurnOutcome = RunResult & { finish: string; steps: number; retried: boolean; ms: number; tokens: number; intent: string }

async function runTurn(state: FixtureState, history: CoachTurn[], message: string, recentRows: RecentActionRow[]): Promise<TurnOutcome> {
  const ctx = localizeCoachContext(buildFixtureContext(state), state.unit)
  const plan = planCoachTurn({
    message,
    history,
    userDataJson: JSON.stringify(ctx),
    recentActions: formatRecentActions(recentRows),
  })
  const pending: string[] = []
  const waiting = recentRows
    .filter(r => r.kind === 'create_day' && r.status === 'pending')
    .map(r => norm((r.payload as { dayKey?: string } | null)?.dayKey))
  const tools = makeTools(state, plan.userText, pending, waiting)
  const started = Date.now()

  const attempt = (withTools: boolean) =>
    withBackoff(() =>
      generateText({
        model: google(MODEL_ID),
        system: plan.system,
        messages: plan.messages,
        ...(MODEL_SETTINGS.temperature != null ? { temperature: MODEL_SETTINGS.temperature } : {}),
        ...(MODEL_SETTINGS.supportsReasoning ? { reasoning: withTools ? plan.reasoning : 'none' } : {}),
        maxOutputTokens: withTools ? plan.maxOutputTokens : Math.max(plan.maxOutputTokens * 2, 2048),
        ...(withTools && plan.toolsEnabled
          ? {
              tools: tools as never,
              stopWhen: stepCountIs(3),
              prepareStep: ({ stepNumber }: { stepNumber: number }) => (stepNumber >= 2 ? { toolChoice: 'none' as const } : undefined),
            }
          : {}),
      } as never),
    )

  let retried = false
  let result: any = await attempt(true)
  const collect = (r: any) => {
    const calls: ToolCall[] = []
    let text = ''
    for (const step of r.steps ?? []) {
      text += step.text ?? ''
      for (const c of step.toolCalls ?? []) {
        const res = (step.toolResults ?? []).find((x: any) => x.toolCallId === c.toolCallId)
        calls.push({ name: c.toolName, input: c.input ?? c.args ?? {}, ok: (res?.output as { ok?: boolean } | undefined)?.ok })
      }
    }
    return { text: text.trim(), calls }
  }
  let { text, calls } = collect(result)
  if (!text && !calls.length) {
    // Same fallback as the chat route: one text-only retry.
    retried = true
    await sleep(PACE)
    result = await attempt(false)
    ;({ text, calls } = collect(result))
  }
  const proposed = calls.filter(c => c.ok !== false).length
  if (!text && proposed) text = 'I prepared an action for you — confirm or cancel below.'

  return {
    text,
    toolCalls: calls,
    finish: String(result.finishReason ?? ''),
    steps: (result.steps ?? []).length,
    retried,
    ms: Date.now() - started,
    tokens: Number(result.totalUsage?.totalTokens ?? result.usage?.totalTokens ?? 0),
    intent: plan.profile.intent,
  }
}

// ───────────────────────── run cases ─────────────────────────

type RunRecord = { pass: boolean; failures: string[]; outcome: TurnOutcome[] }

async function runCase(c: EvalCase): Promise<RunRecord> {
  const state = (c.state ?? freshState)()
  const history: CoachTurn[] = []
  const recent: RecentActionRow[] = []
  const failures: string[] = []
  const outcomes: TurnOutcome[] = []

  for (let t = 0; t < c.turns.length; t++) {
    const turn = c.turns[t]!
    const out = await runTurn(state, history, turn.prompt, recent)
    outcomes.push(out)
    for (const check of turn.checks) {
      const fail = check({ text: out.text, toolCalls: out.toolCalls })
      if (fail) failures.push(c.turns.length > 1 ? `turn ${t + 1}: ${fail}` : fail)
    }
    if (out.finish === 'length') failures.push(`turn ${t + 1}: hit the token ceiling`)

    // Carry the conversation forward exactly as the app would.
    history.push({ role: 'user', content: turn.prompt })
    history.push({ role: 'assistant', content: out.text })
    const made = out.toolCalls.filter(x => x.ok !== false)
    for (const call of made) {
      const detail =
        turn.confirm === true
          ? applyConfirmed(state, call)
          : { resultText: '', lines: Object.entries(call.input).slice(0, 3).map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 60)}`) }
      recent.push({
        kind: call.name.replace('propose_', ''),
        status: turn.confirm === true ? 'executed' : 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        payload: {
          card: { title: TITLES[call.name] ?? call.name.replace('propose_', ''), summaryLines: detail.lines },
          // eval-only: lets the stub mimic the "a card for this day is waiting" guard
          ...(call.name === 'propose_create_day' ? { dayKey: norm(call.input.dayKey) } : {}),
        } as never,
      })
      if (turn.confirm === true && detail.resultText) history.push({ role: 'assistant', content: detail.resultText })
    }
    await sleep(PACE)
  }
  return { pass: failures.length === 0, failures, outcome: outcomes }
}

async function main() {
  const cases = CASES.filter(c => (!ONLY_GROUP || c.group === ONLY_GROUP) && (!ONLY_ID || c.id === ONLY_ID))
  console.log(`Coach eval · model ${MODEL_ID} · ${cases.length} cases × ${RUNS} runs · pass = ≥${NEED}/${RUNS}\n`)

  const results: Record<string, RunRecord[]> = {}
  for (const c of cases) {
    const runs: RunRecord[] = []
    for (let r = 0; r < RUNS; r++) {
      try {
        runs.push(await runCase(c))
      } catch (err: any) {
        runs.push({ pass: false, failures: [`error: ${String(err?.message ?? err).slice(0, 160)}`], outcome: [] })
      }
    }
    results[c.id] = runs
    // Written after every case so a crash or a killed run loses nothing.
    if (OUT) writeFileSync(OUT, JSON.stringify({ model: MODEL_ID, runs: RUNS, results }, null, 2))
    const passes = runs.filter(r => r.pass).length
    const mark = passes >= NEED ? (passes === RUNS ? 'PASS ' : 'flaky') : 'FAIL '
    console.log(`${mark} ${c.id.padEnd(4)} ${passes}/${RUNS}  ${c.turns[0]!.prompt.replace(/\s+/g, ' ').slice(0, 58)}`)
    for (const f of [...new Set(runs.flatMap(r => r.failures))].slice(0, 4)) console.log(`        · ${f}`)
  }

  // Summary
  console.log('\n── by group ──')
  const all: RunRecord[] = []
  for (const g of ['A', 'B', 'C', 'D']) {
    const ids = cases.filter(c => c.group === g)
    if (!ids.length) continue
    const casePass = ids.filter(c => results[c.id]!.filter(r => r.pass).length >= NEED).length
    const runPass = ids.reduce((n, c) => n + results[c.id]!.filter(r => r.pass).length, 0)
    const runTotal = ids.length * RUNS
    console.log(`${g}: ${casePass}/${ids.length} cases pass · ${runPass}/${runTotal} runs pass (${Math.round((runPass / runTotal) * 100)}%)`)
  }
  for (const c of cases) all.push(...results[c.id]!)
  const outs = all.flatMap(r => r.outcome)
  const ms = outs.map(o => o.ms).sort((a, b) => a - b)
  const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))] ?? 0
  console.log(`\nlatency p50 ${q(0.5)}ms · p95 ${q(0.95)}ms · retried-without-tools ${outs.filter(o => o.retried).length}/${outs.length} · hit token ceiling ${outs.filter(o => o.finish === 'length').length}`)
  const flaky = cases.filter(c => { const p = results[c.id]!.filter(r => r.pass).length; return p > 0 && p < RUNS })
  console.log(`flaky cases (passed some runs, not all): ${flaky.map(c => c.id).join(', ') || 'none'}`)

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ model: MODEL_ID, runs: RUNS, results }, null, 2))
    console.log(`\nfull results → ${OUT}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
