import { sleepSchema, validateHealthBatch } from './ingestion'
import { validDate, type SleepStage, type SleepStageName } from './model'

/**
 * Turns what each sleep source actually hands us into the one record shape the
 * ingestion validates (`sleepSchema`). Three sources, three shapes:
 *
 *  - Garmin data export: one object per night, stage TOTALS but no timeline.
 *  - Garmin Connect response (via the owner-run sync script): the same plus a
 *    `sleepLevels` timeline, HRV and a score.
 *  - Apple Health (iPhone Shortcut): raw stage samples that we group into nights.
 *
 * The Garmin shapes follow the community-documented Garmin Connect format and
 * are parsed defensively: unknown or missing fields become null, an unusable
 * night is skipped with a reason, and nothing is guessed. Nothing here has been
 * verified against a live Garmin account, which is why the Settings screen shows
 * a preview before anything is saved.
 */

export type ImportSource = 'garmin_export' | 'garmin_unofficial' | 'apple_health'
export type ImportedNight = {
  provider_id: string
  wake_date: string
  provider_date: string
  timezone: string
  start_at: string
  end_at: string
  kind: 'main' | 'nap'
  duration_seconds: number
  score: number | null
  stages: SleepStage[] | null
  stage_totals: Partial<Record<SleepStageName, number>> | null
  overnight_hrv: number | null
  respiration: number | null
  spo2: number | null
  revision_at: string
  status: 'final' | 'provisional' | 'unknown'
}
export type Parsed = { ok: true; night: ImportedNight } | { ok: false; reason: string }

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** ms epoch, s epoch, or an ISO string with or without zone (no zone = UTC, as Garmin's GMT fields are). */
export function toIso(v: unknown): string | null {
  let ms: number
  if (typeof v === 'number' && Number.isFinite(v)) ms = v > 1e11 ? v : v * 1000
  else if (typeof v === 'string' && v.trim()) {
    const t = v.trim()
    ms = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(t) ? t : `${t.replace(' ', 'T')}Z`)
  } else return null
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** UTC offset (ms) of `zone` at the instant `utcMs`. */
function offsetMs(zone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(utcMs))
  const p = (t: string) => Number(parts.find((x) => x.type === t)?.value)
  return (
    Date.UTC(p('year'), p('month') - 1, p('day'), p('hour'), p('minute'), p('second')) -
    Math.floor(utcMs / 1000) * 1000
  )
}
/** "2026-11-16T07:24:00" (no offset) read as wall-clock time in `zone`; null if it isn't that shape. */
export function localToIso(text: string, zone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(text.trim())
  if (!m) return null
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
  try {
    let guess = naive - offsetMs(zone, naive)
    guess = naive - offsetMs(zone, guess) // second pass settles DST edges
    return new Date(guess).toISOString()
  } catch {
    return null
  }
}

export function dateInZone(iso: string, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(iso))
    const p = (t: string) => parts.find((x) => x.type === t)?.value
    return `${p('year')}-${p('month')}-${p('day')}`
  } catch {
    return null
  }
}

/** Whole-hour UTC offsets have an IANA name (note the inverted sign of Etc/GMT). */
export function etcZone(offsetMinutes: number): string | null {
  if (!Number.isFinite(offsetMinutes) || offsetMinutes % 60 !== 0) return null
  const hours = offsetMinutes / 60
  if (hours < -12 || hours > 14) return null
  return hours === 0 ? 'UTC' : `Etc/GMT${hours > 0 ? '-' : '+'}${Math.abs(hours)}`
}

/** First candidate zone whose calendar date for the wake time matches the source's own date. */
export function chooseZone(
  endIso: string,
  calendarDate: string | null,
  candidates: (string | null | undefined)[]
) {
  const zones = candidates.filter((z): z is string => !!z && dateInZone(endIso, z) !== null)
  const exact = calendarDate ? zones.find((z) => dateInZone(endIso, z) === calendarDate) : undefined
  return exact ?? zones[0] ?? 'UTC'
}

const GARMIN_LEVEL: Record<number, SleepStageName> = { 0: 'deep', 1: 'light', 2: 'rem', 3: 'awake' }

