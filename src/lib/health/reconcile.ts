import type { HealthHistoryDay, HealthMetric } from './model'

/**
 * Source precedence for overlapping readings.
 *
 * 1. Real UTC samples beat the legacy `daily_body` snapshot, whose timing is only
 *    "sometime that day" and whose buckets are local-time.
 * 2. Among samples: a `current` reading beats a `partial` one, then an approved
 *    cloud source beats a personal cloud source beats the watch app, then the
 *    later measurement wins, then the later provider revision.
 * 3. Sleep-session values (overnight HRV) beat a stand-alone HRV sample for the
 *    same wake date; the sleep record is where the source states its method.
 *
 * Nothing here averages two sources together: one reading is chosen and its
 * provenance is kept so the UI can say where it came from.
 */
export type HealthSource =
  | 'connect_iq'
  | 'garmin_personal'
  | 'garmin_business'
  | 'garmin_export'
  | 'garmin_unofficial'
  | 'apple_health'
/**
 * Richest, most direct source first. Garmin's own cloud beats a hand-imported
 * Garmin export, which beats Apple Health's coarser copy; the watch app is last
 * because it supplies no sleep. Lower sources still fill fields the winner lacks.
 */
export const SOURCE_RANK: Record<HealthSource, number> = {
  garmin_business: 6,
  garmin_personal: 5,
  garmin_unofficial: 4,
  garmin_export: 3,
  apple_health: 2,
  connect_iq: 1
}
export const SOURCE_LABEL: Record<HealthSource, string> = {
  garmin_business: 'Garmin Connect (approved connection)',
  garmin_personal: 'Garmin Connect (personal)',
  garmin_unofficial: 'Garmin sync script',
  garmin_export: 'Garmin data export',
  apple_health: 'Apple Health',
  connect_iq: 'Garmin watch app'
}
export const sourceLabel = (source: string): string =>
  (SOURCE_LABEL as Record<string, string>)[source] ?? source

export interface SampleRow {
  metric: string
  provider_id: string
  start_at: string
  end_at: string
  observed_at: string
  revision_at: string
  value: number | null
  unit: string
  kind: 'point' | 'average' | 'total'
  quality: 'current' | 'partial' | 'unavailable'
  source: HealthSource
}
export interface Provenance {
  source: HealthSource | 'legacy_snapshot' | 'sleep_record'
  observed_at: string | null
  quality: SampleRow['quality'] | 'legacy'
}
export type DayProvenance = Partial<Record<HealthMetric, Provenance>>

/** Sample metric → the history field it feeds. Others (heart_rate, respiration) are not daily values. */
const FIELD: Record<string, HealthMetric> = {
  resting_hr: 'resting_hr',
  hrv: 'overnight_hrv',
  spo2: 'spo2',
  steps: 'steps',
  recovery_hours: 'recovery_hours',
  body_battery: 'bb_latest',
  stress: 'stress_avg'
}

/** YYYY-MM-DD of an instant in an IANA timezone (the viewer's by default). */
export function localDateIn(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {})
  }).formatToParts(new Date(iso))
  const part = (t: string) => parts.find((p) => p.type === t)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

const qualityRank = (q: SampleRow['quality']) => (q === 'current' ? 2 : q === 'partial' ? 1 : 0)
export function compareSamples(a: SampleRow, b: SampleRow): number {
  return (
    qualityRank(b.quality) - qualityRank(a.quality) ||
    SOURCE_RANK[b.source] - SOURCE_RANK[a.source] ||
    Date.parse(b.end_at) - Date.parse(a.end_at) ||
    Date.parse(b.revision_at) - Date.parse(a.revision_at)
  )
}

/**
 * Fold UTC samples into the daily history. `timeZone` assigns each sample to the
 * day the person experienced it (a flight or DST change can't move a night's
 * reading onto the wrong date because the date comes from the sample's end).
 */
export function mergeSamplesIntoHistory(
  history: HealthHistoryDay[],
  samples: SampleRow[],
  timeZone?: string
): { history: HealthHistoryDay[]; provenance: Record<string, DayProvenance> } {
  const best = new Map<string, SampleRow>()
  for (const s of samples) {
    const field = FIELD[s.metric]
    if (!field || s.value == null || !Number.isFinite(s.value) || s.quality === 'unavailable')
      continue
    const key = `${localDateIn(s.end_at, timeZone)}|${field}`
    const current = best.get(key)
    if (!current || compareSamples(s, current) < 0) best.set(key, s)
  }
  const byDate = new Map(history.map((d) => [d.local_date, { ...d }]))
  const provenance: Record<string, DayProvenance> = {}
  for (const [key, sample] of best) {
    const [date, field] = key.split('|') as [string, HealthMetric]
    const row = byDate.get(date) ?? { local_date: date }
    ;(row as Record<string, unknown>)[field] = sample.value
    byDate.set(date, row)
    ;(provenance[date] ??= {})[field] = {
      source: sample.source,
      observed_at: sample.observed_at,
      quality: sample.quality
    }
  }
  // Legacy values that no sample replaced keep an honest "snapshot" provenance.
  for (const row of history)
    for (const field of Object.keys(FIELD).map((k) => FIELD[k])) {
      const value = (row as Record<string, unknown>)[field]
      if (typeof value === 'number' && !provenance[row.local_date]?.[field])
        (provenance[row.local_date] ??= {})[field] = {
          source: 'legacy_snapshot',
          observed_at: null,
          quality: 'legacy'
        }
    }
  return {
    history: [...byDate.values()].sort((a, b) => a.local_date.localeCompare(b.local_date)),
    provenance
  }
}

/**
 * Newest successful sync across every source: connection imports (sleep
 * script, Shortcut, export) and the watch's daily uploads. Preferring one
 * kind over the other showed an old sleep import as the last sync while the
 * watch had just uploaded.
 */
export function latestSync(
  connections: { last_success_at: string | null }[],
  days: { synced_at?: string | null }[]
): string | null {
  let best: string | null = null
  let bestMs = -Infinity
  for (const iso of [
    ...connections.map((c) => c.last_success_at),
    ...days.map((d) => d.synced_at ?? null)
  ]) {
    const ms = iso ? Date.parse(iso) : NaN
    if (Number.isFinite(ms) && ms > bestMs) {
      best = iso
      bestMs = ms
    }
  }
  return best
}

export function relativeTime(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null
  const minutes = Math.round((now - Date.parse(iso)) / 60000)
  if (!Number.isFinite(minutes)) return null
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

const ERROR_TEXT: Record<string, string> = {
  expired_credentials: 'The Garmin connection expired. Reconnect to resume imports.',
  rate_limited: 'Garmin asked GRIND to slow down. Imports will retry automatically.',
  revoked: 'Access was revoked in Garmin. Reconnect to resume imports.',
  provider_error: 'Garmin returned an error. Imports will retry automatically.'
}
export function connectionErrorText(code: string | null | undefined): string | null {
  if (!code) return null
  return ERROR_TEXT[code] ?? 'The last import did not finish. It will be retried.'
}
