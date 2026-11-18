import type { AlertKind, EnergyEvent, EnergyKind } from './types'

/** Labels and the one-line "what to do with this" for each phase. */
export const PHASES: Record<EnergyKind, { name: string; hint: string }> = {
  grogginess_end: {
    name: 'Grogginess',
    hint: 'Sleep inertia is clearing. Get daylight and hold the caffeine 60–90 min.',
  },
  morning_peak: {
    name: 'Morning peak',
    hint: 'Sharpest focus of the day. Put the hard thinking or heavy lifts here.',
  },
  afternoon_dip: {
    name: 'Afternoon dip',
    hint: 'Energy sags. Easy walk, light work, or a 20-min nap. Not a PR attempt.',
  },
  evening_peak: {
    name: 'Evening peak',
    hint: 'Your second wind. Strength and power peak around now. Good training window.',
  },
  wind_down: {
    name: 'Wind-down',
    hint: 'Melatonin is rising. Dim the lights, drop screens, start your routine.',
  },
  bedtime: {
    name: 'Bedtime',
    hint: 'Lights out now to pay back debt and wake on time.',
  },
}

export const ALERT_KIND_TO_NOTIFICATION: Record<AlertKind, string> = {
  morning_peak: 'energy_morning_peak',
  afternoon_dip: 'energy_dip',
  evening_peak: 'energy_evening_peak',
  wind_down: 'energy_wind_down',
}

function clock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
}

/** Push text for a heads-up `leadMin` before the event. */
export function alertCopy(
  event: EnergyEvent,
  timeZone: string,
  leadMin: number,
): { title: string; body: string } {
  const range = event.end
    ? `${clock(event.start, timeZone)}–${clock(event.end, timeZone)}`
    : clock(event.start, timeZone)
  const phase = PHASES[event.kind]
  return {
    title: `${phase.name} in ${leadMin} min`,
    body: `${range}. ${phase.hint}`,
  }
}
