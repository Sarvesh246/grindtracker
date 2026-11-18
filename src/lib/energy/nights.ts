import { mainSleep, shiftDate, type SleepSession } from '@/lib/health/model'
import { clockHoursFrom } from './time'
import type { Nap, Night } from './types'

/**
 * Turn raw sleep records (several sources, mains and naps) into one Night per
 * wake date plus that day's naps, the way a person would describe them.
 *
 * Two real-data problems this exists for:
 *  - The same sleep arrives from several sources (Garmin export AND Apple Health),
 *    sometimes labelled differently ("main" in one, "nap" in the other). Overlapping
 *    records are one block; the block counts its longest record's sleep, never the sum.
 *  - A broken night (awake 04:00–05:15, back to sleep) can arrive as two records,
 *    and a source may only export one half. Blocks within 2h of the main block are
 *    chained into the same night, so onset and total sleep stay right.
 */

/** Pieces closer than this are one night with a wake-up in the middle. */
export const SPLIT_GAP_H = 2
/** Shorter daytime sleep is noise (a doze on the couch the watch half-saw). */
const MIN_NAP_H = 10 / 60
/** Window before the wake date's midnight that can still belong to its night. */
const LOOKBACK_DAYS = 28

interface Piece {
  start: number
  end: number
  sleepH: number
  main: boolean
  session: SleepSession
}
interface Block {
  start: number
  end: number
  sleepH: number
  main: boolean
  sessions: SleepSession[]
}

function blocksOf(pieces: Piece[]): Block[] {
  const sorted = [...pieces].sort((a, b) => a.start - b.start)
  const out: Block[] = []
  for (const p of sorted) {
    const last = out[out.length - 1]
    // Overlap means the same sleep seen twice: keep the longer reading, don't add.
    if (last && p.start < last.end) {
      last.end = Math.max(last.end, p.end)
      last.sleepH = Math.max(last.sleepH, p.sleepH)
      last.main ||= p.main
      last.sessions.push(p.session)
    } else {
      out.push({ start: p.start, end: p.end, sleepH: p.sleepH, main: p.main, sessions: [p.session] })
    }
  }
  return out
}

/** The stage the person woke from, from any stage timeline in the night's last block. */
function wakeStageOf(block: Block): Night['wakeStage'] {
  for (const s of block.sessions) {
    const stages = s.stages?.filter((st) => st.stage !== 'awake') ?? []
    const last = stages[stages.length - 1]
    if (!last) continue
    // Only trust it if that stage ran right up to the end of the night.
    if (Date.parse(s.end_at) - Date.parse(last.end) <= 20 * 60_000) return last.stage as Night['wakeStage']
  }
  return null
}

export function buildNights(
  sessions: SleepSession[],
  beforeOrOn: string,
): { nights: Night[]; naps: Nap[] } {
  const byDate = new Map<string, SleepSession[]>()
  for (const s of sessions) {
    if (s.wake_date > beforeOrOn || s.wake_date <= shiftDate(beforeOrOn, -LOOKBACK_DAYS)) continue
    const list = byDate.get(s.wake_date) ?? []
    list.push(s)
    byDate.set(s.wake_date, list)
  }

  const nights: Night[] = []
  const naps: Nap[] = []
  for (const date of [...byDate.keys()].sort().reverse()) {
    const pieces: Piece[] = []
    for (const s of byDate.get(date)!) {
      const zone = s.timezone || 'UTC'
      const start = clockHoursFrom(date, s.start_at, zone)
      const end = clockHoursFrom(date, s.end_at, zone)
      if (!(end > start) || end - start > 16) continue
      pieces.push({ start, end, sleepH: Math.min(s.duration_seconds / 3600, end - start), main: s.kind === 'main', session: s })
    }
    const blocks = blocksOf(pieces)
    if (!blocks.length) continue

    // Anchor on the longest block that some source called the main sleep. A day
    // with only naps on record has no night to anchor; its naps still count.
    const mains = blocks.filter((b) => b.main)
    if (!mains.length) {
      for (const b of blocks) {
        if (b.sleepH >= MIN_NAP_H) naps.push({ date, start: b.start, end: b.end, sleepH: b.sleepH })
      }
      continue
    }
    const anchor = mains.reduce((a, b) => (b.sleepH > a.sleepH ? b : a))
    let lo = blocks.indexOf(anchor)
    let hi = lo
    while (lo > 0 && blocks[lo].start - blocks[lo - 1].end <= SPLIT_GAP_H) lo--
    while (hi < blocks.length - 1 && blocks[hi + 1].start - blocks[hi].end <= SPLIT_GAP_H) hi++
    const chain = blocks.slice(lo, hi + 1)

    // Whatever else happened after waking is a nap.
    const wake = chain[chain.length - 1].end
    let napH = 0
    for (const b of blocks.slice(hi + 1)) {
      if (b.start < wake || b.sleepH < MIN_NAP_H) continue
      naps.push({ date, start: b.start, end: b.end, sleepH: b.sleepH })
      napH += b.sleepH
    }

    nights.push({
      wakeDate: date,
      onset: chain[0].start,
      wake,
      sleepH: chain.reduce((sum, b) => sum + b.sleepH, 0),
      napH,
      pieces: chain.length,
      // mainSleep already merges HRV across sources for the same night.
      hrv: mainSleep(sessions, date)?.overnight_hrv ?? null,
      wakeStage: wakeStageOf(chain[chain.length - 1]),
    })
  }
  return { nights, naps }
}
