import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBatches,
  chooseZone,
  dateInZone,
  etcZone,
  localToIso,
  parseAppleSamples,
  GARMIN_EXPORT_FILE,
  parseGarminExportText,
  parseGarminHealthStatusText,
  parseGarminNight,
  toIso,
  withExportHrv
} from '../importers'
import { mainSleep, type SleepSession } from '../model'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const NOW = new Date('2026-11-17T15:00:00Z')

// Shapes follow the community-documented Garmin Connect format; synthetic values only.
const apiNight = {
  dailySleepDTO: {
    calendarDate: '2026-11-16',
    sleepTimeSeconds: 26280,
    sleepStartTimestampGMT: Date.parse('2026-11-16T05:24:00Z'),
    sleepEndTimestampGMT: Date.parse('2026-11-16T13:24:00Z'),
    sleepStartTimestampLocal: Date.parse('2026-11-15T23:24:00Z'), // local-as-UTC, Chicago (-6h)
    deepSleepSeconds: 5400,
    lightSleepSeconds: 14400,
    remSleepSeconds: 6480,
    awakeSleepSeconds: 2520,
    averageRespirationValue: 14.2,
    averageSpO2Value: 95,
    sleepScores: { overall: { value: 81 } }
  },
  avgOvernightHrv: 48,
  sleepLevels: [
    { startGMT: '2026-11-16T05:24:00.0', endGMT: '2026-11-16T06:00:00.0', activityLevel: 3.0 },
    { startGMT: '2026-11-16T06:00:00.0', endGMT: '2026-11-16T07:30:00.0', activityLevel: 1.0 },
    { startGMT: '2026-11-16T07:30:00.0', endGMT: '2026-11-16T08:30:00.0', activityLevel: 0.0 },
    { startGMT: '2026-11-16T08:25:00.0', endGMT: '2026-11-16T10:00:00.0', activityLevel: 2.0 } // overlaps by 5 min
  ]
}
const exportNight = {
  calendarDate: '2026-11-16',
  sleepStartTimestampGMT: '2026-11-16T05:24:00.0',
  sleepEndTimestampGMT: '2026-11-16T13:24:00.0',
  deepSleepSeconds: 5400,
  lightSleepSeconds: 14400,
  remSleepSeconds: 6480,
  awakeSleepSeconds: 2520,
  averageRespiration: 14,
  sleepScores: { overallScore: 79 }
}

