import { shiftDate } from '@/lib/health/model'
import { robustDeviation, labelText, type BodySignals, type Signal, type SignalLabel } from './signals'

export interface GarminSignalNight {
  local_date: string
  sleep_device: string | null
  sleep_status: string | null
  sleep_end: string | null
  sleep_avg_hr: number | null
  sleep_avg_respiration: number | null
  overnight_hrv: number | null
  sleep_spo2: number | null
}

const specs = [
  { field: 'sleep_avg_hr', key: 'sleeping_hr', label: 'Sleeping heart rate', direction: 1, floor: 2, unit: 'bpm', digits: 0, bounds: [20, 250] },
  { field: 'overnight_hrv', key: 'overnight_hrv', label: 'Overnight HRV', direction: -1, floor: 4, unit: 'ms', digits: 0, bounds: [1, 500] },
  { field: 'sleep_avg_respiration', key: 'respiration', label: 'Sleeping breathing rate', direction: 1, floor: 0.5, unit: 'breaths/min', digits: 1, bounds: [1, 80] },
] as const

function validNight(night?: GarminSignalNight): night is GarminSignalNight {
  if (!night?.sleep_device || night.sleep_status !== 'final' || !night.sleep_end) return false
  const ended = Date.parse(night.sleep_end)
  const localDay = Date.parse(night.local_date + 'T00:00:00Z')
  return ended >= localDay - 14 * 3600_000 && ended < localDay + 38 * 3600_000
}

function reading(night: GarminSignalNight, spec: typeof specs[number]) {
  const value = night[spec.field]
  return typeof value === 'number' && Number.isFinite(value) && value >= spec.bounds[0] && value <= spec.bounds[1]
    ? value : null
}

export function garminSignals(nights: Map<string, GarminSignalNight>, date: string, labels: SignalLabel[] = []): BodySignals {
  const tonight = nights.get(date)
  const signals: Signal[] = []
  let coverage = 0

  function compare(d: string, spec: typeof specs[number]) {
    const night = nights.get(d)
    if (!validNight(night)) return null
    const value = reading(night, spec)
    if (value == null) return null
    const reference: number[] = []
    for (let n = 1; n <= 28; n++) {
      const past = nights.get(shiftDate(d, -n))
      if (!validNight(past) || past.sleep_device !== night.sleep_device) continue
      const v = reading(past, spec)
      if (v != null) reference.push(v)
    }
    if (d === date) coverage = Math.max(coverage, reference.length)
    if (reference.length < 14) return null
    const { center, spread } = robustDeviation(reference, spec.floor)
    const delta = value - center
    const z = spec.direction * delta / spread
    const format = (v: number) => v.toFixed(spec.digits)
    return {
      key: spec.key, label: spec.label, value: format(value) + ' ' + spec.unit,
      usual: format(center - 2 * spread) + '–' + format(center + 2 * spread) + ' ' + spec.unit,
      off: z >= 2, z: Math.round(z * 10) / 10,
      phrase: spec.label + ' ' + format(Math.abs(delta)) + ' ' + spec.unit + (delta < 0 ? ' below' : ' above') + ' your usual'
    }
  }

  for (const spec of specs) {
    const compared = compare(date, spec)
    if (compared) signals.push(compared)
  }
  signals.sort((a, b) => b.z - a.z)
  const off = signals.filter(s => s.off)
  const yesterday = shiftDate(date, -1)
  const hrTwoNights = off.some(s => s.key === 'sleeping_hr') &&
    tonight?.sleep_device === nights.get(yesterday)?.sleep_device && !!compare(yesterday, specs[0])?.off
  const alert = off.length >= 2 || hrTwoNights
  const checkIn = labels.find(l => l.local_date === date)
  const datedLabels = checkIn?.tags ?? []
  return {
    date, source: 'garmin_personal', level: alert ? 'mild' : signals.length ? 'clear' : 'learning',
    signals, nights: coverage, hrTwoNights, short: alert ? 'Overnight outliers' : null,
    headline: off.length >= 2 ? 'Two or more overnight readings were outside your usual range'
      : hrTwoNights ? 'Sleeping heart rate has been elevated for two nights'
        : !validNight(tonight) ? 'Waiting for a confirmed Garmin night'
          : !signals.length ? 'Learning your usual nights'
            : off.length ? 'One overnight reading was outside your usual range'
              : 'Compared overnight readings are in range',
    advice: alert
      ? off.map(s => s.phrase).join('. ') + '. Check how you feel today.'
      : off.length ? off[0].phrase + '.'
        : signals.length ? 'These readings are within your usual range.'
          : 'Each reading needs at least 14 comparable nights from the past 28 days.',
    labels: datedLabels,
    symptomsOnsetAt: checkIn?.symptoms_onset_at,
    explanations: datedLabels.filter(t => !['sick', 'fine'].includes(t)).map(labelText)
  }
}

export function garminSignalRecord(nights: Map<string, GarminSignalNight>, date: string, labels: SignalLabel[]) {
  const record = { flagged: 0, labelled: 0, sick: 0 }
  for (let n = 0; n < 28; n++) {
    const result = garminSignals(nights, shiftDate(date, -n), labels)
    if (result.level !== 'mild') continue
    record.flagged++
    if (result.labels.length) record.labelled++
    if (result.labels.includes('sick')) record.sick++
  }
  return record
}
