import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildCoachContext } from '../buildContext'
import { loadCoachBody, restingRiseStreak, summarizeCoachBody } from '../bodyContext'
import { buildCoachSystemPrompt, userDataHasBody } from '../prompt'
import { planCoachTurn } from '../turn'
import { DEFAULT_BODY_PREFS, type BodySummary } from '../../body/queries'
import { computeCharge } from '../../body/charge'
import { loadBalance } from '../../body/load'
import type { DailyBody, LoadSession } from '../../body/types'
import type { DatedHrSet } from '../../body/cardioCost'

const TODAY = '2026-11-09'

function shift(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 35 days of watch data; resting HR runs +6 bpm for the last `riseDays` days. */
function days(riseDays = 0, todayWake = 38): DailyBody[] {
  return Array.from({ length: 35 }, (_, i) => {
    const date = shift(TODAY, i - 34)
    const ago = 34 - i
    return {
      local_date: date,
      bb_high: 80,
      bb_low: 20,
      bb_latest: 40,
      bb_wake: ago === 0 ? todayWake : 75,
      stress_avg: 30,
      resting_hr: ago < riseDays ? 58 : 52,
      recovery_hours: ago === 0 ? 20 : 6,
    }
  })
}

function sessions(): LoadSession[] {
  return Array.from({ length: 10 }, (_, i) => ({
    local_date: shift(TODAY, -i * 3),
    started_at: `${shift(TODAY, -i * 3)}T17:00:00Z`,
    completed_at: `${shift(TODAY, -i * 3)}T18:00:00Z`,
    zone_seconds: [600, 1200, 900, 300, 60],
  }))
}

function summary(over: Partial<BodySummary> = {}, rise = 0, wake = 38): BodySummary {
  const d = days(rise, wake)
  const s = sessions()
  return {
    available: true,
    hasWatch: true,
    today: TODAY,
    days: d,
    todayRow: d[d.length - 1]!,
    sessions: s,
    charge: computeCharge(d, s, TODAY),
    load: loadBalance(s, TODAY),
    prefs: DEFAULT_BODY_PREFS,
    ...over,
  }
}

/** Bench at the same weight: peak HR ~150 two months ago, ~140 this week. */
function hrSets(): DatedHrSet[] {
  const set = (date: string, peak: number): DatedHrSet => ({
    exercise_id: 'bench',
    exercise_name: 'Barbell Bench Press',
    set_number: 1,
    weight: 135,
    reps: 8,
    hr_peak: peak,
    hr_end: null,
    hr_rest_drop_60: null,
    local_date: date,
  })
  return [
    set(shift(TODAY, -60), 150), set(shift(TODAY, -58), 151), set(shift(TODAY, -55), 149),
    set(shift(TODAY, -6), 141), set(shift(TODAY, -3), 140), set(shift(TODAY, -1), 139),
  ]
}

const WATCH = [
  {
    local_date: shift(TODAY, -1),
    day_type: 'push',
    avg_heart_rate: 118,
    max_heart_rate: 164,
    zone_seconds: [600, 1200, 900, 300, 60],
    sets: [
      { exercise_id: 'bench', exercise_name: 'Barbell Bench Press', set_number: 3, weight: 135, reps: 8, hr_peak: 164, hr_end: 150, hr_rest_drop_60: 30 },
    ],
  },
]

describe('summarizeCoachBody', () => {
  const block = summarizeCoachBody({ summary: summary(), watchSessions: WATCH, hrSets: hrSets(), unit: 'lbs' })

  it("carries today's Charge with its inputs", () => {
    assert.ok(block.charge_today)
    assert.equal(block.charge_today!.band, 'Steady')
    assert.ok(block.charge_today!.inputs.some(i => i.label === 'Body Battery' && i.value === '38'))
  })

  it('has seven days of Charge and resting HR, today last', () => {
    assert.equal(block.last_7_days.length, 7)
    assert.equal(block.last_7_days[6]!.date, TODAY)
    assert.equal(block.last_7_days[6]!.charge, block.charge_today!.score)
  })

  it('summarises recent watch sessions and cardio cost', () => {
    assert.equal(block.watch_sessions?.[0]?.minutes_z3_plus, 21)
    assert.match(block.watch_sessions?.[0]?.hardest ?? '', /bench press set 3 at 164 bpm/)
    assert.equal(block.cardio_cost?.[0]?.delta_bpm, 10)
    assert.equal(block.cardio_cost?.[0]?.at, '135 lb × 8')
  })

  it('writes cardio-cost weights in kg for kg users', () => {
    const kg = summarizeCoachBody({ summary: summary(), watchSessions: [], hrSets: hrSets(), unit: 'kg' })
    assert.equal(kg.cardio_cost?.[0]?.at, '61.2 kg × 8')
  })

  it('stays within ~400 tokens', () => {
    const json = JSON.stringify(block)
    assert.ok(json.length < 2000, `body block is ${json.length} chars`)
  })
})

describe('restingRiseStreak', () => {
  it('counts consecutive days 5+ bpm over the 30-day usual', () => {
    assert.equal(restingRiseStreak(summary({}, 3)), 3)
    assert.equal(restingRiseStreak(summary({}, 0)), 0)
  })
})

// ── loadCoachBody / buildCoachContext against a fake Supabase ──────────────

type Result = { data: unknown; error: { message: string } | null; count?: number }

function chain(result: Result) {
  const self: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: Result) => unknown) => Promise.resolve(result).then(resolve)
      return () => self
    },
  })
  return self
}