describe('Garmin sleep parsing', () => {
  it('maps a Connect response: totals, stages, score, HRV, respiration and SpO2', () => {
    const r = parseGarminNight(apiNight, 'garmin_unofficial', { now: NOW })
    assert.ok(r.ok)
    const n = r.night
    assert.equal(n.wake_date, '2026-11-16')
    assert.equal(n.timezone, 'Etc/GMT+6') // from the local/GMT offset, no guessing
    assert.equal(n.duration_seconds, 26280)
    assert.deepEqual(n.stage_totals, { deep: 5400, light: 14400, rem: 6480, awake: 2520 })
    assert.equal(n.score, 81)
    assert.equal(n.overnight_hrv, 48)
    assert.equal(n.respiration, 14.2)
    assert.equal(n.spo2, 95)
    assert.equal(n.status, 'final')
    assert.deepEqual(
      n.stages?.map((s) => s.stage),
      ['awake', 'light', 'deep', 'rem']
    )
    // the 5-minute overlap is trimmed so the timeline satisfies the schema
    assert.equal(n.stages?.[3].start, '2026-11-16T08:30:00.000Z')
  })

  it('maps an export night (totals only) and keeps the stage timeline honest as null', () => {
    const r = parseGarminExportText(
      JSON.stringify([exportNight, { calendarDate: '2026-11-15', deepSleepSeconds: 60 }]),
      { now: NOW, fallbackZone: 'America/Chicago' }
    )
    assert.equal(r.nights.length, 1)
    assert.equal(r.nights[0].stages, null)
    assert.equal(r.nights[0].score, 79)
    assert.equal(r.nights[0].timezone, 'America/Chicago')
    assert.deepEqual(
      r.skipped.map((s) => s.reason),
      ['No sleep start/end time']
    )
  })

  // Field layout copied from a real export (Nov 2026); values are synthetic.
  const realExportDays = [
    {
      ...exportNight,
      sleepWindowConfirmationType: 'ENHANCED_CONFIRMED_FINAL',
      unmeasurableSeconds: 0,
      spo2SleepSummary: { averageSPO2: 95.5, averageHR: 63, lowestSPO2: 82 },
      napList: [
        {
          napTimeSec: 2640,
          napStartTimestampGMT: '2026-11-16T21:45:00.0',
          napEndTimestampGMT: '2026-11-16T22:29:00.0',
          calendarDate: '2026-11-16'
        }
      ],
      retro: false
    },
    { retro: false }, // a day the watch wasn't worn
    {
      napList: [
        {
          napTimeSec: 1500,
          napStartTimestampGMT: '2026-11-17T20:00:00.0',
          napEndTimestampGMT: '2026-11-17T20:30:00.0',
          calendarDate: '2026-11-17'
        }
      ],
      retro: false
    }
  ]

  it('reads SpO2 and naps from a real export layout, and stays quiet about empty days', () => {
    const r = parseGarminExportText(JSON.stringify(realExportDays), {
      now: new Date('2026-11-18T12:00:00Z'),
      fallbackZone: 'America/Chicago'
    })
    assert.deepEqual(r.skipped, [])
    assert.deepEqual(
      r.nights.map((n) => [n.kind, n.wake_date]),
      [
        ['main', '2026-11-16'],
        ['nap', '2026-11-16'],
        ['nap', '2026-11-17']
      ]
    )
    assert.equal(r.nights[0].spo2, 95.5)
    const nap = r.nights[1]
    assert.equal(nap.duration_seconds, 2640)
    assert.equal(nap.stages, null)
    assert.notEqual(nap.provider_id, r.nights[0].provider_id)
  })

  it('takes overnight HRV from healthStatusData by calendar date, mains only', () => {
    const status = JSON.stringify([
      {
        calendarDate: '2026-11-16',
        metrics: [
          { type: 'HRV', value: 48, status: 'IN_RANGE' },
          { type: 'HR', value: 64 },
          { type: 'SKIN_TEMP_C', status: 'UNKNOWN' }
        ]
      },
      { calendarDate: '2026-11-17', metrics: [{ type: 'HRV', status: 'UNKNOWN' }] }
    ])
    const hrv = parseGarminHealthStatusText(status)
    assert.deepEqual([...hrv], [['2026-11-16', 48]])
    const { nights } = parseGarminExportText(JSON.stringify(realExportDays), {
      now: NOW,
      fallbackZone: 'America/Chicago'
    })
    const merged = withExportHrv(nights, hrv)
    assert.deepEqual(
      merged.map((n) => n.overnight_hrv),
      [48, null, null]
    )
    assert.equal(parseGarminHealthStatusText('nope').size, 0)
  })

  it('marks a night that just ended as provisional so a later revision can replace it', () => {
    const fresh = {
      ...exportNight,
      sleepEndTimestampGMT: '2026-11-17T13:30:00.0',
      sleepStartTimestampGMT: '2026-11-17T05:30:00.0',
      calendarDate: '2026-11-17'
    }
    const r = parseGarminNight(fresh, 'garmin_export', {
      now: new Date('2026-11-17T14:00:00Z'),
      fallbackZone: 'UTC'
    })
    assert.ok(r.ok && r.night.status === 'provisional')
  })

  it('rejects garbage instead of guessing', () => {
    assert.equal(parseGarminNight(null, 'garmin_export').ok, false)
    assert.equal(
      parseGarminNight({ sleepStartTimestampGMT: 5, sleepEndTimestampGMT: 4 }, 'garmin_export').ok,
      false
    )
    assert.equal(parseGarminExportText('not json').nights.length, 0)
  })

  it('handles timestamps in every form Garmin uses', () => {
    assert.equal(toIso(1763270640000), '2025-11-16T05:24:00.000Z')
    assert.equal(toIso(1763270640), '2025-11-16T05:24:00.000Z')
    assert.equal(toIso('2026-11-16T05:24:00.0'), '2026-11-16T05:24:00.000Z')
    assert.equal(toIso('2026-11-16T05:24:00-06:00'), '2026-11-16T11:24:00.000Z')
    assert.equal(toIso('nope'), null)
  })
})