/** Clip, order and de-overlap a stage timeline so it always satisfies the schema. */
export function cleanStages(raw: SleepStage[], startIso: string, endIso: string): SleepStage[] {
  const lo = Date.parse(startIso),
    hi = Date.parse(endIso)
  const out: SleepStage[] = []
  let cursor = lo
  for (const s of [...raw].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const from = Math.max(Date.parse(s.start), cursor, lo)
    const to = Math.min(Date.parse(s.end), hi)
    if (!(to > from)) continue
    const prev = out.at(-1)
    if (prev && prev.stage === s.stage && Date.parse(prev.end) === from)
      prev.end = new Date(to).toISOString()
    else
      out.push({
        stage: s.stage,
        start: new Date(from).toISOString(),
        end: new Date(to).toISOString()
      })
    cursor = to
  }
  return out
}

function totalsFromStages(stages: SleepStage[]) {
  const t: Partial<Record<SleepStageName, number>> = {}
  for (const s of stages)
    t[s.stage] = (t[s.stage] ?? 0) + Math.round((Date.parse(s.end) - Date.parse(s.start)) / 1000)
  return t
}

/** One Garmin night: a Connect `dailySleepData` response or one object from the export. */
export function parseGarminNight(
  input: unknown,
  source: 'garmin_export' | 'garmin_unofficial',
  opts: { now?: Date; fallbackZone?: string } = {}
): Parsed {
  const root = rec(input)
  const d = Object.keys(rec(root.dailySleepDTO)).length ? rec(root.dailySleepDTO) : root
  const start = toIso(d.sleepStartTimestampGMT)
  const end = toIso(d.sleepEndTimestampGMT)
  if (!start || !end) return { ok: false, reason: 'No sleep start/end time' }
  if (!(Date.parse(end) > Date.parse(start)))
    return { ok: false, reason: 'Sleep ends before it starts' }
  const calendarDate = validDate(d.calendarDate as string) ? (d.calendarDate as string) : null

  const localStart = num(d.sleepStartTimestampLocal)
  const gmtStart = num(d.sleepStartTimestampGMT)
  const offsetZone =
    localStart != null && gmtStart != null && gmtStart > 1e11
      ? etcZone(Math.round((localStart - gmtStart) / 60000))
      : null
  const timezone = chooseZone(end, calendarDate, [offsetZone, opts.fallbackZone])
  const wake = dateInZone(end, timezone)
  if (!wake) return { ok: false, reason: 'Could not place the wake time on a date' }

  const totals: Partial<Record<SleepStageName, number>> = {}
  for (const [key, stage] of [
    ['deepSleepSeconds', 'deep'],
    ['lightSleepSeconds', 'light'],
    ['remSleepSeconds', 'rem'],
    ['awakeSleepSeconds', 'awake']
  ] as const) {
    const v = num(d[key])
    if (v != null && v >= 0) totals[stage] = Math.round(v)
  }
  const levels = Array.isArray(root.sleepLevels) ? root.sleepLevels : []
  const stages = cleanStages(
    levels.flatMap((l): SleepStage[] => {
      const lv = rec(l)
      const stage = GARMIN_LEVEL[Math.round(num(lv.activityLevel) ?? -1)]
      const from = toIso(lv.startGMT),
        to = toIso(lv.endGMT)
      return stage && from && to ? [{ stage, start: from, end: to }] : []
    }),
    start,
    end
  )
  const stageTotals = Object.keys(totals).length
    ? totals
    : stages.length
      ? totalsFromStages(stages)
      : null
  const asleep =
    num(d.sleepTimeSeconds) ??
    (stageTotals
      ? (stageTotals.deep ?? 0) + (stageTotals.light ?? 0) + (stageTotals.rem ?? 0)
      : null)
  if (asleep == null || asleep <= 0) return { ok: false, reason: 'No sleep duration recorded' }

  const scores = rec(d.sleepScores)
  const score = num(rec(scores.overall).value) ?? num(scores.overallScore) ?? num(d.overallScore)
  const now = opts.now ?? new Date()
  const endedAgo = now.getTime() - Date.parse(end)
  return {
    ok: true,
    night: {
      provider_id: `${source}:${calendarDate ?? wake}:${Math.floor(Date.parse(start) / 1000)}`,
      wake_date: wake,
      provider_date: calendarDate ?? wake,
      timezone,
      start_at: start,
      end_at: end,
      kind: asleep >= 3 * 3600 ? 'main' : 'nap',
      duration_seconds: Math.min(
        Math.round(asleep),
        Math.floor((Date.parse(end) - Date.parse(start)) / 1000)
      ),
      score: score != null && score >= 0 && score <= 100 ? Math.round(score) : null,
      stages: stages.length ? stages : null,
      stage_totals: stageTotals,
      overnight_hrv: inRange(num(root.avgOvernightHrv) ?? num(d.avgOvernightHrv), 1, 500),
      respiration: inRange(num(d.averageRespirationValue) ?? num(d.averageRespiration), 1, 80),
      spo2: inRange(num(d.averageSpO2Value) ?? num(d.averageSpo2), 50, 100),
      revision_at: now.toISOString(),
      status: endedAgo < 6 * 3600000 ? 'provisional' : 'final'
    }
  }
}
const inRange = (v: number | null, lo: number, hi: number) =>
  v != null && v >= lo && v <= hi ? v : null

