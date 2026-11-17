import { BUCKET_MINUTES, type DailyBody } from './types'

/**
 * The day told as a story: up to four timestamped sentences drawn from the
 * Body Battery and stress series, so nobody has to read the chart.
 */

export interface StoryLine {
  /** "7:00a", "12–4p", "now" */
  time: string
  /** Lead phrase, emphasised in the UI. */
  lead: string
  text: string
}

export interface DayWorkout {
  name: string
  started_at: string
  completed_at: string | null
}

export function bucketTime(i: number, withMeridiem = true): string {
  const mins = i * BUCKET_MINUTES
  const h24 = Math.floor(mins / 60) % 24
  const m = mins % 60
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  const ap = h24 < 12 ? 'a' : 'p'
  return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''}${withMeridiem ? ap : ''}`
}

/** Bucket index (0–95) for a timestamp, in the viewer's local time. */
export function bucketOf(iso: string): number {
  const d = new Date(iso)
  return Math.min(95, Math.floor((d.getHours() * 60 + d.getMinutes()) / BUCKET_MINUTES))
}

function valueNear(series: (number | null)[], i: number, dir: -1 | 1): number | null {
  for (let k = 0; k < 4; k++) {
    const v = series[i + dir * k]
    if (v != null) return v
  }
  return null
}

export function dayStory(row: DailyBody, workouts: DayWorkout[], isToday: boolean): StoryLine[] {
  const bb = row.bb_series ?? []
  const stress = row.stress_series ?? []
  const lines: StoryLine[] = []

  // Morning: the first reading of the day, or the stored wake value.
  const firstIdx = bb.findIndex(v => v != null)
  const wake = row.bb_wake ?? (firstIdx >= 0 && firstIdx < 48 ? bb[firstIdx] : null)
  if (wake != null) {
    const how = wake >= 80 ? 'fully charged overnight' : wake >= 50 ? 'a decent recharge overnight' : 'a short recharge overnight'
    lines.push({ time: firstIdx >= 0 ? bucketTime(firstIdx) : 'am', lead: `Woke at ${wake}`, text: `, ${how}.` })
  }

  // The longest run of high stress (60+), if it lasted at least 45 minutes.
  let best: [number, number] | null = null
  let runStart = -1
  for (let i = 0; i <= stress.length; i++) {
    const high = i < stress.length && (stress[i] ?? 0) >= 60
    if (high && runStart < 0) runStart = i
    if (!high && runStart >= 0) {
      if (!best || i - runStart > best[1] - best[0]) best = [runStart, i]
      runStart = -1
    }
  }
  if (best && best[1] - best[0] >= 3) {
    const part = best[0] < 48 ? 'morning' : best[0] < 68 ? 'afternoon' : 'evening'
    lines.push({
      time: `${bucketTime(best[0], false)}–${bucketTime(best[1])}`,
      lead: 'Your busiest stretch',
      text: `: stress ran high through the ${part}.`,
    })
  }

  // Each finished workout: what it cost in Body Battery.
  for (const w of workouts) {
    if (!w.completed_at) continue
    const a = valueNear(bb, bucketOf(w.started_at) - 1, -1)
    const b = valueNear(bb, bucketOf(w.completed_at) + 1, 1)
    if (a == null || b == null) continue
    const cost = a - b
    const mins = Math.max(1, Math.round((Date.parse(w.completed_at) - Date.parse(w.started_at)) / 60_000))
    const perHour = Math.round((cost / mins) * 60)
    lines.push({
      time: bucketTime(bucketOf(w.started_at)),
      lead: cost > 0 ? `${w.name} cost ${cost} points` : `${w.name} barely dented it`,
      text: cost > 0 ? `. About ${perHour} an hour, ${perHour > 35 ? 'a hard session' : 'normal for lifting'}.` : '.',
    })
  }

  const latest = row.bb_latest
  if (latest != null) {
    const verdict =
      latest >= 50
        ? 'Plenty left in the tank.'
        : latest >= 25
          ? 'Fine for tomorrow if you sleep well.'
          : 'Running low. An early night helps more than anything.'
    lines.push({ time: isToday ? 'now' : 'end', lead: `At ${latest}`, text: `. ${verdict}` })
  }
  return lines
}