describe('time zones, travel and DST', () => {
  it('names whole-hour offsets with the inverted Etc/GMT convention and refuses the rest', () => {
    assert.equal(etcZone(-360), 'Etc/GMT+6')
    assert.equal(etcZone(60), 'Etc/GMT-1')
    assert.equal(etcZone(0), 'UTC')
    assert.equal(etcZone(330), null) // India: no Etc zone exists
  })
  it('prefers the zone that agrees with the source’s own calendar date', () => {
    const end = '2026-11-16T05:30:00Z' // 23:30 on the 15th in Chicago, 11:00 on the 16th in India
    assert.equal(
      chooseZone(end, '2026-11-15', ['Asia/Kolkata', 'America/Chicago']),
      'America/Chicago'
    )
    assert.equal(chooseZone(end, '2026-11-16', ['America/Chicago', 'Asia/Kolkata']), 'Asia/Kolkata')
  })
  it('keeps a fall-back DST night on the right date', () => {
    // 2026-11-01 US fall-back: a night ending 06:30Z is 00:30 CDT... or 23:30 CST depending on the side.
    assert.equal(dateInZone('2026-11-01T06:30:00Z', 'America/Chicago'), '2026-11-01')
    assert.equal(dateInZone('2026-11-01T05:30:00Z', 'America/Chicago'), '2026-11-01')
    assert.equal(dateInZone('2026-11-01T04:59:00Z', 'America/Chicago'), '2026-10-31')
  })
})