/** The export's sleep file is an array (or `{ ... : [...] }`) of nights. */
export function parseGarminExportText(
  text: string,
  opts: { now?: Date; fallbackZone?: string } = {}
) {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { nights: [] as ImportedNight[], skipped: [{ key: 'file', reason: 'Not valid JSON' }] }
  }
  const list = Array.isArray(json)
    ? json
    : (Object.values(rec(json)).find((v) => Array.isArray(v) && v.length) ?? [])
  const nights: ImportedNight[] = []
  const skipped: { key: string; reason: string }[] = []
  ;(list as unknown[]).forEach((item, i) => {
    const r = parseGarminNight(item, 'garmin_export', opts)
    if (r.ok) nights.push(r.night)
    else skipped.push({ key: String(rec(item).calendarDate ?? `#${i + 1}`), reason: r.reason })
  })
  return { nights, skipped }
}

// ───────── Apple Health ─────────
export type AppleSample = { start: string; end: string; value: string }
const APPLE_STAGE = (value: string): SleepStageName | 'asleep' | 'inbed' | null => {
  const v = value.toLowerCase().replace(/[^a-z]/g, '')
  if (v.includes('inbed')) return 'inbed'
  if (v.includes('awake')) return 'awake'
  if (v.includes('deep')) return 'deep'
  if (v.includes('rem')) return 'rem'
  if (v.includes('core') || v.includes('light')) return 'light'
  if (v.includes('asleep') || v.includes('unspecified')) return 'asleep'
  return null
}
const GAP_MS = 60 * 60000

function zoneFromOffsets(samples: AppleSample[]): string | null {
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(samples.at(-1)?.end ?? '')
  if (!m) return /Z$/.test(samples.at(-1)?.end ?? '') ? 'UTC' : null
  return etcZone((m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])))
}
const validZone = (z?: string) => {
  if (!z) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z })
    return z
  } catch {
    return undefined
  }
}

/**
 * Group Apple Health sleep-analysis samples into nights. "In bed" never counts as
 * sleep; unspecified "Asleep" counts toward duration but invents no stage; HRV is
 * deliberately not imported from Apple Health (it is SDNN, not Garmin's measure).
 */
