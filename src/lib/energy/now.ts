import { PHASES } from './copy'
import type { EnergyKind, EnergySchedule } from './types'

export type NowState = 'before_wake' | 'between' | 'past_bedtime' | EnergyKind

export interface NowReading {
  state: NowState
  title: string
  hint: string
  /** Next boundary (a phase starting or ending), if any is left today. */
  next: { at: number; label: string } | null
}

/** Which phase `now` falls in, and the next change. Pure, so it is unit-tested. */
export function phaseAt(s: EnergySchedule, now: number): NowReading {
  const ev = (k: EnergyKind) => s.events.find((e) => e.kind === k)
  const t = (iso?: string) => (iso ? Date.parse(iso) : NaN)

  const boundaries: { at: number; label: string }[] = []
  for (const e of s.events) {
    if (e.kind === 'grogginess_end') continue
    const name = PHASES[e.kind].name
    boundaries.push({ at: t(e.start), label: e.kind === 'bedtime' ? 'Bedtime' : `${name} starts` })
    if (e.end) boundaries.push({ at: t(e.end), label: `${name} ends` })
  }
  const next = boundaries.filter((b) => b.at > now).sort((a, b) => a.at - b.at)[0] ?? null

  const wake = t(s.wakeAt)
  const groggyEnd = t(ev('grogginess_end')?.start)
  const bedtime = t(ev('bedtime')?.start)
  const inside = (k: EnergyKind) => {
    const e = ev(k)
    return !!e && now >= t(e.start) && now < t(e.end ?? e.start)
  }
  const read = (state: NowState, title: string, hint: string): NowReading => ({ state, title, hint, next })

  if (now < wake) return read('before_wake', 'Still asleep', 'Your day starts at wake.')
  if (now >= bedtime) return read('past_bedtime', 'Past bedtime', PHASES.bedtime.hint)
  if (now < groggyEnd) return read('grogginess_end', PHASES.grogginess_end.name, PHASES.grogginess_end.hint)
  for (const k of ['morning_peak', 'afternoon_dip', 'evening_peak', 'wind_down'] as const) {
    if (inside(k)) return read(k, PHASES[k].name, PHASES[k].hint)
  }
  if (now >= t(ev('wind_down')?.end)) return read('wind_down', 'Winding down', PHASES.wind_down.hint)
  return read('between', 'Steady', 'Between phases. Energy is holding.')
}