describe('Apple Health sleep samples', () => {
  const s = (start: string, end: string, value: string) => ({ start, end, value })
  const night = [
    s('2026-11-15T23:24:00-06:00', '2026-11-15T23:40:00-06:00', 'Awake'),
    s('2026-11-15T23:40:00-06:00', '2026-11-16T01:10:00-06:00', 'Core'),
    s('2026-11-16T01:10:00-06:00', '2026-11-16T02:10:00-06:00', 'Deep'),
    s('2026-11-16T02:10:00-06:00', '2026-11-16T03:30:00-06:00', 'REM'),
    s('2026-11-16T03:30:00-06:00', '2026-11-16T07:24:00-06:00', 'Core'),
    s('2026-11-15T23:20:00-06:00', '2026-11-16T07:30:00-06:00', 'In Bed')
  ]
  it('groups stage samples into one night with a timeline, ignoring In Bed for sleep time', () => {
    const { nights } = parseAppleSamples(night, { now: NOW })
    assert.equal(nights.length, 1)
    const n = nights[0]
    assert.equal(n.kind, 'main')
    assert.equal(n.wake_date, '2026-11-16')
    assert.equal(n.timezone, 'Etc/GMT+6') // derived from the sample offsets
    assert.equal(n.duration_seconds, (90 + 60 + 80 + 234) * 60) // excludes the 16 awake minutes
    assert.equal(n.stages?.length, 5)
    assert.equal(n.stage_totals?.awake, 16 * 60)
    assert.equal(n.overnight_hrv, null) // never imported from Apple Health
    assert.equal(n.score, null)
  })
  it('uses a named timezone when the Shortcut sends one', () => {
    assert.equal(
      parseAppleSamples(night, { timezone: 'America/Chicago', now: NOW }).nights[0].timezone,
      'America/Chicago'
    )
    assert.equal(
      parseAppleSamples(night, { timezone: 'Not/AZone', now: NOW }).nights[0].timezone,
      'Etc/GMT+6'
    )
  })
  it('does not invent stages from legacy unspecified "Asleep" samples', () => {
    const { nights } = parseAppleSamples(
      [s('2026-11-16T05:00:00Z', '2026-11-16T12:30:00Z', 'Asleep')],
      { timezone: 'UTC', now: NOW }
    )
    assert.equal(nights[0].stages, null)
    assert.equal(nights[0].stage_totals, null)
    assert.equal(nights[0].duration_seconds, 7.5 * 3600)
  })
  it('separates a nap, and trims double-written overlapping samples', () => {
    const { nights } = parseAppleSamples(
      [
        ...night,
        s('2026-11-16T07:24:00-06:00', '2026-11-16T07:40:00-06:00', 'Core'), // duplicate writer overlap
        s('2026-11-16T14:00:00-06:00', '2026-11-16T14:45:00-06:00', 'Core')
      ],
      { now: NOW }
    )
    assert.deepEqual(nights.map((n) => n.kind).sort(), ['main', 'nap'])
  })
  it('reads a time with no offset as wall-clock time in the supplied zone, not UTC', () => {
    const naive = [
      s('2026-11-15T23:40:00', '2026-11-16T03:30:00', 'Core'),
      s('2026-11-16T03:30:00', '2026-11-16T07:24:00', 'REM')
    ]
    const n = parseAppleSamples(naive, { timezone: 'America/Chicago', now: NOW }).nights[0]
    assert.equal(n.start_at, '2026-11-16T05:40:00.000Z') // 23:40 CST
    assert.equal(n.wake_date, '2026-11-16')
    // across a DST change the same wall time lands on the right side of the offset change
    assert.equal(
      localToIso('2026-11-01T01:30:00', 'America/Chicago')?.slice(0, 13),
      '2026-11-01T06'
    )
    assert.equal(localToIso('2026-07-01T23:00:00', 'America/Chicago'), '2026-07-02T04:00:00.000Z')
    assert.equal(localToIso('not a date', 'America/Chicago'), null)
  })
  it('recognises the stage names iOS reports in several spellings', () => {
    const values = [
      'Core',
      'Asleep (Core)',
      'Asleep (Deep)',
      'REM',
      'Awake',
      'In Bed',
      'Asleep',
      'Asleep (Unspecified)'
    ]
    const base = Date.parse('2026-11-16T01:00:00Z')
    const r = parseAppleSamples(
      values.map((v, i) => ({
        start: new Date(base + i * 3600000).toISOString(),
        end: new Date(base + (i + 1) * 3600000).toISOString(),
        value: v
      })),
      { timezone: 'UTC', now: NOW }
    )
    assert.equal(r.nights.length, 1)
    // In Bed is ignored for sleep time (7 other hours), and stages exist for the typed ones only
    assert.equal(r.nights[0].duration_seconds, 6 * 3600) // all but In Bed and Awake
  })
  it('skips fragments too short to be sleep', () => {
    const r = parseAppleSamples([s('2026-11-16T05:00:00Z', '2026-11-16T05:10:00Z', 'Core')], {
      now: NOW
    })
    assert.equal(r.nights.length, 0)
    assert.match(r.skipped[0].reason, /short/)
  })
})

