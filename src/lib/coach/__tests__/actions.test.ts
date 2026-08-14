import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  encodeNdjson,
  parseCoachChatStreamLine,
  validateCreateDayInput,
  formatCreateDayMessage,
  resolveCreateDayFlex,
  validateEditExerciseInput,
  validateLogBodyWeightInput,
  validateSkipSetsInput,
  validateSetRestWeekdayInput,
  validateUpdateRotationInput,
  applySessionLogEdit,
  pickExerciseByName,
  parseDayOfWeek,
  parseCalendarDateKey,
  weightsMatch,
  isProposalExpired,
  fmtWeightForUnit,
  looksLikeCoachNdjson,
  shouldParseCoachNdjson,
  rehydrateCoachNdjson,
  type CoachSessionLogRow,
} from '../actions'
import { validateNotificationPrefsPatch } from '../../push/validatePrefs'

describe('coach actions helpers', () => {
  it('matches near-equal weights within float noise', () => {
    assert.equal(weightsMatch(90, 90), true)
    assert.equal(weightsMatch(90, 90.04), true)
    assert.equal(weightsMatch(90, 95), false)
  })

  it('formats display weights', () => {
    assert.equal(fmtWeightForUnit(95, 'lb'), '95 lb')
    assert.match(fmtWeightForUnit(220.46, 'kg'), /100 kg/)
  })

  it('detects expired proposals', () => {
    assert.equal(isProposalExpired(new Date(Date.now() - 1000).toISOString()), true)
    assert.equal(
      isProposalExpired(new Date(Date.now() + 60_000).toISOString()),
      false,
    )
  })

  it('validates create-day input', () => {
    const ok = validateCreateDayInput({
      dayKey: 'Upper',
      category: 'push',
      exercises: [
        { name: 'Bench', sets_target: 3, reps_target: '6-8', weight_target_lbs: 95 },
      ],
    })
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.dayKey, 'upper')
      assert.equal(ok.category, 'push')
      assert.equal(ok.flex, true)
      assert.equal(ok.exercises[0]!.name, 'Bench')
    }

    const rotation = validateCreateDayInput({
      dayKey: 'push 2',
      flex: false,
      exercises: [{ name: 'Bench', sets_target: 3, reps_target: '6-8' }],
    })
    assert.equal(rotation.ok, true)
    if (rotation.ok) assert.equal(rotation.flex, false)

    assert.equal(resolveCreateDayFlex(undefined), true)
    assert.equal(resolveCreateDayFlex(null), true)
    assert.equal(resolveCreateDayFlex(true), true)
    assert.equal(resolveCreateDayFlex(false), false)
    assert.equal(
      formatCreateDayMessage('home abs', 4, true),
      'Created “home abs” with 4 exercises as a flex day.',
    )
    assert.equal(
      formatCreateDayMessage('push 2', 1, false),
      'Created “push 2” with 1 exercise.',
    )
    assert.equal(
      formatCreateDayMessage('home abs', 4, true).includes('automatically'),
      false,
    )

    const bad = validateCreateDayInput({
      dayKey: '',
      exercises: [],
    })
    assert.equal(bad.ok, false)

    const collide = validateCreateDayInput({
      dayKey: 'push!!!',
      exercises: [{ name: 'A', sets_target: 3, reps_target: '8' }],
    })
    assert.equal(collide.ok, false)
  })

  it('fuzzy-matches a single exercise by name', () => {
    const rows = [
      { id: '1', name: 'Bench Press' },
      { id: '2', name: 'Squat' },
    ]
    const exact = pickExerciseByName(rows, 'bench press')
    assert.equal(exact.ok, true)
    if (exact.ok) assert.equal(exact.exercise.id, '1')

    const partial = pickExerciseByName(rows, 'bench')
    assert.equal(partial.ok, true)

    const miss = pickExerciseByName(rows, 'deadlift')
    assert.equal(miss.ok, false)

    const empty = pickExerciseByName(rows, '  ')
    assert.equal(empty.ok, false)
  })

  it('validates body-weight log input', () => {
    const ok = validateLogBodyWeightInput({
      weight: 180,
      unit: 'lb',
      today: '2026-08-14',
    })
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.weightLbs, 180)
      assert.equal(ok.recordedAt, '2026-08-14')
    }

    const dated = validateLogBodyWeightInput({
      weight: 82,
      unit: 'kg',
      date: '2026-08-13',
      today: '2026-08-14',
    })
    assert.equal(dated.ok, true)

    const future = validateLogBodyWeightInput({
      weight: 180,
      unit: 'lb',
      date: '2026-08-20',
      today: '2026-08-14',
    })
    assert.equal(future.ok, false)

    const bad = validateLogBodyWeightInput({
      weight: 0,
      unit: 'lb',
      today: '2026-08-14',
    })
    assert.equal(bad.ok, false)
  })

  it('validates skip-set input', () => {
    const sets = validateSkipSetsInput({
      exerciseName: 'Bench',
      scope: 'sets',
      setNumbers: [1, 3, 3],
      skip: true,
    })
    assert.equal(sets.ok, true)
    if (sets.ok) assert.deepEqual(sets.setNumbers, [1, 3])

    const missing = validateSkipSetsInput({
      exerciseName: 'Bench',
      scope: 'sets',
      skip: true,
    })
    assert.equal(missing.ok, false)

    const whole = validateSkipSetsInput({
      exerciseName: 'Squat',
      scope: 'exercise',
      skip: false,
    })
    assert.equal(whole.ok, true)
  })

  it('parses rest weekdays and set-rest-weekday input', () => {
    assert.equal(parseDayOfWeek('Sunday'), 0)
    assert.equal(parseDayOfWeek('thu'), 4)
    assert.equal(parseDayOfWeek(6), 6)
    assert.equal(parseDayOfWeek('nope'), null)
    assert.equal(parseCalendarDateKey('2026-02-30'), null)
    assert.equal(parseCalendarDateKey('2026-08-14'), '2026-08-14')

    const ok = validateSetRestWeekdayInput({
      dayOfWeek: 'Sunday',
      enabled: true,
      localDate: '2026-08-16', // Sunday
    })
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.dayOfWeek, 0)
      assert.equal(ok.isTodayWeekday, true)
    }
  })

  it('validates edit-exercise input with the 1–20 sets ceiling', () => {
    const ok = validateEditExerciseInput({
      exerciseName: 'Bench',
      dayType: 'Push',
      sets_target: 16,
    })
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.dayType, 'push')
      assert.equal(ok.patch.sets_target, 16)
    }

    const tooMany = validateEditExerciseInput({
      exerciseName: 'Bench',
      dayType: 'push',
      sets_target: 21,
    })
    assert.equal(tooMany.ok, false)

    const empty = validateEditExerciseInput({
      exerciseName: 'Bench',
      dayType: 'push',
    })
    assert.equal(empty.ok, false)
  })

  it('validates rotation input against known days', () => {
    const auto = validateUpdateRotationInput({
      mode: 'auto',
      dayKeys: ['push', 'pull'],
    })
    assert.equal(auto.ok, true)

    const manual = validateUpdateRotationInput({
      mode: 'manual',
      sequence: ['push', 'pull', 'push'],
      dayKeys: ['push', 'pull'],
    })
    assert.equal(manual.ok, true)

    const unknown = validateUpdateRotationInput({
      mode: 'manual',
      sequence: ['cardio'],
      dayKeys: ['push'],
    })
    assert.equal(unknown.ok, false)
  })

  it('applies a session-log edit without dropping untouched sets', () => {
    const logs: CoachSessionLogRow[] = [
      {
        exercise_id: 'ex1',
        set_number: 1,
        weight: 135,
        reps: 8,
        is_warmup: true,
        is_skipped: false,
        note: null,
        rpe: 5,
      },
      {
        exercise_id: 'ex1',
        set_number: 2,
        weight: 185,
        reps: 5,
        is_warmup: false,
        is_skipped: false,
        note: 'paused',
        rpe: 8,
      },
      {
        exercise_id: 'ex2',
        set_number: 1,
        weight: 155,
        reps: 8,
        is_warmup: false,
        is_skipped: false,
        note: null,
        rpe: null,
      },
    ]

    const edited = applySessionLogEdit(
      logs,
      { exerciseId: 'ex1', setNumber: 2 },
      { reps: 8 },
    )
    assert.equal(edited.ok, true)
    if (edited.ok) {
      assert.equal(edited.logs.length, 3)
      assert.equal(edited.changed.reps, 8)
      assert.equal(edited.changed.weight, 185)
      assert.equal(edited.changed.note, 'paused')
      assert.equal(edited.logs[0]!.reps, 8)
      assert.equal(edited.logs[0]!.is_warmup, true)
      assert.equal(edited.logs[2]!.weight, 155)
      assert.equal(logs[1]!.reps, 5, 'must not mutate the input array')
    }

    const miss = applySessionLogEdit(
      logs,
      { exerciseId: 'ex1', setNumber: 9 },
      { reps: 8 },
    )
    assert.equal(miss.ok, false)

    const skipped: CoachSessionLogRow[] = [
      ...logs.slice(0, 2),
      {
        exercise_id: 'ex1',
        set_number: 3,
        weight: null,
        reps: null,
        is_warmup: false,
        is_skipped: true,
        note: null,
        rpe: null,
      },
    ]
    const unskip = applySessionLogEdit(
      skipped,
      { exerciseId: 'ex1', setNumber: 3 },
      { weightLbs: 175, reps: 6 },
    )
    assert.equal(unskip.ok, true)
    if (unskip.ok) {
      assert.equal(unskip.changed.is_skipped, false)
      assert.equal(unskip.changed.weight, 175)
      assert.equal(unskip.changed.reps, 6)
    }

    const dropLast = applySessionLogEdit(
      [
        {
          exercise_id: 'ex1',
          set_number: 1,
          weight: 185,
          reps: 5,
          is_warmup: false,
          is_skipped: false,
          note: null,
          rpe: null,
        },
      ],
      { exerciseId: 'ex1', setNumber: 1 },
      { isWarmup: true },
    )
    assert.equal(dropLast.ok, false)
  })

  it('validates notification preference patches', () => {
    const ok = validateNotificationPrefsPatch({
      enabled: true,
      streak_reminder_hour: 18,
      timezone: 'America/New_York',
    })
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.patch.streak_reminder_hour, 18)
      assert.equal(ok.patch.timezone, 'America/New_York')
    }

    const badHour = validateNotificationPrefsPatch({ streak_reminder_hour: 12 })
    assert.equal(badHour.ok, false)

    const badTz = validateNotificationPrefsPatch({ timezone: 'Not/AZone' })
    assert.equal(badTz.ok, false)
  })

  it('encodes and parses NDJSON chat stream lines', () => {
    const line = encodeNdjson({ type: 'text-delta', text: 'Hi' })
    assert.equal(line.endsWith('\n'), true)
    const parsed = parseCoachChatStreamLine(line)
    assert.deepEqual(parsed, { type: 'text-delta', text: 'Hi' })

    const proposal = parseCoachChatStreamLine(
      JSON.stringify({
        type: 'proposal',
        proposal: {
          id: 'p1',
          kind: 'start_workout',
          status: 'pending',
          card: { title: 'Start', summaryLines: ['push'] },
          expiresAt: new Date().toISOString(),
        },
      }),
    )
    assert.equal(proposal?.type, 'proposal')

    const plain = parseCoachChatStreamLine('hello world')
    assert.deepEqual(plain, { type: 'text-delta', text: 'hello world' })

    // Incomplete JSON mid-stream must not become literal text
    assert.equal(parseCoachChatStreamLine('{"type":"text-delta","text":"To'), null)
  })

  it('sniffs NDJSON even without the custom header', () => {
    const sample =
      '{"type":"text-delta","text":"To"}\n{"type":"text-delta","text":" build"}\n'
    assert.equal(looksLikeCoachNdjson(sample), true)
    assert.equal(
      shouldParseCoachNdjson({
        contentType: 'text/plain',
        streamHeader: null,
        sample,
      }),
      true,
    )
    assert.equal(
      shouldParseCoachNdjson({
        contentType: 'application/x-ndjson; charset=utf-8',
        streamHeader: null,
      }),
      true,
    )
    assert.equal(looksLikeCoachNdjson('Just a normal coach reply.'), false)
  })

  it('rehydrates a dumped NDJSON transcript into prose', () => {
    const raw = [
      encodeNdjson({ type: 'text-delta', text: 'To build ' }),
      encodeNdjson({ type: 'text-delta', text: 'prominent abs.' }),
      encodeNdjson({ type: 'done' }),
    ].join('')
    const recovered = rehydrateCoachNdjson(raw)
    assert.equal(recovered.text, 'To build prominent abs.')
    assert.equal(recovered.proposals.length, 0)
  })
})