function fakeClient(opts: { body: boolean; prefsOff?: boolean; bodyTableMissing?: boolean }) {
  const ok: Result = { data: null, error: null }
  const tables: Record<string, Result> = {
    exercises: { data: [], error: null },
    sessions: { data: opts.body ? sessions() : [], error: null },
    user_rest_days: { data: [], error: null },
    user_rest_dates: { data: [], error: null },
    user_flex_days: { data: [], error: null },
    user_day_categories: { data: [], error: null },
    body_weights: { data: [], error: null },
    session_logs: { data: [], error: null },
    daily_body: opts.bodyTableMissing
      ? { data: null, error: { message: 'relation "daily_body" does not exist' } }
      : { data: opts.body ? days(0) : [], error: null },
    body_prefs: { data: opts.prefsOff ? { coach_uses_body: false, smart_rest: false } : null, error: null },
  }
  return {
    from: (table: string) => chain(tables[table] ?? ok),
    rpc: () => chain(ok),
  }
}

describe('Coach body block in USER_DATA', () => {
  const OPTS = { asOfLocalDate: TODAY }

  it('is present for a watch user with Coach body data on', async () => {
    const ctx = await buildCoachContext(fakeClient({ body: true }) as never, 'u1', 'lbs', OPTS)
    assert.ok(ctx.body, 'expected a body block')
    assert.ok(userDataHasBody(JSON.stringify(ctx)))
  })

  it('is absent when the user has no watch data', async () => {
    const ctx = await buildCoachContext(fakeClient({ body: false }) as never, 'u1', 'lbs', OPTS)
    assert.equal('body' in ctx, false)
    assert.equal(userDataHasBody(JSON.stringify(ctx)), false)
  })

  it('is absent when "Coach uses body data" is off', async () => {
    assert.equal(await loadCoachBody(fakeClient({ body: true, prefsOff: true }) as never, 'u1', TODAY, 'lbs'), null)
    const ctx = await buildCoachContext(fakeClient({ body: true, prefsOff: true }) as never, 'u1', 'lbs', OPTS)
    assert.equal('body' in ctx, false)
  })

  it('fails soft when migration 59 is not applied', async () => {
    const ctx = await buildCoachContext(fakeClient({ body: false, bodyTableMissing: true }) as never, 'u1', 'lbs', OPTS)
    assert.equal('body' in ctx, false)
  })
})

describe('body rules in the system prompt', () => {
  const profile = { mechanics: false, toolPolicy: 'all' as const }

  it('are included only when USER_DATA has a body block', () => {
    const withBody = buildCoachSystemPrompt({ profile, userDataJson: '{"body":{"charge_today":null}}', recentActions: null, turnReminder: 'R' })
    const without = buildCoachSystemPrompt({ profile, userDataJson: '{"as_of_weekday":"Monday"}', recentActions: null, turnReminder: 'R' })
    assert.match(withBody, /<body_data>/)
    assert.doesNotMatch(without, /<body_data>/)
    assert.ok(withBody.indexOf('<body_data>') < withBody.indexOf('<user_data>'), 'rules before USER_DATA')
  })

  it('planCoachTurn picks the section up from USER_DATA', () => {
    const plan = planCoachTurn({ message: 'Should I train today?', history: [], userDataJson: '{"body":{"x":1}}', recentActions: null })
    assert.match(plan.system, /<body_data>/)
    const none = planCoachTurn({ message: 'Should I train today?', history: [], userDataJson: '{}', recentActions: null })
    assert.doesNotMatch(none.system, /<body_data>/)
  })
})