describe('batches', () => {
  it('drops nights older than 180 days, validates, and chunks 14 per batch', () => {
    const parsed = Array.from({ length: 20 }, (_, i) => {
      const day = new Date(NOW.getTime() - (i + 1) * 86400000)
      const d = day.toISOString().slice(0, 10)
      return parseGarminNight(
        {
          ...exportNight,
          calendarDate: d,
          sleepStartTimestampGMT: `${d}T05:00:00.0`,
          sleepEndTimestampGMT: `${d}T13:00:00.0`
        },
        'garmin_export',
        { now: NOW, fallbackZone: 'UTC' }
      )
    })
    const old = parseGarminNight(
      {
        ...exportNight,
        calendarDate: '2025-01-02',
        sleepStartTimestampGMT: '2025-01-02T05:00:00.0',
        sleepEndTimestampGMT: '2025-01-02T13:00:00.0'
      },
      'garmin_export',
      { now: NOW, fallbackZone: 'UTC' }
    )
    const nights = [...parsed, old].map((p) => (p.ok ? p.night : null)).filter((n) => n !== null)
    let id = 0
    const r = buildBatches(
      nights,
      'garmin_export',
      NOW,
      () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`
    )
    assert.equal(r.accepted, 20)
    assert.deepEqual(
      r.batches.map((b) => b.sleeps.length),
      [14, 6]
    )
    assert.match(r.skipped[0].reason, /180-day/)
    assert.ok(r.batches.every((b) => b.source === 'garmin_export' && b.samples.length === 0))
  })
})

describe('merging sources for one night', () => {
  const base = (over: Partial<SleepSession>): SleepSession => ({
    provider_id: 'x',
    source: 'garmin_export',
    device_id: 'import',
    wake_date: '2026-11-16',
    provider_date: '2026-11-16',
    timezone: 'UTC',
    start_at: '2026-11-16T05:24:00Z',
    end_at: '2026-11-16T13:24:00Z',
    kind: 'main',
    duration_seconds: 26280,
    score: null,
    stages: null,
    stage_totals: null,
    overnight_hrv: null,
    respiration: null,
    spo2: null,
    revision_at: '2026-11-17T01:00:00Z',
    received_at: '2026-11-17T01:00:00Z',
    status: 'final',
    ...over
  })
  const stages = [
    { stage: 'light' as const, start: '2026-11-16T05:30:00Z', end: '2026-11-16T09:00:00Z' }
  ]
  it('shows the highest-ranked source and fills missing fields from the others, with provenance', () => {
    const merged = mainSleep(
      [
        base({
          provider_id: 'g',
          source: 'garmin_export',
          score: 79,
          respiration: 14,
          stage_totals: { deep: 5400 }
        }),
        base({
          provider_id: 'a',
          source: 'apple_health',
          stages,
          stage_totals: { light: 12000 },
          start_at: '2026-11-16T05:20:00Z'
        })
      ],
      '2026-11-16'
    )!
    assert.equal(merged.source, 'garmin_export')
    assert.equal(merged.score, 79)
    assert.deepEqual(merged.stage_totals, { deep: 5400 }) // winner's own totals are never replaced
    assert.equal(merged.stages?.length, 1)
    assert.deepEqual(merged.fields_from, { stages: 'apple_health' })
  })
  it('never merges a different night, a nap, or a stale revision from the same source', () => {
    const other = base({
      provider_id: 'o',
      source: 'apple_health',
      stages,
      start_at: '2026-11-16T15:00:00Z',
      end_at: '2026-11-16T16:00:00Z'
    })
    const only = mainSleep([base({ score: 70 }), other], '2026-11-16')!
    assert.equal(only.fields_from, undefined)
    const oldRevision = base({ provider_id: 'old', score: 10, revision_at: '2026-11-16T09:00:00Z' })
    assert.equal(mainSleep([oldRevision, base({ score: 70 })], '2026-11-16')!.score, 70)
  })
})

describe('reading a real-looking Garmin export zip', () => {
  it('inflates only the sleep and health-status files, however deep, and ignores everything else', () => {
    const zip = zipSync({
      'DI_CONNECT/DI-Connect-Wellness/2026-01-01_2026-04-10_9_sleepData.json': strToU8(
        JSON.stringify([exportNight])
      ),
      'DI_CONNECT/DI-Connect-Wellness/2026-01-01_2026-04-10_9_healthStatusData.json': strToU8('[]'),
      'DI_CONNECT/DI-Connect-Wellness/2026-01-01_2026-04-10_9_UDSFile.json': strToU8('[]'),
      'DI_CONNECT/DI-Connect-Fitness/activity.fit': new Uint8Array(1000)
    })
    const entries = unzipSync(zip, { filter: (e) => GARMIN_EXPORT_FILE.test(e.name) })
    assert.deepEqual(Object.keys(entries).sort(), [
      'DI_CONNECT/DI-Connect-Wellness/2026-01-01_2026-04-10_9_healthStatusData.json',
      'DI_CONNECT/DI-Connect-Wellness/2026-01-01_2026-04-10_9_sleepData.json'
    ])
    const r = parseGarminExportText(strFromU8(entries['DI_CONNECT/DI-Connect-Wellness/2026-01-01_2026-04-10_9_sleepData.json']), {
      now: NOW,
      fallbackZone: 'UTC'
    })
    assert.equal(r.nights.length, 1)
  })
})
