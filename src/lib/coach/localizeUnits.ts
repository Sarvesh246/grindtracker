import { LBS_PER_KG } from '@/lib/utils/units'

/**
 * Put every weight in USER_DATA into the user's own unit before the model sees it.
 *
 * Storage is canonical lbs, and the prompt used to tell the model to convert
 * for kg users — arithmetic it sometimes botched (and the reason the prompt
 * carried rules against "25 b" and "90 min"). Converting here is exact and free.
 * lbs users are returned untouched; kg users get every `*_lbs` number divided
 * by LBS_PER_KG and the key renamed `*_kg`.
 */
export function localizeCoachContext<T>(context: T, unit: 'lbs' | 'kg'): T {
  if (unit !== 'kg') return context
  return convert(context) as T
}

function convert(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map(v => convert(v))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'weight_storage') {
        out[k] = 'kg'
      } else if (k.endsWith('_lbs')) {
        out[`${k.slice(0, -4)}_kg`] = convert(v, k)
      } else {
        out[k] = convert(v, k)
      }
    }
    return out
  }
  if (typeof value === 'number' && key?.endsWith('_lbs')) {
    const kg = value / LBS_PER_KG
    // Volume is a big total — whole numbers; weights keep one decimal.
    return key.includes('volume') ? Math.round(kg) : Math.round(kg * 10) / 10
  }
  return value
}