export function parseAppleSamples(
  samples: AppleSample[],
  opts: { timezone?: string; now?: Date } = {}
): { nights: ImportedNight[]; skipped: { key: string; reason: string }[] } {
  const skipped: { key: string; reason: string }[] = []
  const given = validZone(opts.timezone)
  // A time with no offset means the person's wall clock, not UTC.
  const at = (v: string) =>
    given && typeof v === 'string' && !/(Z|[+-]\d{2}:?\d{2})$/.test(v.trim())
      ? (localToIso(v, given) ?? toIso(v))
      : toIso(v)
  const typed = samples.flatMap((s) => {
    const from = at(s.start),
      to = at(s.end),
      kind = typeof s.value === 'string' ? APPLE_STAGE(s.value) : null
    if (!from || !to || !kind || !(Date.parse(to) > Date.parse(from))) return []
    return kind === 'inbed' ? [] : [{ from: Date.parse(from), to: Date.parse(to), kind }]
  })
  if (!typed.length)
    return { nights: [], skipped: [{ key: 'samples', reason: 'No usable sleep samples' }] }
  typed.sort((a, b) => a.from - b.from || a.to - b.to)
  // Overlapping samples (two apps writing the same night): the earlier-starting one keeps its span.
  const trimmed: typeof typed = []
  for (const s of typed) {
    const prev = trimmed.at(-1)
    const from = prev ? Math.max(s.from, prev.to) : s.from
    if (s.to > from) trimmed.push({ ...s, from })
  }
  const groups: (typeof typed)[] = []
  for (const s of trimmed) {
    const g = groups.at(-1)
    if (g && s.from - g.at(-1)!.to <= GAP_MS) g.push(s)
    else groups.push([s])
  }
  const zone =
    validZone(opts.timezone) ??
    zoneFromOffsets(samples.filter((s) => typeof s.end === 'string')) ??
    'UTC'
  const now = opts.now ?? new Date()
  const nights: ImportedNight[] = []
  for (const g of groups) {
    const startMs = g[0].from,
      endMs = g.at(-1)!.to
    const start = new Date(startMs).toISOString(),
      end = new Date(endMs).toISOString()
    const asleep = g
      .filter((s) => s.kind !== 'awake')
      .reduce((n, s) => n + (s.to - s.from) / 1000, 0)
    const wake = dateInZone(end, zone)
    if (!wake || asleep < 20 * 60) {
      skipped.push({ key: start.slice(0, 10), reason: 'Too short to count as sleep' })
      continue
    }
    const staged = g.filter((s) => s.kind !== 'asleep')
    const stages: SleepStage[] = cleanStages(
      staged.map((s) => ({
        stage: s.kind as SleepStageName,
        start: new Date(s.from).toISOString(),
        end: new Date(s.to).toISOString()
      })),
      start,
      end
    )
    // Only trust a timeline if the staged samples cover most of the night.
    const covered = stages.reduce((n, s) => n + (Date.parse(s.end) - Date.parse(s.start)), 0)
    const useStages = stages.length > 0 && covered >= 0.8 * (endMs - startMs)
    nights.push({
      provider_id: `apple_health:${Math.floor(startMs / 1000)}`,
      wake_date: wake,
      provider_date: wake,
      timezone: zone,
      start_at: start,
      end_at: end,
      kind: asleep >= 3 * 3600 ? 'main' : 'nap',
      duration_seconds: Math.min(Math.round(asleep), Math.floor((endMs - startMs) / 1000)),
      score: null,
      stages: useStages ? stages : null,
      stage_totals: useStages ? totalsFromStages(stages) : null,
      overnight_hrv: null,
      respiration: null,
      spo2: null,
      revision_at: now.toISOString(),
      status: 'unknown'
    })
  }
  // Two long sleeps on one wake date: only the longest is the main sleep.
  const longest = new Map<string, ImportedNight>()
  for (const n of nights)
    if (n.kind === 'main') {
      const best = longest.get(n.wake_date)
      if (!best || n.duration_seconds > best.duration_seconds) longest.set(n.wake_date, n)
    }
  for (const n of nights) if (n.kind === 'main' && longest.get(n.wake_date) !== n) n.kind = 'nap'
  return { nights, skipped }
}

// ───────── Batching ─────────
export const MAX_NIGHTS_PER_BATCH = 14
export type ImportBatch = ReturnType<typeof buildBatches>['batches'][number]

/** Validate every night, drop what ingestion would refuse, and chunk into batches. */
export function buildBatches(
  nights: ImportedNight[],
  source: ImportSource,
  now: Date,
  newId: () => string = () => crypto.randomUUID()
) {
  const earliest = now.getTime() - 179 * 86400000
  const skipped: { key: string; reason: string }[] = []
  const good: ImportedNight[] = []
  const seen = new Set<string>()
  for (const n of nights) {
    if (Date.parse(n.start_at) < earliest) {
      skipped.push({ key: n.wake_date, reason: 'Older than the 180-day history limit' })
      continue
    }
    if (seen.has(n.provider_id)) continue
    seen.add(n.provider_id)
    const parsed = sleepSchema.safeParse(n)
    if (!parsed.success) skipped.push({ key: n.wake_date, reason: parsed.error.issues[0].message })
    else good.push(n)
  }
  good.sort((a, b) => a.start_at.localeCompare(b.start_at))
  const batches = []
  for (let i = 0; i < good.length; i += MAX_NIGHTS_PER_BATCH) {
    const batch = {
      version: 1 as const,
      batch_id: newId(),
      generation: 0,
      source,
      captured_at: now.toISOString(),
      samples: [],
      sleeps: good.slice(i, i + MAX_NIGHTS_PER_BATCH)
    }
    const checked = validateHealthBatch(batch, now, false)
    if (checked.success) batches.push(batch)
    else
      skipped.push({ key: `batch ${batches.length + 1}`, reason: checked.error.issues[0].message })
  }
  return { batches, skipped, accepted: good.length }
}
